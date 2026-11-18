#!/usr/bin/env node
/* =============================================================================
   PLUGIN UI KIT — BUILD
   A Figma plugin UI must be ONE self-contained HTML file: the iframe has no
   file access, so <link href="tokens.css"> and <script src="kit.js"> never
   resolve. This script inlines them.

   Directive, anywhere in a .src.html file:
       <!-- kit:include src/tokens.css -->
     .css  -> wrapped in <style>
     .js   -> wrapped in <script>
     other -> pasted verbatim (use for icons.html)

   Usage:
       node build.mjs                 # build every *.src.html -> dist/
       node build.mjs --minify        # strip comments + collapse whitespace
       node build.mjs --watch         # rebuild on change
   ============================================================================= */

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { dirname, join, resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const MINIFY = process.argv.includes("--minify");
const WATCH = process.argv.includes("--watch");
const INCLUDE = /^[ \t]*<!--[ \t]*kit:include[ \t]+([^\s>]+)[ \t]*-->[ \t]*$/gm;

// Figma rejects very large plugin bundles; warn well before that.
const WARN_BYTES = 1.5 * 1024 * 1024;

async function expand(file, seen = new Set()) {
  const abs = resolve(file);
  if (seen.has(abs)) throw new Error(`circular include: ${abs}`);
  seen.add(abs);
  const source = await readFile(abs, "utf8");

  const parts = [];
  let last = 0;
  for (const m of source.matchAll(INCLUDE)) {
    parts.push(source.slice(last, m.index));
    last = m.index + m[0].length;
    const target = resolve(ROOT, m[1]);
    const body = await expand(target, new Set(seen));
    const ext = extname(target).toLowerCase();
    const label = m[1];
    if (ext === ".css") {
      parts.push(`  <style>/* ${label} */\n${indent(MINIFY ? minifyCss(body) : body, 4)}\n  </style>`);
    } else if (ext === ".js") {
      parts.push(`  <script>/* ${label} */\n${indent(body, 4)}\n  </script>`);
    } else {
      parts.push(body);
    }
  }
  parts.push(source.slice(last));
  return parts.join("");
}

const indent = (text, n) =>
  text.replace(/\s+$/, "").split("\n").map((l) => (l.trim() ? " ".repeat(n) + l : "")).join("\n");

const minifyCss = (css) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

async function buildOne(srcPath) {
  const out = join(DIST, basename(srcPath).replace(/\.src\.html$/, ".html"));
  const html = await expand(srcPath);
  await mkdir(DIST, { recursive: true });
  await writeFile(out, html, "utf8");
  const { size } = await stat(out);
  const kb = (size / 1024).toFixed(1);
  const flag = size > WARN_BYTES ? "  ⚠ large — subset your embedded font" : "";
  console.log(`  ${basename(srcPath)} -> dist/${basename(out)}  (${kb} kB)${flag}`);
  return out;
}

async function buildAll() {
  const here = await readdir(ROOT, { withFileTypes: true });
  const roots = here.filter((e) => e.isFile() && e.name.endsWith(".src.html")).map((e) => join(ROOT, e.name));
  const tpl = join(ROOT, "templates");
  for (const e of await readdir(tpl)) if (e.endsWith(".src.html")) roots.push(join(tpl, e));
  if (!roots.length) return console.log("no *.src.html entries found");
  console.log(`building ${roots.length} entr${roots.length === 1 ? "y" : "ies"}${MINIFY ? " (minified)" : ""}`);
  for (const r of roots) await buildOne(r);
}

await buildAll();

if (WATCH) {
  console.log("watching src/, templates/ and *.src.html …");
  let timer = null;
  const queue = () => {
    clearTimeout(timer);
    timer = setTimeout(() => buildAll().catch((e) => console.error(e.message)), 80);
  };
  for (const dir of [ROOT, join(ROOT, "src"), join(ROOT, "templates")]) {
    watch(dir, { persistent: true }, (_, f) => {
      if (f && /\.(css|js|html)$/.test(f) && !f.startsWith("dist")) queue();
    });
  }
}
