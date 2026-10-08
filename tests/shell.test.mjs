import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const sw = readFileSync(join(root, "sw.js"), "utf8");
const shell = new Set([...sw.slice(sw.indexOf("const SHELL"), sw.indexOf("];", sw.indexOf("const SHELL"))).matchAll(/"([^"]+)"/g)].map((m) => m[1]));

test("every shipped .js/.css/.html/.webmanifest/icon file is in sw.js SHELL", () => {
  const files = [
    ...readdirSync(root).filter((f) => /\.(js|css|html|webmanifest)$/.test(f) && f !== "sw.js"),
    ...readdirSync(join(root, "icons")).map((f) => `icons/${f}`),
  ];
  const missing = files.filter((f) => !shell.has(f));
  assert.deepEqual(missing, [], `Add to SHELL in sw.js (and bump CACHE): ${missing.join(", ")}`);
});

test("SHELL lists no nonexistent files", () => {
  const all = new Set(readdirSync(root).concat(readdirSync(join(root, "icons")).map((f) => `icons/${f}`)));
  const ghost = [...shell].filter((f) => f !== "./" && !all.has(f));
  assert.deepEqual(ghost, []);
});

test("install does not force skipWaiting; message handler does", () => {
  const install = sw.slice(sw.indexOf('"install"'), sw.indexOf('"activate"'));
  assert.ok(!install.includes("skipWaiting"));
  assert.match(sw, /SKIP_WAITING/);
});
