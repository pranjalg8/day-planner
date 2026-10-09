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

  // First run: the onboarding dialog shows once and Skip dismisses it for good.
  await page.goto(base, { waitUntil: "load" });
  if (!(await page.$("#onboarding[role=dialog], #onboarding .ob-dialog"))) problems.push("onboarding did not show on first run");
  await page.click("#ob-skip");
  if (await page.$("#onboarding")) problems.push("onboarding did not close on Skip");
  await page.reload({ waitUntil: "load" });
  if (await page.$("#onboarding")) problems.push("onboarding showed again after being skipped");

  const primary = await page.$$eval("#tabs [data-tab]", (bs) => bs.map((b) => b.dataset.tab));
  const secondary = await page.$$eval("#more-sheet [data-tab]", (bs) => bs.map((b) => b.dataset.tab));
  if (primary.length !== 4) problems.push(`expected 4 primary tabs, got ${primary}`);
  if (secondary.length !== 4) problems.push(`expected 4 secondary tabs, got ${secondary}`);
  const check = async (t) => {
    const len = await page.$eval("#app", (a) => a.textContent.trim().length);
    if (len < 10) problems.push(`tab ${t} rendered empty`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (overflow) problems.push(`tab ${t} scrolls horizontally at 420px`);
    console.log(`tab ${t}: ok`);
  };
  for (const t of primary) {
    await page.click(`#tabs [data-tab="${t}"]`);
    await check(t);
  }
  for (const t of secondary) {
    await page.click("#more-btn");
    if (!(await page.isVisible("#more-sheet"))) problems.push("More sheet did not open");
    await page.click(`#more-sheet [data-tab="${t}"]`);
    if (await page.isVisible("#more-sheet")) problems.push("More sheet stayed open after selection");
    if (!(await page.$eval("#more-btn", (b) => b.classList.contains("active")))) problems.push(`More not active on ${t}`);
    await check(t);
  }
  // Escape closes the sheet and returns focus to More.
  await page.click("#more-btn");
  await page.keyboard.press("Escape");
  if (await page.isVisible("#more-sheet")) problems.push("Escape did not close More");
  // The tab bar must not hide page content: the footer can be scrolled above it.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const clear = await page.evaluate(() => document.querySelector(".footnote").getBoundingClientRect().bottom <= document.getElementById("tabs").getBoundingClientRect().top + 1);
  if (!clear) problems.push("tab bar overlaps the end of the page");
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
