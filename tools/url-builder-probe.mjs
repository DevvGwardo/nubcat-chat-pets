#!/usr/bin/env node
// One-off probe: drive the URL tuner headlessly, assert live URL updates,
// capture a screenshot of the setup section. Mirrors boot-check.mjs plumbing.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = new URL("../docs", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".fbx": "application/octet-stream" };
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

const PORT = 9341;
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
   "--hide-scrollbars", "--window-size=1440,900", `--remote-debugging-port=${PORT}`,
   "--no-first-run", "--user-data-dir=/tmp/nubcat-ub-probe", "about:blank"],
  { stdio: "ignore" }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 30; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === "page");
    if (target) break;
  } catch {}
  await sleep(500);
}
if (!target) throw new Error("no debug target");

let msgId = 0;
const pending = new Map();
const errors = [];
function send(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

const BASE = "https://devvgwardo.github.io/nubcat-chat-pets/overlay/index.html";
let fail = 0;
try {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
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

  await send(ws, "Page.navigate", { url: `${origin}/index.html` });
  await sleep(2500);

  // 1. type channel + flip switches + drag sliders
  await run(`(() => {
    document.getElementById("setup").scrollIntoView();
    const input = document.getElementById("ub-channel");
    input.value = "testchannel";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    for (const id of ["ub-bubbles","ub-games","ub-flip"]) document.getElementById(id).click();
    const setSlider = (id, v) => {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setSlider("ub-max", "60");
    setSlider("ub-scale", "1.5");
    setSlider("ub-speed", "1.2");
  })()`);
  await sleep(300);
  let state = JSON.parse(await run(`JSON.stringify({
    copyText: document.querySelector('.copy-btn[data-copy-target="overlay-url"]').dataset.copyText,
    outs: Object.fromEntries(["max","scale","speed","ttl"].map(k => [k, document.getElementById('ub-'+k+'-out').textContent])),
  })`));
  // bubbles off -> bubbles=0; games off -> games=0; flip on(default off) -> flip=1
  // celebrate untouched (on, default-on) -> omitted; ttl untouched -> omitted
  const expect1 = `${BASE}?channel=testchannel&bubbles=0&games=0&flip=1&max=60&scale=1.5&speed=1.2`;
  console.log(`TUNER-SLIDE ${state.copyText === expect1 ? "OK" : "FAIL"} got=${state.copyText}`);
  console.log(`TUNER-OUTS ${state.outs.max === "60" && state.outs.scale === "1.5" && state.outs.speed === "1.2" && state.outs.ttl === "10m" ? "OK" : "FAIL"} ${JSON.stringify(state.outs)}`);
  if (state.copyText !== expect1) fail++;

  // 2. reset defaults via sliders back to default values -> params drop out
  await run(`(() => {
    const setSlider = (id, v) => {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setSlider("ub-max", "40"); setSlider("ub-scale", "1"); setSlider("ub-speed", "1");
    document.getElementById("ub-bubbles").click(); // back on
    document.getElementById("ub-games").click();   // back on
    document.getElementById("ub-flip").click();    // back off
  })()`);
  await sleep(300);
  state = JSON.parse(await run(`JSON.stringify({
    copyText: document.querySelector('.copy-btn[data-copy-target="overlay-url"]').dataset.copyText,
  })`));
  const expect2 = `${BASE}?channel=testchannel`;
  console.log(`TUNER-RESET ${state.copyText === expect2 ? "OK" : "FAIL"} got=${state.copyText}`);
  if (state.copyText !== expect2) fail++;
  if (errors.length) fail++;

  // screenshot the setup section for visual verification
  await run(`document.getElementById("setup").scrollIntoView()`);
  await sleep(600);
  const s = await send(ws, "Page.captureScreenshot", { format: "png" });
  writeFileSync("/tmp/nubcat-url-tuner.png", Buffer.from(s.data, "base64"));
  console.log("shot: /tmp/nubcat-url-tuner.png");

  chrome.kill("SIGKILL");
  server.close();
  process.exit(fail ? 1 : 0);
} finally {
  chrome.kill("SIGKILL");
  server.close();
}
