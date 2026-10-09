import { MEDICINES } from "./data.js";
import { effectiveProgram } from "./planstore.js";
import { computeDay, dailyMedActive, dailyMedDayNumber, weeklyMedActiveToday } from "./engine.js";
import { dateKey, getTaken, setTaken } from "./logstore.js";
import { el as h } from "./dom.js";

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function daysUntil(isoDate, from = new Date()) {
  const target = new Date(isoDate + "T00:00:00");
  return Math.round((target - startOfDay(from)) / 86400000);
}

export function renderMedsTab(rerender) {
  const now = new Date();
  const PROGRAM = effectiveProgram();
  const key = dateKey(now);
  const taken = getTaken(key);
  const doses = computeDay(now).filter((i) => i.category === "medicine");
  const wrap = h("div", {});

  // Course status
  const n = dailyMedDayNumber(now);
  const total = PROGRAM.dailyMedsCourseDays;
  let courseText;
  if (dailyMedActive(now)) courseText = `Day ${n} of ${total} · ${total - n} day${total - n === 1 ? "" : "s"} left after today`;
  else if (n < 1) courseText = `Daily course starts in ${1 - n} day(s)`;
  else courseText = `Daily ${total}-day course finished ${n - total} day(s) ago`;
  const review = daysUntil(PROGRAM.reviewDate, now);
  const reviewText = review > 0 ? `${review} day${review === 1 ? "" : "s"} to review (${PROGRAM.reviewDate})`
    : review === 0 ? `Review is today (${PROGRAM.reviewDate})` : `Review date passed (${PROGRAM.reviewDate})`;
  wrap.appendChild(h("div", { class: "card" }, [
    h("h2", {}, "Course status"),
    h("div", { class: "trk-stats" }, [
      h("div", { class: "trk-stat" }, [h("div", { class: "trk-stat-n" }, dailyMedActive(now) ? String(total - n) : "–"), h("div", { class: "muted trk-small" }, "days left in course")]),
      h("div", { class: "trk-stat" }, [h("div", { class: "trk-stat-n" }, String(Math.max(0, review))), h("div", { class: "muted trk-small" }, "days to review")]),
    ]),
    h("div", { class: "muted trk-small", id: "meds-course" }, courseText),
    h("div", { class: "muted trk-small", id: "meds-review" }, reviewText),
    weeklyMedActiveToday(now) ? h("div", { class: "chip" }, "Uprise-D3 day") : null,
  ]));

  // Today's doses
  const takenCount = doses.filter((d) => taken.has(d.id)).length;
  wrap.appendChild(h("div", { class: "card" }, [
    h("h2", {}, "Today's doses"),
    doses.length ? h("div", { class: "muted trk-small" }, `${takenCount} of ${doses.length} taken`) : h("div", { class: "muted" }, "No doses scheduled today."),
    ...doses.map((d) =>
      h("label", { class: `item${taken.has(d.id) ? " done" : ""}` }, [
        h("input", { type: "checkbox", class: "checkbox", "data-dose": d.id, checked: taken.has(d.id) ? "checked" : null,
          onchange: (e) => { setTaken(key, d.id, e.target.checked); rerender(); } }),
        h("div", { class: "item-time" }, d.time),
        h("div", { class: "item-body" }, [h("div", { class: "item-label" }, d.label), d.notes ? h("div", { class: "item-notes" }, d.notes) : null]),
      ])),
  ]));

  // Reference
  wrap.appendChild(h("div", { class: "card" }, [
    h("h2", {}, "Medicine reference"),
    ...MEDICINES.map((m) => h("div", { class: "trk-ref" }, [
      h("strong", {}, m.name), h("span", { class: "muted" }, ` · ${m.slot} · ${m.course}`),
      h("div", { class: "muted trk-small" }, m.notes),
    ])),
  ]));
  return wrap;
}
