#!/usr/bin/env node
// MUYU-365 bundle report: gzip bytes of what a default (chatUi=vue) visit to /chat and /c/:id
// loads, versus the lazily loaded React chat closure. Usage: node scripts/muyu365-bundle-size.mjs [dist] [baseDist]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const gz = (file) => gzipSync(readFileSync(file)).length;
const kb = (n) => `${(n / 1024).toFixed(2)} KB`;

function report(dist) {
  const assets = join(dist, "assets");
  const files = readdirSync(assets);
  const find = (prefix) => files.filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".js"));
  // Static imports only (`import{..}from"./x.js"` / `import"./x.js"`); dynamic import() is lazy.
  const closure = (roots) => {
    const seen = new Set();
    const walk = (f) => {
      if (seen.has(f)) return;
      seen.add(f);
      const src = readFileSync(join(assets, f), "utf8");
      for (const m of src.matchAll(/(?:^|[;\n}])\s*import\s*(?:[^"'();]*?from\s*)?["']\.\/([^"']+\.js)["']/g)) walk(m[1]);
    };
    roots.forEach(walk);
    return seen;
  };
  const sum = (set) => [...set].reduce((n, f) => n + gz(join(assets, f)), 0);
  const all = files.filter((f) => f.endsWith(".js")).reduce((n, f) => n + gz(join(assets, f)), 0);
  const entry = closure([...find("index"), ...find("main")]);
  const chat = closure([...entry, ...find("Home"), ...find("Conversation")]);
  const home = sum(closure([...entry, ...find("Home")]));
  const conv = sum(closure([...entry, ...find("Conversation")]));
  const reactRoots = [...find("ChatHost"), ...find("mount")];
  const react = reactRoots.length ? closure(reactRoots) : new Set();
  const reactOnly = new Set([...react].filter((f) => !chat.has(f)));
  return { all, entry: sum(entry), home, conv, chatDefault: sum(chat), reactOnly: sum(reactOnly), reactFiles: [...reactOnly] };
}

const [dist = "dist", base] = process.argv.slice(2);
const now = report(dist);
console.log(`all JS              ${kb(now.all)}`);
console.log(`default entry       ${kb(now.entry)}`);
console.log(`default /chat        ${kb(now.home)}`);
console.log(`default /c/:id       ${kb(now.conv)}`);
console.log(`default chat routes ${kb(now.chatDefault)}`);
console.log(`React island extra  ${kb(now.reactOnly)}  (${now.reactFiles.join(", ")})`);
if (base && existsSync(base)) {
  const was = report(base);
  console.log(`baseline /chat ${kb(was.home)} delta ${now.home - was.home} B; /c/:id ${kb(was.conv)} delta ${now.conv - was.conv} B; entry delta ${now.entry - was.entry} B`);
  console.log(`baseline default chat routes ${kb(was.chatDefault)}  delta ${now.chatDefault - was.chatDefault} B`);
  console.log(`baseline all JS              ${kb(was.all)}  delta ${kb(now.all - was.all)}`);
}
