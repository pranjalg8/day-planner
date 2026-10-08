// Browser smoke test: serves the repo, opens every tab at 420px, fails on any
// console error / page error / failed request. Not part of `npm test`.
// Playwright is resolved from PLAYWRIGHT_MODULE (default /opt/node-tools/...).
// Optional: CHROMIUM_PATH for a specific browser binary.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const modPath = process.env.PLAYWRIGHT_MODULE || "/opt/node-tools/node_modules/playwright/index.mjs";
let chromium;
try {
  ({ chromium } = await import(existsSync(modPath) ? pathToFileURL(modPath).href : "playwright"));
} catch {
  console.log(`SKIP: Playwright not available (tried ${modPath} and bare "playwright"). Set PLAYWRIGHT_MODULE to run the smoke test.`);
  process.exit(0);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) throw new Error("outside root");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
let browser;
try {
  const exe = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  try {
    browser = await chromium.launch({ executablePath: exe });
  } catch (e) {
    console.log(`SKIP: could not launch Chromium (${String(e.message).split("\n")[0]})`);
    process.exitCode = 0;
    throw null;
  }
  const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console error: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });

  await page.goto(base, { waitUntil: "load" });
  const tabs = await page.$$eval("#tabs [data-tab]", (bs) => bs.map((b) => b.dataset.tab));
  if (!tabs.length) problems.push("no tabs found");
  for (const t of tabs) {
    await page.click(`#tabs [data-tab="${t}"]`);
    const len = await page.$eval("#app", (a) => a.textContent.trim().length);
    if (len < 10) problems.push(`tab ${t} rendered empty`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (overflow) problems.push(`tab ${t} scrolls horizontally at 420px`);
    console.log(`tab ${t}: ok`);
  }
} catch (e) {
  if (e !== null) problems.push(`exception: ${e?.stack || e}`);
} finally {
  await browser?.close();
  server.close();
}
if (problems.length) {
  console.error("SMOKE FAILED:\n" + problems.map((p) => " - " + p).join("\n"));
  process.exitCode = 1;
} else if (browser) console.log("smoke ok");
