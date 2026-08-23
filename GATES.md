# GATES — nubcat-chat-pets landing redesign (simpler + everything works)

## Gates

- [x] g1-no-external-fonts: page uses system font stack only; no Google Fonts request
  - CHECK: `grep -c "fonts.googleapis\|fonts.gstatic" docs/index.html`
  - EXPECT: `0`
  - EVIDENCE: output `0`

- [x] g2-anchors-resolve: every internal `href="#x"` on docs/index.html has a matching `id="x"`
  - CHECK: `node tools/check-links.mjs`
  - EXPECT: `ALL ANCHORS OK` and exit code 0
  - EVIDENCE: `ALL ANCHORS OK`, exit 0

- [x] g3-no-localhost-links: no href/src attribute points at localhost/127.0.0.1 (prose self-host note allowed)
  - CHECK: `node tools/check-links.mjs` (regex on href=/src= attributes only)
  - EXPECT: no `LOCALHOST LINK FOUND`
  - EVIDENCE: check passed; only remaining localhost mention is inside `<code>` in the self-host note

- [x] g4-overlay-deployed: docs/overlay/ contains index.html + src/*.js + assets (cat.fbx, texture.png); every local module/asset referenced resolves over HTTP 200 when docs/ is served statically
  - CHECK: `node tools/check-overlay-assets.mjs`
  - EXPECT: every URL `200` and final line `OVERLAY ASSETS OK`
  - EVIDENCE: 13/13 URLs -> 200 (`OVERLAY ASSETS OK`)

- [x] g5-overlay-boots-headless: loading /overlay/index.html?mock=1&debug=1 headlessly spawns cats with zero JS errors
  - CHECK: `node tools/boot-check.mjs`
  - EXPECT: `BOOT OK cats=<n> errors=none` with n >= 8
  - EVIDENCE: `BOOT OK cats=8 errors=none`

- [x] g6-scrollspy-works: scrolling to #params marks the Settings nav link active
  - CHECK: included in tools/boot-check.mjs landing phase
  - EXPECT: `SCROLLSPY OK active=params`
  - EVIDENCE: `SCROLLSPY OK active=Settings` (link text is "Settings", section id is params — correct pair)

- [x] g7-landing-renders-clean: landing page loads headless with zero console errors and produces a screenshot
  - CHECK: `node tools/boot-check.mjs` (landing phase)
  - EVIDENCE: /tmp/nubcat-landing.png + bull-vision read-back ("No obvious overlaps, broken elements, or unstyled parts"); overlay shot /tmp/nubcat-overlay.png shows checkerboard + labeled cats + HUD "mock chat · 6 pets · 48 fps", no error banners. Images inspected via bull-vision per text-only rule.

- [x] g8-footer-link-label-fixed: repo link no longer claims "(private)"
  - CHECK: `grep -c "source (private)" docs/index.html` → 0; repo link present
  - EVIDENCE: `private-label=0 repo-link=1`

- [x] g9-committed-and-live: changes committed to main and pushed; live GitHub Pages HTML contains a marker from the new design
  - CHECK: `curl -s https://devvgwardo.github.io/nubcat-chat-pets/ | grep -c "nch-redesign-v2"`
  - EXPECT: `1` or more
  - EVIDENCE: commit `5139ee8` pushed to main; live marker=1 after ~30s; hosted overlay + fbx + main.js all HTTP 200 on GitHub Pages; live boot via tools/verify.mjs → `hud:"mock chat · 20 pets · 24 fps"`, `JS_ERRORS: none`

## Notes
- Images must be viewed via `bull-vision`, never via read/attach (text-only model hard rule).
- Overlay is fully client-side; hosted copy under docs/overlay/ makes demo + hosted-OBS-setup work.
