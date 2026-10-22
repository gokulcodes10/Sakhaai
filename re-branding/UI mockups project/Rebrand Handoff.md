# Sakha AI → Asphalix: code changes

The design system is token-driven (`styles/index.css` → `tailwind.config.js`), so most of the reskin is value swaps.

## 1. `apps/web/src/styles/index.css` — `:root`
```css
--ink: 20 22 26;          /* #14161A */
--paper: 245 244 241;     /* #F5F4F1 */
--surface: 255 255 255;
--raised: 236 234 230;
--line: 226 224 219;
--muted: 74 78 84;
--subtle: 138 143 148;
--accent: 58 91 217;      /* #3A5BD9 ultramarine — CTAs, links */
--accent-soft: 234 238 252;
--accent-ink: 255 255 255;
--trust: 24 147 127;      /* #18937F verdigris — governance surfaces */
--trust-soft: 227 242 239;
--keystone: 224 96 60;    /* #E0603C — eyebrows, emphasis (new) */
--iris: 122 79 212;       /* #7A4FD4 — 4th product / pricing (new) */
--shadow: 20 22 26;
```
Dark: `--ink 240 239 236`, `--paper 20 22 26`, `--surface 27 29 33`, `--raised 36 39 44`, `--line 46 49 55`, `--accent 110 138 240`, `--trust 92 196 174`.

Rename `.prose-sakha` → `.prose-body`.

## 2. `tailwind.config.js`
- `display` + `sans` → `['Archivo', 'system-ui', 'sans-serif']`. Drop Fraunces and Inter.
- Add `keystone` and `iris` colours.
- Headings stay one family; differentiate by weight 600 + negative tracking.

## 3. `apps/web/index.html`
- Google Fonts: `Archivo:wght@400;500;600;700` + JetBrains Mono.
- `theme-color` → `#F5F4F1` light / `#14161A` dark.
- Title, description, canonical and og tags → asphalix.com.
- `localStorage` key `sakha-theme` → `asphalix-theme`; read the old key once so dark-mode users keep their setting.

## 4. Logo
- `Header.jsx` / `Footer.jsx`: replace the "S" tile + "Sakha AI" with the `<Emblem />` SVG + `ASPHALIX` (600, `tracking-[0.24em]`). Drop the "Sakha InfoTech" sub-line.
- `public/favicon.svg`, `apple-touch-icon.png`, `/og/asphalix-default.png`: export from the identity kit.
- `Home.jsx`: replace the "S" watermark with the emblem panel.

## 5. `content/site-content.json` (via CMS — no deploy)
- `company.*`, `seo.*`, `footer.*`: brand name, domain and emails → asphalix.com.
- `home.hero.eyebrow` → "Asphalēs — Greek for 'not liable to fall'".
- `about.story`: rewrite "Why 'Sakha'" as "Why 'Asphalix'".
- Case-study slug `sakha-on-sakhaai` → `asphalix-on-asphalix`, with a redirect.

## 6. Decision needed: the assistant's name
The assistant is currently "Sakha" (`assistant.name`, SakhaPanel, sakhaSlice, `@sakha/*` packages, SAKHA_* env vars). Either:
- **Keep "Sakha"** as the agent's name under the Asphalix company (brand continuity; the mock does this), or
- **Rename it** (CMS copy + components + env vars).

Internal package and env names can be renamed later — visitors never see them.
