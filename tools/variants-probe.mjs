#!/usr/bin/env node
// One-off: assert all three nub variants load and spawn mixed, then screenshot.
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";

try { execSync("pkill -9 -f 'remote-debugging-port=9347'"); } catch {}

const ROOT = new URL("../docs", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".fbx": "application/octet-stream" };
const server = createServer(async (req, res) => {
  try {
    const data = await readFile(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    res.writeHead(200, { "content-type": TYPES[extname(req.url.split("?")[0])] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const origin = `http://127.0.0.1:${server.address().port}`;
const PORT = 9347;
const PROFILE = `${tmpdir()}/nubcat-variants-${Date.now()}`;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
   "--hide-scrollbars", "--disable-http-cache", "--window-size=1600,900",
   `--remote-debugging-port=${PORT}`, "--no-first-run", `--user-data-dir=${PROFILE}`, "about:blank"],
  { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 30; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = l.find((t) => t.type === "page");
    if (target) break;
  } catch {}
  await sleep(400);
}
let msgId = 0; const pending = new Map(); const errors = [];
function send(ws, method, params = {}) {
  const id = ++msgId; ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
let fail = 0;
try {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails?.exception?.description || "").slice(0, 200));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
  };
  await send(ws, "Page.enable"); await send(ws, "Runtime.enable");
  const run = async (e) => (await send(ws, "Runtime.evaluate", { expression: e, returnByValue: true })).result.value;

  await send(ws, "Page.navigate", { url: `${origin}/overlay/index.html?mock=1&debug=1` });
  let cats = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    cats = (await run(`window.__nubcat ? window.__nubcat.manager.cats.size : 0`)) || 0;
    if (cats >= 8) break;
  }
  // Which rig is each cat using? Root_hip = new nub rig, body = classic.
  const mix = await run(`(() => {
    if (!window.__nubcat || !window.__nubcat.manager) return null;
    const counts = {};
    for (const c of window.__nubcat.manager.cats.values()) {
      const k = c.bones["leg.L"] ? "nub-rig" : (c.bones["body"]?.name === "body" || c.bones["head"] ? "classic-rig" : "unmapped");
      counts[k] = (counts[k] || 0) + 1;
    }
    return JSON.stringify(counts);
  })()`);
  if (!mix) { console.log("VARIANTS FAIL: no __nubcat handle"); process.exit(1); }
  const variantsLoaded = await run(`window.__nubcat.manager.protos ? JSON.stringify(window.__nubcat.manager.protos.map(p => p.boneMap && p.boneMap.head)) : "no-protos"`);
  console.log(`VARIANTS ${cats >= 8 && errors.length === 0 ? "OK" : "FAIL"} cats=${cats} loaded=${JSON.stringify(variantsLoaded)} mix=${JSON.stringify(mix)} errors=${errors.length ? errors.join(" | ") : "none"}`);
  // All three prototypes must have resolved a bone map; cats must be mixed across rigs.
  const okMaps = typeof variantsLoaded === "string" && variantsLoaded.split(",").filter(x => x !== "null").length === 3 && variantsLoaded.includes("head") && (variantsLoaded.match(/Head/g) || []).length === 2;
  const mixObj = JSON.parse(mix); const mixed = (mixObj["nub-rig"] || 0) > 0 && (mixObj["classic-rig"] || 0) > 0;
  console.log(`MAPS ${okMaps ? "OK" : "FAIL"} all-3-resolved=${okMaps}`);
  console.log(`MIX ${mixed ? "OK" : "WARN"} both-rigs-on-screen=${mixed} (random — retry if warn)`);
  if (!okMaps || errors.length || cats < 8) fail++;
  if (!mixed) fail++; // 8+ random picks from 3 variants: P(no classic or no nub) ~ tiny

  await sleep(3000);
  const s = await send(ws, "Page.captureScreenshot", { format: "png" });
  writeFileSync("/tmp/nubcat-variants.png", Buffer.from(s.data, "base64"));
  console.log("shot: /tmp/nubcat-variants.png");
  chrome.kill("SIGKILL"); server.close();
  rmSync(PROFILE, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error("PROBE ERROR:", e.message);
  chrome.kill("SIGKILL"); server.close();
  process.exit(1);
}
