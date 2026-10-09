// "Share report" card (About tab): weekly Markdown report for a coach.
import { ACTIONS, WORKOUT } from "./data.js";
import { computeDay } from "./engine.js";
import { LOG_KEY, MEDS_KEY } from "./logstore.js";
import { loadHistory } from "./progress.js";
import { REPORT_FIELDS, defaultInclude, weekStartOf, weekKeys, buildWeekData, buildReport, reportFilename, keyOf } from "./reportdata.js";
import { el as h } from "./dom.js";

function readMap(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}

function gather(start) {
  const keys = weekKeys(start);
  const expectedMeds = {};
  for (const k of keys) {
    const [y, m, d] = k.split("-").map(Number);
    expectedMeds[k] = computeDay(new Date(y, m - 1, d)).filter((i) => i.category === "medicine").length;
  }
  return buildWeekData({
    start, log: readMap(LOG_KEY), taken: readMap(MEDS_KEY), history: loadHistory(), expectedMeds,
    totalSets: WORKOUT.circuit.reduce((a, e) => a + e.sets, 0),
    targets: { water: ACTIONS.waterTargetLitres, steps: ACTIONS.stepTarget },
  });
}

export function reportCard() {
  const include = defaultInclude();
  let start = weekStartOf(new Date());
  const card = h("div", { class: "card report-card", id: "report-card" });
  const weekInput = h("input", { type: "date", id: "report-week", value: keyOf(start), "aria-label": "Any day in the week to report" });
  const preview = h("pre", { class: "report-preview", id: "report-preview", "aria-live": "polite" });
  const status = h("p", { class: "muted report-status", role: "status" });
  const text = () => buildReport(gather(start), include);
  const refresh = () => { preview.textContent = text(); };

  weekInput.addEventListener("change", () => {
    if (!weekInput.value) return;
    const [y, m, d] = weekInput.value.split("-").map(Number);
    start = weekStartOf(new Date(y, m - 1, d));
    refresh();
  });

  const boxes = REPORT_FIELDS.map((f) => {
    const cb = h("input", { type: "checkbox", id: `report-inc-${f.id}`, class: "checkbox" });
    cb.checked = include[f.id];
    cb.addEventListener("change", () => { include[f.id] = cb.checked; refresh(); });
    return h("label", { class: "report-opt", for: cb.id }, [cb, ` ${f.label}`]);
  });

  const copy = h("button", { type: "button", class: "primary", onclick: async () => {
    try { await navigator.clipboard.writeText(text()); status.textContent = "Copied to clipboard."; }
    catch { status.textContent = "Copy not available here; use Download."; }
  } }, "Copy");
  const actions = [copy];
  if (typeof navigator.share === "function") {
    actions.push(h("button", { type: "button", class: "secondary", onclick: async () => {
      try { await navigator.share({ title: "Weekly report", text: text() }); } catch { /* cancelled */ }
    } }, "Share"));
  }
  actions.push(h("button", { type: "button", class: "secondary", onclick: () => {
    const blob = new Blob([text()], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: reportFilename(gather(start)) });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "Downloaded.";
  } }, "Download .md"));

  card.append(
    h("h2", {}, "Share report with coach"),
    h("p", { class: "muted" }, "Builds a weekly summary from this device. Weight is left out unless you tick it. Nothing is sent until you copy or share it."),
    h("label", { class: "report-week", for: "report-week" }, ["Week containing ", weekInput]),
    h("fieldset", { class: "report-fields" }, [h("legend", {}, "Include"), ...boxes]),
    preview,
    h("div", { class: "cal-actions" }, actions),
    status,
  );
  refresh();
  return card;
}
