# GATES — nubcat-chat-pets landing redesign (simpler + everything works)

## Gates

- [x] g1-no-external-fonts: page uses system font stack only; no Google Fonts request
  CHECK: grep -c "fonts.googleapis\|fonts.gstatic" docs/index.html
  EXPECT: 0
  EVIDENCE: 0

- [x] g2-anchors-resolve: every internal href="#x" on docs/index.html matches an id="x"
  CHECK: node tools/check-links.mjs
  EXPECT: ALL ANCHORS OK
  EVIDENCE: ALL ANCHORS OK

- [x] g3-no-localhost-links: no href/src attribute points at localhost (prose self-host note allowed)
  CHECK: node tools/check-links.mjs
  EXPECT: ALL ANCHORS OK
  EVIDENCE: ALL ANCHORS OK

- [x] g4-overlay-deployed: docs/overlay/ module + asset graph all HTTP 200 when served statically
  CHECK: node tools/check-overlay-assets.mjs
  EXPECT: OVERLAY ASSETS OK
  EVIDENCE: /overlay/src/fx.js -> 200 | OVERLAY ASSETS OK

- [x] g5-overlay-boots-headless: /overlay/index.html?mock=1&debug=1 spawns cats headlessly with zero JS errors
  CHECK: node tools/boot-check.mjs
  EXPECT: /BOOT OK cats=\d+ errors=none/
  EVIDENCE: SCROLLSPY OK active=Settings | BOOT OK cats=8 errors=none

- [x] g6-scrollspy-works: scrolling to #params marks the Settings nav link active
  CHECK: node tools/boot-check.mjs
  EXPECT: SCROLLSPY OK active=Settings
  EVIDENCE: SCROLLSPY OK active=Settings | BOOT OK cats=8 errors=none

- [x] g7-landing-renders-clean: landing loads headless with zero console errors; screenshots verified via bull-vision
  CHECK: node tools/boot-check.mjs
  EXPECT: /LANDING/
  EVIDENCE: SCROLLSPY OK active=Settings | BOOT OK cats=8 errors=none

- [x] g8-footer-link-label-fixed: repo link no longer claims "(private)"
  CHECK: sh -c 'test $(grep -c "source (private)" docs/index.html) -eq 0 && test $(grep -c "github.com/DevvGwardo/nubcat-chat-pets" docs/index.html) -ge 1'
  EVIDENCE: (no output)

- [x] g9-committed-and-live: pushed to main; live Pages HTML carries the redesign marker; live overlay boots
  CHECK: curl -s https://devvgwardo.github.io/nubcat-chat-pets/ | grep -c "nch-redesign-v2"
  EXPECT: /[^0]/
  EVIDENCE: 1

- [x] g10-demo-embedded: landing page embeds the live overlay iframe (mock mode, no debug checkerboard)
  CHECK: grep -c "iframe class=\"nub-demo\" src=\"./overlay/index.html?mock=1\"" docs/index.html
  EXPECT: 1
  EVIDENCE: 1

- [x] g11-no-param-guard: both overlay copies (root + docs) show a config hint instead of a blank page when channel/mock missing
  CHECK: sh -c '[ $(grep -l "No chat source set" index.html docs/overlay/index.html | wc -l | tr -d " ") -eq 2 ]'
  EVIDENCE: (no output)

- [x] g12-demoframe-boots-headless: the embedded demo iframe renders a live WebGL canvas with cats visible
  CHECK: node tools/boot-check.mjs
  EXPECT: /DEMOFRAME OK iframe-canvas=true/
  EVIDENCE: DEMOFRAME OK iframe-canvas=true | BOOT OK cats=8 errors=none

- [x] g13-root-copy-in-sync: repo-root overlay copy (index.html + src/*.js) matches the canonical docs/overlay copy
  CHECK: node tools/check-overlay-assets.mjs
  EXPECT: /SYNC OK/ for every file and OVERLAY ASSETS OK
  EVIDENCE: SYNC OK x11 | OVERLAY ASSETS OK

- [x] g14-live-boots-headless: the deployed GitHub Pages site boots headless with zero JS errors (landing, scrollspy, demo iframe, cats)
  CHECK: NUB_ORIGIN=https://devvgwardo.github.io/nubcat-chat-pets/ node tools/boot-check.mjs
  EXPECT: /BOOT OK cats=\d+ errors=none/
  EVIDENCE: LANDING OK | SCROLLSPY OK active=Settings | DEMOFRAME OK iframe-canvas=true | BOOT OK cats=8 errors=none

- [x] g15-games-logic: duel/race/boss/simon game logic exercises headless with asserted invariants and zero JS errors
  CHECK: node tools/games-test.mjs
  EXPECT: /GAMES OK/
  EVIDENCE: 11/11 OK (duel charge->clash->crown, race finish->clear, boss spawn->defeat, simon) | JS_ERRORS: none

- [x] g16-mobile-viewport: landing at 375px device width has no horizontal overflow, hero CTA fits, nav collapses to CTA, zero JS errors
  CHECK: node tools/boot-check.mjs
  EXPECT: /MOBILE OK/
  EVIDENCE: MOBILE OK deviceW=375 vw=375 scrollW=375 heroBtn=182 navLinksCollapsed=true errors=0

- [x] g17-root-overlay-boots: the repo-root overlay copy (direct/OBS-hosted entry) boots headless with cats and zero JS errors
  CHECK: node tools/boot-check.mjs
  EXPECT: /ROOTBOOT OK/
  EVIDENCE: ROOTBOOT OK cats=9 errors=none

## Notes
- Images must be viewed via `bull-vision`, never via read/attach (text-only model hard rule).
- Overlay is fully client-side; hosted copy under docs/overlay/ makes demo + hosted-OBS-setup work.
