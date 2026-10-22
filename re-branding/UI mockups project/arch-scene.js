(function () {
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
  let threeP;
  const loadThree = () => threeP || (threeP = import(THREE_URL));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const easeOutBack = (x) => { x = clamp(x, 0, 1); const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const easeInQuad = (x) => clamp(x, 0, 1) ** 2;

  class ArchScene extends HTMLElement {
    connectedCallback() {
      if (this._live) return;
      this._live = true;
      Object.assign(this.style, { display: 'block', position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'hidden' });
      loadThree().then((T) => { if (this._live) this.setup(T); }).catch((e) => console.error('arch-scene: three.js failed to load', e));
    }
    disconnectedCallback() {
      this._live = false;
      cancelAnimationFrame(this._raf);
      this._ro && this._ro.disconnect();
      this._io && this._io.disconnect();
      window.removeEventListener('pointermove', this._pm);
      if (this._renderer) { this._renderer.dispose(); this._renderer.domElement.remove(); this._renderer = null; }
    }
    flag(name, dflt) {
      const v = this[name] !== undefined ? this[name] : this.getAttribute(name);
      if (v === null || v === undefined) return dflt;
      return !(v === false || v === 'false');
    }
    motion() {
      const v = this.motionLevel !== undefined ? this.motionLevel : this.getAttribute('motion-level');
      return v === 'Calm' ? 0.35 : 1;
    }

    setup(T) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.outputColorSpace = T.SRGBColorSpace;
      Object.assign(renderer.domElement.style, { display: 'block', position: 'absolute', inset: '0', width: '100%', height: '100%' });
      this.appendChild(renderer.domElement);
      this._renderer = renderer;

      const scene = new T.Scene();
      scene.fog = new T.Fog(0x14161a, 14, 30);
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

      const rr = (w, h, r) => {
        const s = new T.Shape(), x = -w / 2, y = -h / 2;
        s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
        s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2);
        s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
        s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
        return s;
      };
      const extrude = (w, h, r) => {
        const g = new T.ExtrudeGeometry(rr(w, h, r), { depth: 1.05, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.12, bevelSegments: 6, curveSegments: 28 });
        g.center();
        return g;
      };
      const mk = (geo, hex) => {
        const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: hex, roughness: 0.42, metalness: 0.04 }));
        m.castShadow = true; m.receiveShadow = true;
        m.userData.base = new T.Color(hex);
        return m;
      };
      const pierGeo = extrude(1.06, 2.96, 0.43);
      const arch = new T.Group();
      const left = mk(pierGeo, '#3A5BD9');
      const right = mk(pierGeo, '#18937F');
      const keyst = mk(extrude(1.56, 1.06, 0.38), '#E0603C');
      const LEAN = (10 * Math.PI) / 180;
      const base = { left: new T.Vector3(-1.35, -0.8, 0), right: new T.Vector3(1.35, -0.8, 0), key: new T.Vector3(0, 1.75, 0) };
      arch.add(left, right, keyst);
      scene.add(arch);
      const DIM = new T.Color('#2A2D33');

      const ring = new T.Mesh(new T.RingGeometry(0.9, 1.0, 96), new T.MeshBasicMaterial({ color: 0xe0603c, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = GROUND_Y + 0.02;
      scene.add(ring);
      let pulseAt = -1;

      const N = 320, Z0 = -9, Z1 = 7;
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), spd = new Float32Array(N);
      const hues = [new T.Color('#F5F4F1'), new T.Color('#F5F4F1'), new T.Color('#F5F4F1'), new T.Color('#6E8AF0'), new T.Color('#3FC2A8'), new T.Color('#F0845F')];
      for (let i = 0; i < N; i++) {
        const y = GROUND_Y + 0.15 + Math.random() * 2.7;
        const t = (y - GROUND_Y) / 3.1;
        const half = 0.32 + 0.55 * (1 - t);
        pos[i * 3] = (Math.random() * 2 - 1) * half;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = Z0 + Math.random() * (Z1 - Z0);
        const c = hues[(Math.random() * hues.length) | 0];
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        spd[i] = 0.6 + Math.random() * 0.9;
      }
      const pGeo = new T.BufferGeometry();
      pGeo.setAttribute('position', new T.BufferAttribute(pos, 3));
      pGeo.setAttribute('color', new T.BufferAttribute(col, 3));
      const pMat = new T.PointsMaterial({ size: 0.055, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
      const points = new T.Points(pGeo, pMat);
      scene.add(points);

      let W = 1, H = 1;
      const resize = () => {
        W = Math.max(1, this.clientWidth); H = Math.max(1, this.clientHeight);
        renderer.setSize(W, H, false);
        camera.aspect = W / H;
        if (W / H > 1.2) camera.setViewOffset(W, H, -W * 0.2, 0, W, H);
        else camera.setViewOffset(W, H, 0, H * 0.17, W, H);
        camera.updateProjectionMatrix();
      };
      this._ro = new ResizeObserver(resize);
      this._ro.observe(this);
      resize();

      let visible = true;
      this._io = new IntersectionObserver((e) => { visible = e[0].isIntersecting; });
      this._io.observe(this);

      const mouse = { x: 0, y: 0 }, mS = { x: 0, y: 0 };
      this._pm = (e) => { mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = (e.clientY / window.innerHeight) * 2 - 1; };
      window.addEventListener('pointermove', this._pm, { passive: true });

      const cam = { yaw: 0, y: 0.9, dist: 12.5 };
      const t0 = performance.now();
      let last = t0, locked = false, lockAt = -1, particleZ = 0;
      const introDone = reduced ? -10 : 0;

      const frame = (now) => {
        this._raf = requestAnimationFrame(frame);
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        if (!visible) return;
        const t = reduced ? 99 : (now - t0) / 1000 + introDone;
        const amp = reduced ? 0 : this.motion();

        const track = this.closest('[data-arch-track]');
        let p = 0;
        if (track) { const r = track.getBoundingClientRect(); const range = r.height - window.innerHeight; p = range > 0 ? clamp(-r.top / range, 0, 1) : 0; }
        const seg = p * 4;
        const w = [0, 1, 2, 3, 4].map((k) => smooth(1.5 - Math.abs(seg - k) * 2));

        const lp = easeOutCubic((t - 0.1) / 1.0), rp = easeOutCubic((t - 0.25) / 1.0);
        const lean = easeOutBack((t - 0.75) / 0.6);
        left.position.set(base.left.x, base.left.y - 6 * (1 - lp), 0);
        right.position.set(base.right.x, base.right.y - 6 * (1 - rp), 0);
        left.rotation.z = -LEAN * lean;
        right.rotation.z = LEAN * lean;
        const kd = easeOutBack((t - 1.25) / 0.65);
        let keyY = base.key.y + 7 * (1 - kd);
        if (t > 1.25 && t < 1.95 && pulseAt < 0) pulseAt = t0 / 1000 + 1.9;

        if (w[3] > 0.85 && !locked) { locked = true; lockAt = now / 1000; }
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

        const hl = [w[1], w[2], w[3]], focus = Math.min(1, hl[0] + hl[1] + hl[2]);
        [left, right, keyst].forEach((m, i) => {
          const d = clamp(focus - hl[i], 0, 1) * 0.88;
          m.material.color.copy(m.userData.base).lerp(DIM, d);
        });

        const nowS = now / 1000;
        if (pulseAt > 0 && nowS >= pulseAt) {
          const u = (nowS - pulseAt) / 1.4;
          if (u < 1) { const s = 1 + u * 3.2; ring.scale.set(s, s, s); ring.material.opacity = 0.55 * (1 - u); }
          else { ring.material.opacity = 0; pulseAt = 0; }
        }

        const pOn = this.flag('particles', true) ? 1 : 0;
        const pTarget = pOn * (0.18 + 0.72 * w[4]) * smooth((t - 1.8) / 1.0);
        pMat.opacity += (pTarget - pMat.opacity) * (1 - Math.exp(-dt * 3));
        particleZ = dt * (1.2 + 2.2 * w[4]) * (reduced ? 0 : 1);
        if (pMat.opacity > 0.01) {
          for (let i = 0; i < N; i++) {
            let z = pos[i * 3 + 2] + particleZ * spd[i];
            if (z > Z1) z = Z0;
            pos[i * 3 + 2] = z;
          }
          pGeo.attributes.position.needsUpdate = true;
        }

        mS.x += (mouse.x - mS.x) * (1 - Math.exp(-dt * 3));
        mS.y += (mouse.y - mS.y) * (1 - Math.exp(-dt * 3));
        const tYaw = w[1] * -0.45 + w[2] * 0.45 + w[4] * 0.72 + mS.x * 0.16 * amp + Math.sin(t * 0.3) * 0.05 * amp;
        const tY = 0.9 + w[3] * 1.5 + w[4] * 1.9 - mS.y * 0.35 * amp;
        const tD = 12.5 - w[3] * 1.6 + w[4] * 0.6;
        const k = 1 - Math.exp(-dt * 3.2);
        cam.yaw += (tYaw - cam.yaw) * k; cam.y += (tY - cam.y) * k; cam.dist += (tD - cam.dist) * k;
        camera.position.set(Math.sin(cam.yaw) * cam.dist, cam.y, Math.cos(cam.yaw) * cam.dist);
        camera.lookAt(0, -0.35, 0);
        arch.position.y = Math.sin(t * 0.8) * 0.02 * amp;

        renderer.render(scene, camera);
      };
      this._raf = requestAnimationFrame(frame);
    }
  }
  if (!customElements.get('arch-scene')) customElements.define('arch-scene', ArchScene);
})();
