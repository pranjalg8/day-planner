// Insights tab: DOM only. All numbers come from insightsdata.js.
import { GROUPS, readAll, setGoal, buildInsights, linearTrend, trendText, parseKey } from "./insightsdata.js";
import { el as h } from "./dom.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

function svgEl(tag, attrs, text) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}
const fmtPct = (r) => (r == null ? "–" : `${Math.round(r * 100)}%`);

function weekCard(week) {
  const { thisWeek: tw, lastWeek: lw } = week;
  const rows = GROUPS.map((g) => {
    const a = tw.groups[g.id], b = lw.groups[g.id];
    const delta = a.pct != null && b.pct != null ? Math.round((a.pct - b.pct) * 100) : null;
    return h("div", { class: "ins-row" }, [
      h("div", { class: "ins-row-label" }, g.label),
      h("div", { class: "ins-bar", role: "img", "aria-label": `${g.label}: ${fmtPct(a.pct)} this week, ${fmtPct(b.pct)} last week` }, [
        h("div", { class: "ins-fill", style: `width:${Math.round((a.pct || 0) * 100)}%` }),
        h("div", { class: "ins-prev", style: `left:${Math.round((b.pct || 0) * 100)}%`, hidden: b.pct == null ? "hidden" : null }),
      ]),
      h("div", { class: "ins-row-val" }, [
        fmtPct(a.pct),
        delta != null && delta !== 0 ? h("span", { class: `ins-delta ${delta > 0 ? "up" : "down"}` }, ` ${delta > 0 ? "+" : "−"}${Math.abs(delta)}`) : null,
      ]),
    ]);
  });
  const stat = (label, a, b) => h("div", { class: "ins-stat" }, [h("div", { class: "ins-stat-v" }, a), h("div", { class: "muted ins-small" }, `${label} · last wk ${b}`)]);
  return h("div", { class: "card" }, [
    h("h2", {}, "This week vs last week"),
    h("div", { class: "muted ins-small" }, `Overall ${fmtPct(tw.overall)} (${tw.days} day${tw.days === 1 ? "" : "s"}) vs ${fmtPct(lw.overall)} last week. Tick mark on each bar = last week.`),
    ...rows,
    h("div", { class: "ins-stats" }, [
      stat("Water", `${tw.litres.toFixed(1)} L`, `${lw.litres.toFixed(1)} L`),
      stat("Avg steps", tw.avgSteps != null ? String(tw.avgSteps) : "–", lw.avgSteps != null ? String(lw.avgSteps) : "–"),
      stat("Sets", String(tw.sets), String(lw.sets)),
      stat("Weight", tw.weightLatest != null ? `${tw.weightLatest} kg` : "–", lw.weightLatest != null ? `${lw.weightLatest} kg` : "–"),
    ]),
  ]);
}

function heatCard(heat) {
  const level = (r) => (r == null ? "na" : r === 0 ? "0" : r < 0.34 ? "1" : r < 0.67 ? "2" : r < 0.9 ? "3" : "4");
  const grid = h("div", { class: "ins-heat", role: "table", "aria-label": "Daily completion, last 8 weeks" });
  const head = h("div", { class: "ins-heat-col ins-heat-days", "aria-hidden": "true" }, DAY_LETTERS.map((l) => h("div", { class: "ins-heat-lbl" }, l)));
  grid.appendChild(head);
  for (const col of heat) {
    grid.appendChild(h("div", { class: "ins-heat-col", role: "row" }, col.map((c) => {
      const lv = level(c.ratio);
      const label = c.ratio == null ? `${c.key}: not tracked` : `${c.key}: ${Math.round(c.ratio * 100)}% complete (${c.done} of ${c.total})`;
      return h("div", { class: `ins-cell lv-${lv}`, role: "cell", tabindex: "-1", title: label, "aria-label": label });
    })));
  }
  const legend = h("div", { class: "ins-legend muted ins-small" }, [
    "Less", ...["0", "1", "2", "3", "4"].map((l) => h("span", { class: `ins-cell lv-${l}`, "aria-hidden": "true" })), "More",
  ]);
  return h("div", { class: "card" }, [h("h2", {}, "Last 8 weeks"), h("div", { class: "ins-heat-wrap" }, grid), legend]);
}

