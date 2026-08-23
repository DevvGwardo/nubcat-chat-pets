#!/usr/bin/env node
// Real-time verification driver: loads the overlay in headless Chrome,
// waits N seconds of wall-clock time, screenshots it, and reports state.
// Usage: node verify.mjs <url> <waitSeconds> <outPng>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [url, waitSec = "25", out = "/tmp/nubcat-verify.png"] = process.argv.slice(2);
const PORT = 9333;
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--hide-scrollbars", "--window-size=1600,900",
    `--remote-debugging-port=${PORT}`, "--no-first-run", "--user-data-dir=/tmp/nubcat-chrome-profile",
    "about:blank",
  ],
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
  return new Promise((res, rej) =>
    pending.set(id, { res, rej })
  );
}

try {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  };

  await send(ws, "Page.enable");
  await send(ws, "Runtime.enable");

  // Collect console + errors for the report.
  const errors = [];
  const origHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown")
      errors.push(m.params.exceptionDetails?.exception?.description || JSON.stringify(m.params).slice(0, 300));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      errors.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
    origHandler(ev);
  };

  await send(ws, "Page.navigate", { url });
  await sleep(parseFloat(waitSec) * 1000);

  const shot = await send(ws, "Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.data, "base64"));

  const evalJs = async (expr) => {
    const r = await send(ws, "Runtime.evaluate", { expression: expr, returnByValue: true });
    return r.result.value;
  };
  const stats = await evalJs(
    `JSON.stringify({
       title: document.title,
       hud: document.getElementById("hud").textContent,
       pets: document.querySelectorAll("canvas").length ? "scene-live" : "no-canvas",
       bubbles: document.querySelectorAll(".bubble").length,
     })`
  );
  console.log("STATS:", stats);
  console.log("JS_ERRORS:", errors.length ? errors.join("\n") : "none");
  console.log("SHOT:", out);
} finally {
  chrome.kill("SIGKILL");
}
