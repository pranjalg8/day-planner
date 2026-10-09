import { ACTIONS, WORKOUT } from "./data.js";
import { dateKey, getLog, setWeight, addWater, setSteps, setSetsDone, weightHistory, GLASS_ML, glassesFor } from "./logstore.js";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SVG_NS = "http://www.w3.org/2000/svg";

function h(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

function progress(frac, label) {
  const pct = Math.min(100, Math.round(frac * 100));
  return h("div", { class: "trk-progress" }, [
    h("div", { class: "trk-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) },
      h("div", { class: `trk-fill${frac >= 1 ? " full" : ""}`, style: `width:${pct}%` })),
    h("div", { class: "muted trk-small" }, label),
  ]);
}

function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

export function weightChart(points) {
  if (points.length < 2) {
    return h("div", { class: "muted trk-small" }, points.length ? "Log one more day to see a trend." : "No weigh-ins yet.");
  }
  const W = 360, H = 150, L = 34, R = 10, T = 10, B = 22;
  const kgs = points.map((p) => p.kg);
  let min = Math.min(...kgs), max = Math.max(...kgs);
  if (max - min < 1) { min -= 0.5; max += 0.5; }
  const pad = (max - min) * 0.1;
  min -= pad; max += pad;
  const x = (i) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v) => T + ((max - v) / (max - min)) * (H - T - B);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "trk-chart", role: "img", "aria-label": `Weight trend, last ${points.length} entries` });
  for (const v of [max - pad, (max + min) / 2, min + pad]) {
    svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "trk-grid" }));
    const t = svgEl("text", { x: L - 4, y: y(v) + 3, "text-anchor": "end", class: "trk-axis" });
    t.textContent = v.toFixed(1);
    svg.appendChild(t);
  }
  svg.appendChild(svgEl("polyline", { points: points.map((p, i) => `${x(i)},${y(p.kg)}`).join(" "), class: "trk-line", fill: "none" }));
  points.forEach((p, i) => {
    const c = svgEl("circle", { cx: x(i), cy: y(p.kg), r: 3, class: "trk-dot" });
    const title = svgEl("title", {});
    title.textContent = `${p.date}: ${p.kg} kg`;
    c.appendChild(title);
    svg.appendChild(c);
  });
  for (const i of [0, points.length - 1]) {
    const t = svgEl("text", { x: x(i), y: H - 6, "text-anchor": i === 0 ? "start" : "end", class: "trk-axis" });
    t.textContent = points[i].date.slice(5);
    svg.appendChild(t);
  }
  return svg;
}

// Which day the Log tab is editing (defaults to today; kept across re-renders).
let logDate = new Date();

function shiftLogDate(delta, rerender) {
  const d = new Date(logDate);
  d.setDate(d.getDate() + delta);
  if (dateKey(d) > dateKey(new Date())) return; // no logging the future
  logDate = d;
  rerender();
}

export function renderLog(rerender) {
  const key = dateKey(logDate);
  const isToday = key === dateKey(new Date());
  const log = getLog(key);
  const wrap = h("div", {});

  wrap.appendChild(h("div", { class: "card" }, [
    h("div", { class: "row" }, [
      h("button", { class: "secondary", id: "log-prev", onclick: () => shiftLogDate(-1, rerender) }, "‹ Prev"),
      h("strong", {}, `${isToday ? "Today" : WEEKDAYS[logDate.getDay()]}, ${key}`),
      h("button", { class: "secondary", id: "log-next", disabled: isToday ? "disabled" : null, onclick: () => shiftLogDate(1, rerender) }, "Next ›"),
      isToday ? null : h("button", { class: "secondary", onclick: () => { logDate = new Date(); rerender(); } }, "Today"),
    ]),
    isToday ? null : h("div", { class: "muted trk-small" }, "Editing a past day."),
  ]));

  // Weight
  const hist = weightHistory(30);
  const first = hist[0], last = hist[hist.length - 1];
  wrap.appendChild(h("div", { class: "card" }, [
    h("h2", {}, "Morning weight"),
    h("div", { class: "trk-form" }, [
      h("input", { type: "number", id: "trk-weight", inputmode: "decimal", step: "0.1", min: "20", max: "400", placeholder: "kg", value: log.weight ?? "", "aria-label": "Weight in kg" }),
      h("button", { class: "primary", id: "trk-weight-save", onclick: () => {
        setWeight(key, document.getElementById("trk-weight").value);
        rerender();
      } }, "Save"),
    ]),
    last && first && hist.length > 1
      ? h("div", { class: "muted trk-small" }, `Latest ${last.kg} kg · ${last.kg - first.kg > 0 ? "+" : ""}${(last.kg - first.kg).toFixed(1)} kg since ${first.date}`)
      : null,
    weightChart(hist),
  ]));

  // Water
  const glassTarget = glassesFor(ACTIONS.waterTargetLitres);
  wrap.appendChild(h("div", { class: "card" }, [
    h("h2", {}, "Water"),
    h("div", { class: "trk-form" }, [
      h("button", { class: "secondary", id: "trk-water-minus", "aria-label": "Remove a glass", onclick: () => { addWater(key, -1); rerender(); } }, "−"),
      h("button", { class: "primary", id: "trk-water-plus", onclick: () => { addWater(key, 1); rerender(); } }, `+ Glass (${GLASS_ML} ml)`),
    ]),
    progress(log.water / glassTarget, `${log.water} / ${glassTarget} glasses · ${(log.water * GLASS_ML) / 1000} / ${ACTIONS.waterTargetLitres} L`),
  ]));

  // Steps
  wrap.appendChild(h("div", { class: "card" }, [
    h("h2", {}, "Steps"),
    h("div", { class: "trk-form" }, [
      h("input", { type: "number", id: "trk-steps", inputmode: "numeric", min: "0", step: "1", placeholder: "steps today", value: log.steps ?? "", "aria-label": "Steps today" }),
      h("button", { class: "primary", id: "trk-steps-save", onclick: () => { setSteps(key, document.getElementById("trk-steps").value); rerender(); } }, "Save"),
    ]),
    progress((log.steps || 0) / ACTIONS.stepTarget, `${log.steps || 0} / ${ACTIONS.stepTarget} steps`),
  ]));

  // Workout sets
  const totalSets = WORKOUT.circuit.reduce((a, e) => a + e.sets, 0);
  const doneSets = WORKOUT.circuit.reduce((a, e, i) => a + Math.min(e.sets, log.sets[i] || 0), 0);
  wrap.appendChild(h("div", { class: "card" }, [
    h("h2", {}, "Workout sets"),
    ...WORKOUT.circuit.map((e, i) => {
      const done = Math.min(e.sets, log.sets[i] || 0);
      return h("div", { class: "trk-ex" }, [
        h("div", { class: "trk-ex-name" }, [e.name, h("span", { class: "muted trk-small" }, ` · ${e.target}`)]),
        h("div", { class: "trk-sets" }, Array.from({ length: e.sets }, (_, s) =>
          h("label", { class: "trk-set" }, [
            h("input", { type: "checkbox", class: "checkbox", "data-ex": String(i), "data-set": String(s), checked: s < done ? "checked" : null, "aria-label": `${e.name} set ${s + 1}`,
              onchange: (ev) => { setSetsDone(key, i, ev.target.checked ? s + 1 : s); rerender(); } }),
            `Set ${s + 1}`,
          ]))),
      ]);
    }),
    progress(doneSets / totalSets, `${doneSets} of ${totalSets} sets done`),
  ]));

  return wrap;
}