function weightChart(points, goal) {
  const W = 360, H = 190, L = 36, R = 10, T = 12, B = 24;
  const tr = linearTrend(points);
  const vals = points.map((p) => p.kg).concat(goal ? [goal] : []);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max - min < 1) { min -= 0.5; max += 0.5; }
  const pad = (max - min) * 0.1;
  min -= pad; max += pad;
  const t0 = parseKey(points[0].date).getTime();
  const xd = points.map((p) => Math.round((parseKey(p.date).getTime() - t0) / 86400000));
  const span = Math.max(1, xd[xd.length - 1]);
  const x = (d) => L + (d * (W - L - R)) / span;
  const y = (v) => T + ((max - v) / (max - min)) * (H - T - B);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "trk-chart ins-wchart", role: "img",
    "aria-label": `Weight over time, ${points.length} entries${goal ? `, goal ${goal} kg` : ""}` });
  for (const v of [max - pad, (max + min) / 2, min + pad]) {
    svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "trk-grid" }));
    svg.appendChild(svgEl("text", { x: L - 4, y: y(v) + 3, "text-anchor": "end", class: "trk-axis" }, v.toFixed(1)));
  }
  if (goal) {
    svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y(goal), y2: y(goal), class: "ins-goal" }));
    svg.appendChild(svgEl("text", { x: W - R, y: y(goal) - 3, "text-anchor": "end", class: "ins-goal-t" }, `Goal ${goal}`));
  }
  if (tr) svg.appendChild(svgEl("line", { x1: x(0), y1: y(tr.at(0)), x2: x(span), y2: y(tr.at(span)), class: "ins-trend" }));
  svg.appendChild(svgEl("polyline", { points: points.map((p, i) => `${x(xd[i])},${y(p.kg)}`).join(" "), class: "trk-line", fill: "none" }));
  points.forEach((p, i) => {
    const c = svgEl("circle", { cx: x(xd[i]), cy: y(p.kg), r: 3, class: "trk-dot" });
    c.appendChild(svgEl("title", {}, `${p.date}: ${p.kg} kg`));
    svg.appendChild(c);
  });
  for (const i of [0, points.length - 1]) {
    svg.appendChild(svgEl("text", { x: x(xd[i]), y: H - 6, "text-anchor": i === 0 ? "start" : "end", class: "trk-axis" }, points[i].date.slice(5)));
  }
  return svg;
}

function weightCard(info, rerender) {
  const pts = info.weights.slice(-60);
  const input = h("input", { type: "number", id: "ins-goal", inputmode: "decimal", step: "0.1", min: "20", max: "400", placeholder: "goal kg (optional)", value: info.goal ?? "", "aria-label": "Goal weight in kg" });
  const tr = pts.length >= 2 ? linearTrend(pts) : null;
  return h("div", { class: "card" }, [
    h("h2", {}, "Weight trend"),
    h("div", { class: "trk-form" }, [
      input,
      h("button", { class: "primary", id: "ins-goal-save", onclick: () => { setGoal(input.value); rerender(); } }, "Save goal"),
    ]),
    pts.length >= 2 ? weightChart(pts, info.goal) : null,
    tr ? h("div", { class: "muted ins-small" }, `Change per week (trend): ${tr.perWeek > 0 ? "+" : ""}${tr.perWeek.toFixed(2)} kg. Dashed line = trend.`) : null,
    h("p", { class: "ins-note", id: "ins-trend-text" }, trendText(pts, info.goal)),
    h("div", { class: "muted ins-small" }, "A rough guide from your own entries only, not medical advice. Day-to-day weight naturally varies."),
  ]);
}

function highlightsCard(info) {
  const { weekdays: wd, streaks: st, totals: t } = info;
  const dayTxt = (d) => (d ? `${d.name} (${Math.round(d.avg * 100)}%)` : "–");
  const stat = (label, v) => h("div", { class: "ins-stat" }, [h("div", { class: "ins-stat-v" }, v), h("div", { class: "muted ins-small" }, label)]);
  return h("div", { class: "card" }, [
    h("h2", {}, "Highlights"),
    h("div", { class: "ins-stats" }, [
      stat("Current streak (days at 80%+)", String(st.current)),
      stat("Best streak", String(st.best)),
      stat("Strongest day", dayTxt(wd.best)),
      stat("Toughest day", dayTxt(wd.worst)),
      stat("Workouts completed", String(t.workouts)),
      stat("Sets logged", String(t.sets)),
      stat("Water logged", `${t.litres.toFixed(1)} L`),
      stat("Days tracked", String(t.days)),
    ]),
    wd.best ? null : h("div", { class: "muted ins-small" }, "Strongest and toughest days appear once a few weeks are tracked."),
  ]);
}

export function renderInsights(rerender = () => {}) {
  const info = buildInsights(readAll());
  const wrap = h("div", { class: "ins" });
  if (!info.hasData) {
    wrap.appendChild(h("div", { class: "card" }, [
      h("h2", {}, "Insights"),
      h("p", {}, "Nothing to show yet. Tick off items on Today and log water, steps or weight on the Log tab, and your weekly progress will show up here."),
    ]));
  } else {
    wrap.appendChild(weekCard(info.week));
    wrap.appendChild(heatCard(info.heat));
  }
  wrap.appendChild(weightCard(info, rerender));
  if (info.hasData) wrap.appendChild(highlightsCard(info));
  return wrap;
}
