#!/usr/bin/env node
// Exercises duel + race game logic via the __nubcat debug handle after cats exist.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const url = process.argv[2] || "http://localhost:8741/index.html?mock=1&debug=1";
const PORT = 9335;
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
   "--hide-scrollbars", "--window-size=1600,900", `--remote-debugging-port=${PORT}`,
   "--no-first-run", "--user-data-dir=/tmp/nubcat-games-test2-profile", "about:blank"],
  { stdio: "ignore" }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getTarget() {
  for (let i = 0; i < 30; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const t = l.find((x)=>x.type==="page"); if (t) return t; } catch {}
    await sleep(400);
  }
  throw new Error("no target");
}
let id = 0; const pending = new Map();
function send(ws, method, params = {}) { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((res, rej)=>pending.set(i,{res,rej})); }
try {
  const t = await getTarget();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej)=>{ ws.onopen=res; ws.onerror=rej; });
  ws.onmessage = (ev)=>{ const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){ const {res,rej}=pending.get(m.id); pending.delete(m.id); m.error?rej(new Error(m.error.message)):res(m.result);} };
  const errs=[]; const orig=ws.onmessage;
  ws.onmessage=(ev)=>{ const m=JSON.parse(ev.data); if(m.method==="Runtime.exceptionThrown") errs.push(m.params.exceptionDetails?.exception?.description||"exc"); if(m.method==="Runtime.consoleAPICalled"&&m.params.type==="error") errs.push(m.params.args.map(a=>a.value??a.description).join(" ").slice(0,200)); orig(ev); };
  await send(ws,"Page.enable"); await send(ws,"Runtime.enable");
  await send(ws,"Page.navigate",{url});
  const run = async (expr)=>{ const r=await send(ws,"Runtime.evaluate",{expression:expr,returnByValue:true,awaitPromise:true}); return r.result.value; };
  for (let i=0;i<40;i++){ await sleep(500); const n=await run(`window.__nubcat?window.__nubcat.manager.cats.size:0`); if(n>=8) break; }

  const out = {};
  out.duel = await run(`(() => { const g=window.__nubcat.games, m=window.__nubcat.manager; const [k,c]=[...m.cats][0]; g.startDuel(c.name, c, k, performance.now()); return g.active.name+":"+g.active.phase+":"+g.active.aName+"vs"+g.active.bName; })()`);
  out.duelCharge = await run(`(() => { const g=window.__nubcat.games; const a=g.active; a.phase="charge"; a.t=0; for(let i=0;i<200;i++){ g.update(0.05, performance.now()+i*50); if(g.active?.phase==="clash") break; } return "phase="+g.active.phase+" winner="+(g.active.winner?g.active.winner.name:"pending"); })()`);
  out.duelClash = await run(`(() => { const g=window.__nubcat.games; const a=g.active; for(let i=0;i<200;i++){ g.update(0.05, performance.now()+i*50); if(!g.active) break; } return "active="+(g.active?"yes":"cleared"); })()`);
  out.duelCrown = await run(`(() => { const g=window.__nubcat.games; const m=window.__nubcat.manager; let has=false; for(const c of m.cats.values()) if(c.crown) has=true; return has; })()`);

  out.race = await run(`(() => { const g=window.__nubcat.games; if(g.active) g.endGame(); g.startRace(performance.now()); return g.active.name+" runners="+g.active.runners.length; })()`);
  out.raceRun = await run(`(() => { const g=window.__nubcat.games; const a=g.active; a.phase="run"; a.finishX=0.6; a.runners.forEach(([k,c])=>{ c.root.position.x=a.finishX-0.1; }); for(let i=0;i<300;i++){ g.update(0.05, performance.now()+i*50); if(g.active?.phase==="done"||!g.active) break; } return "phase="+(g.active?g.active.phase:"cleared")+" finished="+(a.finished?a.finished.length:0); })()`);
  out.racePodium = await run(`(() => { const g=window.__nubcat.games; if(g.active){ g.update(0.05, performance.now()); for(let i=0;i<200;i++){ g.update(0.05, performance.now()+i*50); if(!g.active) break; } } return g.active?"still-active":"cleared"; })()`);

  out.boss = await run(`(() => { const g=window.__nubcat.games; g.startBoss(performance.now()); return g.active.name+" hp="+g.active.hp+" bossCat="+window.__nubcat.manager.cats.has("__boss__"); })()`);
  out.bossDefeat = await run(`(() => { const g=window.__nubcat.games; const a=g.active; a.hp=1; const [k,c]=[...window.__nubcat.manager.cats].find(x=>x[0]!=="__boss__"); g.damageBoss(c.name,c,true); return "active="+(g.active?"still":"cleared")+" bossGone="+(!window.__nubcat.manager.cats.has("__boss__")); })()`);
  out.simon = await run(`(() => { const g=window.__nubcat.games; g.simonNext=performance.now()-1; g.maybeSimon(performance.now()); if(!g.active) return "no-start"; return "simon="+g.active.cmd+" contestants="+g.active.contestants.length; })()`);

  console.log("REPORT:", JSON.stringify(out, null, 2));
  console.log("JS_ERRORS:", errs.length ? errs.join("\n") : "none");
} finally { chrome.kill("SIGKILL"); }
