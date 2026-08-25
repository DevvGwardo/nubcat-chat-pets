#!/usr/bin/env node
// One-off probe: drive the new URL builder headlessly, assert live URL updates,
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

  // type a channel + flip all toggles
  await run(`(() => {
    document.getElementById("setup").scrollIntoView();
    const input = document.getElementById("ub-channel");
    input.focus();
    input.value = "testchannel";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    for (const id of ["ub-max","ub-scale","ub-bubbles"]) document.getElementById(id).click();
  })()`);
  await sleep(300);
  const state = JSON.parse(await run(`JSON.stringify({
    display: document.getElementById("overlay-url").textContent,
    copyText: document.querySelector('.copy-btn[data-copy-target="overlay-url"]').dataset.copyText,
    pressed: Object.fromEntries(["ub-max","ub-scale","ub-bubbles"].map(id => [id, document.getElementById(id).getAttribute("aria-pressed")])),
  })`));
  console.log("BUILDER STATE:", JSON.stringify(state, null, 2));

  const expectCopy = "https://devvgwardo.github.io/nubcat-chat-pets/overlay/index.html?channel=testchannel&max=80&scale=1.2&bubbles=0";
  const okUrl = state.copyText === expectCopy &&
    state.display === expectCopy.replace(/^https:\/\//, "");
  const okPressed = state.pressed["ub-max"] === "true" && state.pressed["ub-scale"] === "true" && state.pressed["ub-bubbles"] === "false";

  // toggle bubbles back on -> param drops out
  await run(`document.getElementById("ub-bubbles").click()`);
  await sleep(200);
  const copy2 = await run(`document.querySelector('.copy-btn[data-copy-target="overlay-url"]').dataset.copyText`);
  const okOff = copy2 === "https://devvgwardo.github.io/nubcat-chat-pets/overlay/index.html?channel=testchannel&max=80&scale=1.2";

  console.log(`BUILDER ${okUrl && okPressed ? "OK" : "FAIL"} url-live=${okUrl} aria=${okPressed}`);
  console.log(`BUILDER-OFF ${okOff ? "OK" : "FAIL"} bubbles-param-drops=${okOff} got=${copy2}`);
  if (!okUrl || !okPressed || !okOff) fail++;
  if (errors.length) fail++;

  // screenshot the setup section for visual verification
  await run(`document.getElementById("setup").scrollIntoView()`);
  await sleep(600);
  const s = await send(ws, "Page.captureScreenshot", { format: "png" });
  writeFileSync("/tmp/nubcat-url-builder.png", Buffer.from(s.data, "base64"));
  console.log("shot: /tmp/nubcat-url-builder.png");

  chrome.kill("SIGKILL");
  server.close();
  process.exit(fail ? 1 : 0);
} finally {
  chrome.kill("SIGKILL");
  server.close();
}
