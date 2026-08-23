#!/usr/bin/env node
// g2 + g3 gate: every internal href="#anchor" on docs/index.html must match an id,
// and every local href/src must resolve to a real file under docs/.
import { readFile, stat } from "node:fs/promises";
import { join, normalize } from "node:path";

const ROOT = new URL("../docs", import.meta.url).pathname;
const html = await readFile(join(ROOT, "index.html"), "utf8");

let fail = 0;

// --- anchors ---
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
for (const href of hrefs) {
  if (href.startsWith("#")) {
    const id = href.slice(1);
    if (!new RegExp(`id="${id}"`).test(html)) {
      console.log(`MISSING ANCHOR: ${href}`); fail++;
    }
  } else if (!/^https?:/.test(href)) {
    const file = normalize(join(ROOT, href.split("?")[0].split("#")[0]));
    try { await stat(file); } catch { console.log(`MISSING FILE: ${href}`); fail++; }
  }
}

// --- localhost leakage (links only; prose/code mentions of self-hosting are allowed) ---
if (/(href|src)="[^"]*(localhost|127\.0\.0\.1)/.test(html)) { console.log("LOCALHOST LINK FOUND"); fail++; }

if (fail) process.exit(1);
console.log("ALL ANCHORS OK");
