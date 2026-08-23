#!/usr/bin/env node
// g5 + g6 + g7 gates: load the landing page and the hosted overlay in headless Chrome.
// Landing: zero console errors + scrollspy marks #params' nav link active.
// Overlay (?mock=1&debug=1): >= 8 cats spawn via window.__nubcat with zero JS errors.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { extname, join } from "node:path";

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
// NUB_ORIGIN overrides the local server (e.g. to check production).
const origin = process.env.NUB_ORIGIN || `http://127.0.0.1:${server.address().port}`;

const PORT = 9339;
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
   "--hide-scrollbars", "--window-size=1440,900", `--remote-debugging-port=${PORT}`,
   "--no-first-run", "--user-data-dir=/tmp/nubcat-boot-profile", "about:blank"],
  { stdio: "ignore" }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error("no debug target");
}

let msgId = 0;
const pending = new Map();
function send(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

let fail = 0;
try {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
    if (m.method === "Runtime.exceptionThrown")
      errors.push((m.params.exceptionDetails?.exception?.description || "exception").slice(0, 200));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      errors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
  };
  await send(ws, "Page.enable");
  await send(ws, "Runtime.enable");
  const run = async (expr) =>
    (await send(ws, "Runtime.evaluate", { expression: expr, returnByValue: true })).result.value;
  const shotTo = async (path) => {
    const s = await send(ws, "Page.captureScreenshot", { format: "png" });
    writeFileSync(path, Buffer.from(s.data, "base64"));
  };

  // ---- phase A: landing ----
  await send(ws, "Page.navigate", { url: `${origin}/index.html` });
  await sleep(2500);
  const landing = JSON.parse(await run(`JSON.stringify({
    title: document.title,
    heroDemo: document.querySelector(".hero-actions .btn-primary")?.getAttribute("href"),
    sections: ["games","setup","params","faq","demo"].every(id => !!document.getElementById(id)),
  })`));
  const heroOk = landing.heroDemo === "./overlay/index.html?mock=1";
  console.log(`LANDING ${heroOk && landing.sections ? "OK" : "FAIL"}:`, JSON.stringify(landing));
  if (!heroOk || !landing.sections) fail++;
  await shotTo("/tmp/nubcat-landing.png");

  // scrollspy check
  await run(`document.getElementById("params").scrollIntoView()`);
  await sleep(900);
  const active = await run(
    `document.querySelector(".nav-links a.active:not(.nav-cta)")?.textContent || "none"`
  );
  console.log(`SCROLLSPY ${active === "Settings" ? "OK" : "FAIL"} active=${active}`);
  if (active !== "Settings") fail++;

  // embedded live demo boots inside the iframe (same-origin access)
  await run(`document.getElementById("demo").scrollIntoView()`);
  let frameCanvas = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    frameCanvas = await run(
      `(() => { try { const f = document.querySelector("iframe.nub-demo");
         return !!(f && f.contentWindow && f.contentWindow.document && f.contentWindow.document.querySelector("canvas")); } catch { return false; } })()`
    );
    if (frameCanvas) break;
  }
  console.log(`DEMOFRAME ${frameCanvas ? "OK" : "FAIL"} iframe-canvas=${frameCanvas}`);
  if (!frameCanvas) fail++;
  await sleep(4000); // let cats spawn before the screenshot
  await shotTo("/tmp/nubcat-demo-frame.png");

  // ---- phase B: overlay boot in mock mode ----
  errors.length = 0;
  await send(ws, "Page.navigate", { url: `${origin}/overlay/index.html?mock=1&debug=1` });
  let cats = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    cats = (await run(`window.__nubcat ? window.__nubcat.manager.cats.size : 0`)) || 0;
    if (cats >= 8) break;
  }
  console.log(`BOOT ${cats >= 8 && errors.length === 0 ? "OK" : "FAIL"} cats=${cats} errors=${errors.length ? errors.join(" | ") : "none"}`);
  if (cats < 8 || errors.length) fail++;
  await shotTo("/tmp/nubcat-overlay.png");

  chrome.kill("SIGKILL");
  server.close();
  process.exit(fail ? 1 : 0);
} finally {
  chrome.kill("SIGKILL");
  server.close();
}
