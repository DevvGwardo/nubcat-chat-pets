import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { config } from "./config.js";
import { createScene } from "./scene.js";
import { prepareCatPrototype } from "./cat.js";
import { PetManager } from "./manager.js";
import { TwitchChat } from "./chat.js";
import { MockChat } from "./mock.js";
import { GameDirector } from "./games.js";
import { Points } from "./points.js";

const hud = document.getElementById("hud");
const hudStatus = () => hud.dataset.status || "";
function setHud(status) {
  if (status !== undefined) hud.dataset.status = status;
  hud.textContent = `${hudStatus()} · ${manager ? manager.stats() : "loading…"} · ${fpsText}`;
}

if (config.debug) document.body.classList.add("debug");
// Verification/debug handle: lets headless tools inspect live scene state.
if (config.debug)
  window.__nubcat = {
    get manager() { return manager; },
    get games() { return games; },
    Points,
  };

const stage = document.getElementById("stage");
const overlayEl = document.getElementById("overlay");

const { renderer, scene, camera, groundBounds, projectToScreen } =
  createScene(stage);

const manager = new PetManager({
  scene,
  overlayEl,
  config,
  projectToScreen,
});

// Mini games (duels, races, boss battles, simon says) + shared FX.
let games = null;
if (config.games) {
  games = new GameDirector({ scene, manager, config });
  manager.games = games;
}

// --- load the cat model ---------------------------------------------------
async function boot() {
  const loader = new FBXLoader();
  manager.proto = await prepareCatPrototype(loader, "assets/cat.fbx", "assets/texture.png");
  // ?scale= multiplier — everything downstream reads these two numbers.
  manager.proto.unitScale *= config.scale;
  manager.proto.height *= config.scale;
  // 130px inset keeps name labels inside the frame at the roam-area edges.
  manager.setBounds(groundBounds(130));

  const handlers = {
    onMessage: (m) => manager.handleMessage(m, performance.now()),
    onNotice: (n) => manager.handleNotice(n, performance.now()),
    onStatus: (s) => setHud(s),
  };

  if (config.mock) {
    setHud("mock chat");
    // Drop simulated messages while the render loop is paused (hidden tab,
    // off-screen demo, reduced-motion) — otherwise cats/hearts accumulate
    // invisibly with no frames running to clean them up. Real chat is never
    // gated: a returning streamer wants the crowd to have kept chatting.
    const gated = (fn) => (msg) => { if (running) fn(msg); };
    new MockChat({
      onMessage: gated(handlers.onMessage),
      onNotice: gated(handlers.onNotice),
      onStatus: handlers.onStatus,
    }).start();
  } else if (config.channel) {
    new TwitchChat(config.channel, handlers).connect();
  } else {
    setHud("no channel — add ?channel=yourname (or ?mock=1)");
  }
}

// Keep the roam area matched to the visible ground.
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (manager.proto) manager.setBounds(groundBounds(130));
  }, 150);
});

// --- render loop ------------------------------------------------------------
// The loop pauses when the browser stops rendering us (hidden tab / minimized
// window) and resumes the moment we're visible again. No frames are burned
// while nobody can see them — keeps CPU/GPU at zero for background tabs like
// the embedded landing demo, instead of spinning an invisible scene at 60fps.
const clock = new THREE.Clock();
let fpsAccum = 0;
let fpsFrames = 0;
let fpsText = "…";
let hudTimer = 0;
let rafId = 0;
let running = false;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();
  if (manager.proto) manager.update(dt, now);
  if (games) games.fx.update(dt);

  // Camera shake (base position is set in scene.js; jitter around it).
  const baseCamY = 9.5, baseCamZ = 13;
  let sx = 0, sy = 0;
  if (games && games.fx.shakeT > 0) {
    const f = games.fx;
    const k = f.shakeT / (f.shakeDur || 0.4);
    sx = (Math.random() - 0.5) * f.shakeMag * k;
    sy = (Math.random() - 0.5) * f.shakeMag * k;
  }
  camera.position.set(sx, baseCamY + sy, baseCamZ);
  camera.lookAt(0, 0.6, 0);
  renderer.render(scene, camera);

  fpsAccum += dt;
  fpsFrames++;
  hudTimer += dt;
  if (hudTimer > 1.5 && config.debug) {
    fpsText = `${Math.round(fpsFrames / fpsAccum)} fps`;
    fpsAccum = 0;
    fpsFrames = 0;
    hudTimer = 0;
    setHud();
    // Headless-verification hook: stats readable via --dump-dom.
    document.title =
      `pets=${manager.cats.size} bubbles=${manager.bubbles.length} hearts=${manager.hearts.length}` +
      ` game=${games ? games.stateText : "off"}` +
      ` fx=${games ? games.fx.sprites.length : 0}`;
  }
  rafId = requestAnimationFrame(frame);
}

function resumeLoop() {
  if (running) return;
  running = true;
  clock.getDelta(); // discard the stale delta accumulated while paused
  rafId = requestAnimationFrame(frame);
}

function pauseLoop() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(rafId);
}

function syncVisibility() {
  if (document.visibilityState === "hidden") pauseLoop();
  else resumeLoop();
}

// Pause when the browser stops rendering us, resume when it starts again.
// Run once at startup so a restored hidden tab stays paused until shown.
document.addEventListener("visibilitychange", syncVisibility);
syncVisibility();

// Parent pages (e.g. the landing demo) can pause us when we're scrolled out
// of view — same pause/resume path as the visibility handler.
window.addEventListener("message", (ev) => {
  if (ev.data && ev.data.type === "nubcat-set-paused") {
    if (ev.data.paused) pauseLoop();
    else resumeLoop();
  }
});
boot();
