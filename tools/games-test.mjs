#!/usr/bin/env node
// Exercises duel + race + boss + simon game logic via the __nubcat debug
// handle after cats exist, and ASSERTS the key invariants (fails on mismatch).
// Self-serves docs/ statically — no external server needed (the old version
// defaulted to localhost:8741 and silently no-oped with an empty report).
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";

// Kill any orphaned headless Chrome from a previous crashed run — a stale
// page in an orphan (same debug port + profile) produces phantom errors.
try { execSync("pkill -9 -f 'remote-debugging-port=933'"); } catch {}
await new Promise((r) => setTimeout(r, 500));

const ROOT = new URL("../docs", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".png": "image/png",
  ".fbx": "application/octet-stream", ".svg": "image/svg+xml",
};
const server = createServer(async (req, res) => {
  try {
    const path = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    const data = await readFile(path);
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const origin = `http://127.0.0.1:${server.address().port}`;

const PORT = 9335;
// Unique profile per run — a fixed dir risks a stale disk cache or a lock
// left by a killed run.
const PROFILE = `${tmpdir()}/nubcat-games-${process.pid}-${Date.now()}`;
rmSync(PROFILE, { recursive: true, force: true });
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
   "--hide-scrollbars", "--disable-http-cache", "--window-size=1600,900",
   `--remote-debugging-port=${PORT}`, "--no-first-run", `--user-data-dir=${PROFILE}`,
   "about:blank"],
  { stdio: "ignore" }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = l.find((x) => x.type === "page");
      if (t) return t;
    } catch {}
    await sleep(400);
  }
  throw new Error("no target");
}

let id = 0;
const pending = new Map();
function send(ws, method, params = {}) {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((res, rej) => pending.set(i, { res, rej }));
}

let fail = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? "OK" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) fail++;
};

try {
  const t = await getTarget();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const errs = [];
  const orig = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
    if (m.method === "Runtime.exceptionThrown")
      errs.push(JSON.stringify({ msg: m.params.exceptionDetails?.exception?.description || "exc", url: m.params.exceptionDetails?.url, line: m.params.exceptionDetails?.lineNumber }).slice(0, 250));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      errs.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
  };
  await send(ws, "Page.enable");
  await send(ws, "Runtime.enable");
  await send(ws, "Page.navigate", { url: `${origin}/overlay/index.html?mock=1&debug=1` });
  const run = async (expr) => (await send(ws, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  let n = 0;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    n = (await run(`window.__nubcat ? window.__nubcat.manager.cats.size : 0`)) || 0;
    if (n >= 8) break;
  }
  check("cats-seeded", n >= 8, `cats=${n}`);

  const out = {};
  out.duel = await run(`(() => { const g=window.__nubcat.games, m=window.__nubcat.manager; const [k,c]=[...m.cats][0]; g.startDuel(c.name, c, k, performance.now()); return g.active.name+":"+g.active.phase+":"+g.active.aName+"vs"+g.active.bName; })()`);
  check("duel-starts", /^duel:/.test(out.duel || ""), out.duel);
  out.duelCharge = await run(`(() => { const g=window.__nubcat.games; const a=g.active; a.phase="charge"; a.t=0; for(let i=0;i<200;i++){ g.update(0.05, performance.now()+i*50); if(g.active?.phase==="clash") break; } return "phase="+g.active.phase+" winner="+(g.active.winner?g.active.winner.name:"pending"); })()`);
  check("duel-charges-to-clash", /phase=clash/.test(out.duelCharge || ""), out.duelCharge);
  out.duelClash = await run(`(() => { const g=window.__nubcat.games; for(let i=0;i<200;i++){ g.update(0.05, performance.now()+i*50); if(!g.active) break; } return "active="+(g.active?"yes":"cleared"); })()`);
  check("duel-clears", /cleared/.test(out.duelClash || ""), out.duelClash);
  out.duelCrown = await run(`(() => { const g=window.__nubcat.games; const m=window.__nubcat.manager; let has=false; for(const c of m.cats.values()) if(c.crown) has=true; return has; })()`);
  check("duel-crowns-winner", out.duelCrown === true, String(out.duelCrown));

  out.race = await run(`(() => { const g=window.__nubcat.games; if(g.active) g.endGame(); g.startRace(performance.now()); return g.active.name+" runners="+g.active.runners.length; })()`);
  check("race-starts", /^race/.test(out.race || "") && /runners=[1-9]/.test(out.race || ""), out.race);
  out.raceRun = await run(`(() => { const g=window.__nubcat.games; const a=g.active; a.phase="run"; a.finishX=0.6; a.runners.forEach(([k,c])=>{ c.root.position.x=a.finishX-0.1; }); for(let i=0;i<300;i++){ g.update(0.05, performance.now()+i*50); if(g.active?.phase==="done"||!g.active) break; } return "phase="+(g.active?g.active.phase:"cleared")+" finished="+(a.finished?a.finished.length:0); })()`);
  check("race-finishes", /finished=[1-9]/.test(out.raceRun || ""), out.raceRun);
  out.racePodium = await run(`(() => { const g=window.__nubcat.games; for(let i=0;i<200;i++){ g.update(0.05, performance.now()+i*50); if(!g.active) break; } return g.active?"still-active":"cleared"; })()`);
  check("race-clears", /cleared/.test(out.racePodium || ""), out.racePodium);

  out.boss = await run(`(() => { const g=window.__nubcat.games; g.startBoss(performance.now()); return g.active.name+" hp="+g.active.hp+" bossCat="+window.__nubcat.manager.cats.has("__boss__"); })()`);
  check("boss-starts", /^boss/.test(out.boss || "") && /bossCat=true/.test(out.boss || ""), out.boss);
  out.bossDefeat = await run(`(() => { const g=window.__nubcat.games; const a=g.active; a.hp=1; const [k,c]=[...window.__nubcat.manager.cats].find(x=>x[0]!=="__boss__"); g.damageBoss(c.name,c,true); return "active="+(g.active?"still":"cleared")+" bossGone="+(!window.__nubcat.manager.cats.has("__boss__")); })()`);
  check("boss-defeated", /cleared/.test(out.bossDefeat || "") && /bossGone=true/.test(out.bossDefeat || ""), out.bossDefeat);
  out.simon = await run(`(() => { const g=window.__nubcat.games; g.simonNext=performance.now()-1; g.maybeSimon(performance.now()); if(!g.active) return "no-start"; return "simon="+g.active.cmd+" contestants="+g.active.contestants.length; })()`);
  // Simon is RNG-gated: starting is good, no-start is acceptable, throwing is not.
  check("simon-runs-or-skipped", /^(no-start|simon=)/.test(out.simon || ""), out.simon);

  console.log("JS_ERRORS:", errs.length ? errs.join(" | ") : "none");
  if (errs.length) fail++;
  chrome.kill("SIGKILL");
  server.close();
  if (fail) { console.log(`GAMES FAILED: ${fail} assertion(s)`); process.exit(1); }
  console.log("GAMES OK");
} finally {
  chrome.kill("SIGKILL");
  server.close();
}
