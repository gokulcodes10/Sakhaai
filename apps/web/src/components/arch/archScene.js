/**
 * The keystone-arch scene behind the home page's scroll story.
 *
 * Ported from the rebrand handoff (the bundled re-branding/Asphalix Landing.html,
 * which is newer than the loose arch-scene.js: it adds the server-rack backdrop
 * and builds the rounded rectangles from four absarcs, fixing a bevel seam).
 * The custom element became a plain function so React owns the lifecycle.
 *
 * Imported dynamically by ArchStory, so three.js never lands in the entry chunk.
 * Throws if WebGL is unavailable; the caller renders a static fallback.
 */
import * as T from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => {
  x = clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
};
const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
const easeOutBack = (x) => {
  x = clamp(x, 0, 1);
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const easeInQuad = (x) => clamp(x, 0, 1) ** 2;

/**
 * @param {HTMLElement} host      element the canvas fills
 * @param {object} opts
 * @param {() => number} opts.getProgress  scroll progress through the story, 0..1
 * @param {boolean} [opts.particles=true]
 * @returns {() => void} dispose
 */
export function createArchScene(host, { getProgress, particles = true } = {}) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputColorSpace = T.SRGBColorSpace;
  Object.assign(renderer.domElement.style, { display: 'block', position: 'absolute', inset: '0', width: '100%', height: '100%' });
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.appendChild(renderer.domElement);

  const scene = new T.Scene();
  scene.fog = new T.Fog(0x14161a, 17, 36);
  const camera = new T.PerspectiveCamera(32, 1, 0.1, 100);

  scene.add(new T.HemisphereLight(0xf5f4f1, 0x1a1c20, 1.15));
  const key = new T.DirectionalLight(0xffffff, 1.9);
  key.position.set(4, 9, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
  key.shadow.radius = 6;
  scene.add(key);
  const rim = new T.DirectionalLight(0x9fb2ff, 0.9);
  rim.position.set(-7, 3, -6);
  scene.add(rim);

  const GROUND_Y = -2.5;
  const ground = new T.Mesh(new T.PlaneGeometry(80, 80), new T.ShadowMaterial({ opacity: 0.5 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new T.GridHelper(48, 48, 0x30343a, 0x24272c);
  grid.position.y = GROUND_Y + 0.005;
  grid.material.transparent = true;
  grid.material.opacity = 0.7;
  scene.add(grid);

  // ── The arch: two leaning piers and a keystone ────────────────────────────
  const rr = (w, h, r) => {
    const s = new T.Shape();
    const x = -w / 2;
    const y = -h / 2;
    s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    s.absarc(x + w - r, y + r, r, Math.PI * 1.5, Math.PI * 2);
    s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    s.autoClose = true;
    return s;
  };
  const extrude = (w, h, r) => {
    const g = new T.ExtrudeGeometry(rr(w, h, r), {
      depth: 1.05,
      bevelEnabled: true,
      bevelThickness: 0.14,
      bevelSize: 0.12,
      bevelSegments: 6,
      curveSegments: 28,
    });
    g.center();
    return g;
  };
  const mk = (geo, hex) => {
    const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: hex, roughness: 0.42, metalness: 0.04 }));
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.base = new T.Color(hex);
    return m;
  };
  const pierGeo = extrude(1.06, 2.96, 0.43);
  const arch = new T.Group();
  const left = mk(pierGeo, '#3A5BD9');
  const right = mk(pierGeo, '#18937F');
  const keyst = mk(extrude(1.56, 1.06, 0.38), '#E0603C');
  const LEAN = (10 * Math.PI) / 180;
  const base = {
    left: new T.Vector3(-1.35, -0.8, 0),
    right: new T.Vector3(1.35, -0.8, 0),
    key: new T.Vector3(0, 1.75, 0),
  };
  arch.add(left, right, keyst);
  scene.add(arch);
  const DIM = new T.Color('#2A2D33');

  const ring = new T.Mesh(
    new T.RingGeometry(0.9, 1.0, 96),
    new T.MeshBasicMaterial({ color: 0xe0603c, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = GROUND_Y + 0.02;
  scene.add(ring);
  let pulseAt = -1;

  // ── Backdrop: a row of server racks with blinking LEDs ────────────────────
  const RACKS = 16;
  const COLS = 2;
  const ROWS = 18;
  const RZ = -8.5;
  const rackMat = new T.MeshStandardMaterial({ color: '#1C1E23', roughness: 0.75, metalness: 0.2 });
  const rackGeo = new T.BoxGeometry(1.1, 4.4, 1.0);
  const slotGeo = new T.BoxGeometry(0.96, 0.02, 0.02);
  const slotMat = new T.MeshBasicMaterial({ color: '#2A2D33' });
  const racks = new T.Group();
  for (let i = 0; i < RACKS; i++) {
    const x = (i - (RACKS - 1) / 2) * 1.32;
    const rk = new T.Mesh(rackGeo, rackMat);
    rk.position.set(x, GROUND_Y + 2.2, RZ);
    rk.castShadow = true;
    rk.receiveShadow = true;
    racks.add(rk);
    for (let u = 0; u < 9; u++) {
      const sl = new T.Mesh(slotGeo, slotMat);
      sl.position.set(x, GROUND_Y + 0.35 + u * 0.46, RZ + 0.51);
      racks.add(sl);
    }
  }
  scene.add(racks);

  const LED_N = RACKS * COLS * ROWS;
  const leds = new T.InstancedMesh(
    new T.BoxGeometry(0.07, 0.035, 0.02),
    new T.MeshBasicMaterial({ toneMapped: false }),
    LED_N
  );
  const ledOn = ['#3FC2A8', '#3FC2A8', '#3FC2A8', '#6E8AF0', '#6E8AF0', '#F0845F'].map((c) => new T.Color(c));
  const ledOff = new T.Color('#23262B');
  const ledState = new Uint8Array(LED_N);
  const ledCol = [];
  const m4 = new T.Matrix4();
  let li = 0;
  for (let i = 0; i < RACKS; i++) {
    const x = (i - (RACKS - 1) / 2) * 1.32;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        m4.makeTranslation(x + 0.3 + c * 0.13, GROUND_Y + 0.25 + r * 0.225, RZ + 0.52);
        leds.setMatrixAt(li, m4);
        ledCol[li] = ledOn[(Math.random() * ledOn.length) | 0];
        ledState[li] = Math.random() < 0.55 ? 1 : 0;
        leds.setColorAt(li, ledState[li] ? ledCol[li] : ledOff);
        li++;
      }
    }
  }
  leds.instanceColor.needsUpdate = true;
  scene.add(leds);
  let ledClock = 0;

  // ── Particles flowing through the arch ────────────────────────────────────
  const N = 320;
  const Z0 = -9;
  const Z1 = 7;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const spd = new Float32Array(N);
  const hues = ['#F5F4F1', '#F5F4F1', '#F5F4F1', '#6E8AF0', '#3FC2A8', '#F0845F'].map((c) => new T.Color(c));
  for (let i = 0; i < N; i++) {
    const y = GROUND_Y + 0.15 + Math.random() * 2.7;
    const t = (y - GROUND_Y) / 3.1;
    const half = 0.32 + 0.55 * (1 - t);
    pos[i * 3] = (Math.random() * 2 - 1) * half;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = Z0 + Math.random() * (Z1 - Z0);
    const c = hues[(Math.random() * hues.length) | 0];
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    spd[i] = 0.6 + Math.random() * 0.9;
  }
  const pGeo = new T.BufferGeometry();
  pGeo.setAttribute('position', new T.BufferAttribute(pos, 3));
  pGeo.setAttribute('color', new T.BufferAttribute(col, 3));
  const pMat = new T.PointsMaterial({ size: 0.055, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
  scene.add(new T.Points(pGeo, pMat));

  // ── Sizing: the arch sits right of the copy on wide screens; on a phone the
  // camera pulls back so the whole arch fits the width, above the copy. ─────
  let distScale = 1;
  const resize = () => {
    const W = Math.max(1, host.clientWidth);
    const H = Math.max(1, host.clientHeight);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    if (W / H > 1.2) camera.setViewOffset(W, H, -W * 0.17, 0, W, H);
    else camera.setViewOffset(W, H, 0, H * 0.3, W, H);
    distScale = Math.max(1, 0.75 / (W / H));
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let visible = true;
  const io = new IntersectionObserver((e) => {
    visible = e[0].isIntersecting;
  });
  io.observe(host);

  const mouse = { x: 0, y: 0 };
  const mS = { x: 0, y: 0 };
  const onPointer = (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  // ── Loop ──────────────────────────────────────────────────────────────────
  const cam = { yaw: 0, y: 0.9, dist: 15 };
  const t0 = performance.now();
  let last = t0;
  let locked = false;
  let lockAt = -1;
  let raf = 0;

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible) return;
    // Reduced motion: skip straight past the intro and drop all ambient sway.
    const t = reduced ? 99 : (now - t0) / 1000;
    const amp = reduced ? 0 : 1;

    const p = clamp(getProgress?.() ?? 0, 0, 1);
    const seg = p * 4;
    const w = [0, 1, 2, 3, 4].map((k) => smooth(1.5 - Math.abs(seg - k) * 2));

    // Intro: piers rise and lean, then the keystone drops in.
    const lp = easeOutCubic((t - 0.1) / 1.0);
    const rp = easeOutCubic((t - 0.25) / 1.0);
    const lean = easeOutBack((t - 0.75) / 0.6);
    left.position.set(base.left.x, base.left.y - 6 * (1 - lp), 0);
    right.position.set(base.right.x, base.right.y - 6 * (1 - rp), 0);
    left.rotation.z = -LEAN * lean;
    right.rotation.z = LEAN * lean;
    const kd = easeOutBack((t - 1.25) / 0.65);
    let keyY = base.key.y + 7 * (1 - kd);
    if (t > 1.25 && t < 1.95 && pulseAt < 0) pulseAt = t0 / 1000 + 1.9;

    // Step 3 "locks" the keystone: lift, drop, flash, pulse.
    if (w[3] > 0.85 && !locked) {
      locked = true;
      lockAt = now / 1000;
    }
    if (w[3] < 0.2) locked = false;
    let flash = 0;
    if (lockAt > 0) {
      const u = now / 1000 - lockAt;
      if (u < 0.45) keyY += 0.6 * easeOutCubic(u / 0.45);
      else if (u < 0.78) keyY += 0.6 * (1 - easeInQuad((u - 0.45) / 0.33));
      if (u >= 0.78 && u < 0.8 && pulseAt < now / 1000 - 0.5) pulseAt = now / 1000;
      if (u > 0.78) flash = Math.max(0, 1 - (u - 0.78) / 1.1);
      if (u > 3) lockAt = -1;
    }
    keyst.position.set(0, keyY, 0);
    keyst.material.emissive.set(0xe0603c);
    keyst.material.emissiveIntensity = flash * 0.55;

    // Steps 1-3 each highlight one member by dimming the others.
    const hl = [w[1], w[2], w[3]];
    const focus = Math.min(1, hl[0] + hl[1] + hl[2]);
    [left, right, keyst].forEach((m, i) => {
      const d = clamp(focus - hl[i], 0, 1) * 0.88;
      m.material.color.copy(m.userData.base).lerp(DIM, d);
    });

    const nowS = now / 1000;
    if (pulseAt > 0 && nowS >= pulseAt) {
      const u = (nowS - pulseAt) / 1.4;
      if (u < 1) {
        const s = 1 + u * 3.2;
        ring.scale.set(s, s, s);
        ring.material.opacity = 0.55 * (1 - u);
      } else {
        ring.material.opacity = 0;
        pulseAt = 0;
      }
    }

    // Step 4 turns the particle flow up.
    const pTarget = (particles ? 1 : 0) * (0.18 + 0.72 * w[4]) * smooth((t - 1.8) / 1.0);
    pMat.opacity += (pTarget - pMat.opacity) * (1 - Math.exp(-dt * 3));
    const particleZ = dt * (1.2 + 2.2 * w[4]) * (reduced ? 0 : 1);
    if (pMat.opacity > 0.01 && particleZ > 0) {
      for (let i = 0; i < N; i++) {
        let z = pos[i * 3 + 2] + particleZ * spd[i];
        if (z > Z1) z = Z0;
        pos[i * 3 + 2] = z;
      }
      pGeo.attributes.position.needsUpdate = true;
    }

    ledClock += dt;
    if (ledClock > 0.06 && !reduced) {
      ledClock = 0;
      const flips = (6 + (w[2] + w[4]) * 14) | 0;
      for (let f = 0; f < flips; f++) {
        const j = (Math.random() * LED_N) | 0;
        ledState[j] ^= 1;
        leds.setColorAt(j, ledState[j] ? ledCol[j] : ledOff);
      }
      leds.instanceColor.needsUpdate = true;
    }

    // Camera orbits with the story, plus a little pointer parallax.
    mS.x += (mouse.x - mS.x) * (1 - Math.exp(-dt * 3));
    mS.y += (mouse.y - mS.y) * (1 - Math.exp(-dt * 3));
    const tYaw = w[1] * -0.45 + w[2] * 0.45 + w[4] * 0.72 + mS.x * 0.16 * amp + Math.sin(t * 0.3) * 0.05 * amp;
    const tY = 0.9 + w[3] * 1.5 + w[4] * 1.9 - mS.y * 0.35 * amp;
    const tD = 15 - w[3] * 1.8 + w[4] * 0.8;
    const k = 1 - Math.exp(-dt * 3.2);
    cam.yaw += (tYaw - cam.yaw) * k;
    cam.y += (tY - cam.y) * k;
    cam.dist += (tD - cam.dist) * k;
    const d = cam.dist * distScale;
    camera.position.set(Math.sin(cam.yaw) * d, cam.y * distScale, Math.cos(cam.yaw) * d);
    camera.lookAt(0, -0.35, 0);
    arch.position.y = Math.sin(t * 0.8) * 0.02 * amp;

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return function dispose() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    window.removeEventListener('pointermove', onPointer);
    scene.traverse((obj) => {
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      mats.forEach((m) => m.dispose());
    });
    renderer.dispose();
    renderer.domElement.remove();
  };
}
