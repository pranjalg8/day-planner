// Light / Dark / Auto theme. Choice persisted in localStorage ("elevate-planner-theme"
// is deliberately outside the "elevate-planner:" prefix so backups don't carry it).
const KEY = "elevate-planner-theme";
const ORDER = ["auto", "light", "dark"];
const LABEL = { auto: "Auto", light: "Light", dark: "Dark" };

function read() {
  try { const v = localStorage.getItem(KEY); return ORDER.includes(v) ? v : "auto"; } catch { return "auto"; }
}

function apply(mode) {
  const root = document.documentElement;
  if (mode === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  const dark = mode === "dark" || (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#17130f" : "#d9603b");
}

let mode = read();
apply(mode);

const btn = document.createElement("button");
btn.type = "button";
btn.className = "theme-toggle secondary";
function paint() {
  btn.textContent = `Theme: ${LABEL[mode]}`;
  btn.setAttribute("aria-label", `Colour theme: ${LABEL[mode]}. Activate to change.`);
}
btn.addEventListener("click", () => {
  mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
  try { localStorage.setItem(KEY, mode); } catch {}
  apply(mode);
  paint();
});
paint();
document.querySelector(".topbar")?.appendChild(btn);
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => apply(mode));
