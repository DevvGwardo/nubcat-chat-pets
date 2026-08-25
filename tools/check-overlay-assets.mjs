#!/usr/bin/env node
// g4 gate: serve docs/ statically, walk the overlay's local module + asset graph
// from docs/overlay/index.html, and assert every URL returns HTTP 200.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";

const ROOT = new URL("../docs", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".png": "image/png",
  ".fbx": "application/octet-stream", ".svg": "image/svg+xml", ".css": "text/css",
};

const server = createServer(async (req, res) => {
  try {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    const data = await readFile(path);
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("nope");
  }
});
await new Promise((r) => server.listen(0, r));
const origin = `http://127.0.0.1:${server.address().port}`;

async function getText(url) {
  const r = await fetch(url);
  return [r.status, await r.text()];
}

// BFS the local dependency graph starting at the overlay entry page.
const seen = new Set();
const queue = ["/overlay/index.html"];
let fail = 0;

while (queue.length) {
  const route = queue.shift();
  if (seen.has(route)) continue;
  seen.add(route);
  const [status, body] = await getText(origin + route);
  console.log(`${route} -> ${status}`);
  if (status !== 200) { fail++; continue; }

  const dir = dirname(route);
  const pageDir = "/overlay"; // entry page dir: URL-string refs resolve against this
  if (extname(route) === ".js" || route.endsWith(".html")) {
    // ESM imports with ./ ../ prefixes are module-relative; loader URL strings
    // like "assets/cat.fbx" have no prefix and resolve against the page URL.
    const refs = [
      ...[...body.matchAll(/(?:from\s+|import\s+)["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]),
      ...[...body.matchAll(/["']((?:assets|\.{1,2}\/src|\.{1,2}\/assets)\/[^"']+\.(?:js|png|fbx))["']/g)].map((m) => m[1]),
    ];
    for (const ref of refs) {
      const base =
        route.endsWith(".js") && ref.startsWith(".") ? dir : pageDir;
      const abs = normalize(join(base, ref));
      queue.push(abs.startsWith("/") ? abs : "/" + abs);
    }
  }
}
server.close();

// g13: the repo-root overlay copy (index.html + src/) must stay in sync with
// the canonical docs/overlay copy — a silent drift here means the direct/OBS
// hosted overlay serves stale styles or an older render loop.
const REPO_ROOT = new URL("../", import.meta.url).pathname;
const OVERLAY_SRC = ["cat.js", "chat.js", "config.js", "fx.js", "games.js",
  "main.js", "manager.js", "mock.js", "points.js", "scene.js"];
let syncFail = 0;
const norm = (s) => s.replace(/\s+/g, "");

{
  const [rootHtml, docsHtml] = await Promise.all([
    readFile(REPO_ROOT + "index.html", "utf8").catch(() => ""),
    readFile(REPO_ROOT + "docs/overlay/index.html", "utf8").catch(() => ""),
  ]);
  const ok = rootHtml && docsHtml && norm(rootHtml) === norm(docsHtml);
  console.log(`SYNC ${ok ? "OK" : "FAIL"}: index.html ${ok ? "===" : "!== (drifted)"} docs/overlay/index.html`);
  if (!ok) syncFail++;
}
for (const f of OVERLAY_SRC) {
  const [a, b] = await Promise.all([
    readFile(`${REPO_ROOT}src/${f}`, "utf8").catch(() => null),
    readFile(`${REPO_ROOT}docs/overlay/src/${f}`, "utf8").catch(() => null),
  ]);
  const ok = a !== null && a === b;
  console.log(`SYNC ${ok ? "OK" : "FAIL"}: src/${f} ${ok ? "===" : "!== (drifted)"} docs/overlay/src/${f}`);
  if (!ok) syncFail++;
}

if (fail || syncFail) {
  if (fail) console.log(`FAILED: ${fail} URL(s) not 200`);
  if (syncFail) console.log(`FAILED: ${syncFail} overlay-copy sync mismatch(es)`);
  process.exit(1);
}
console.log("OVERLAY ASSETS OK");
