// Weekly review: a card on Insights (any past week) and a nudge on Today
// (Sunday to Tuesday, until you've looked at it). Numbers come from weeklyreviewdata.js.

import { readAll, parseKey } from "./insightsdata.js";
import { buildReview, reviewWeekFor, isReviewDue, weekStartOf } from "./weeklyreviewdata.js";
import { effectiveProgram } from "./planstore.js";
import { el as h } from "./dom.js";

const SEEN_KEY = "day-planner-ui:reviewSeen"; // UI-only: never backed up or restored
const fmtPct = (r) => (r == null ? "–" : `${Math.round(r * 100)}%`);
const fmtDay = (key) => parseKey(key).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function getSeen() {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}
function markSeen(weekKey) {
  try { localStorage.setItem(SEEN_KEY, weekKey); } catch { /* ignore */ }
}

let viewWeek = null; // Monday Date being shown on Insights; null = the default review week

function headline(r) {
  if (!r.days) return "No tracked days this week.";
  const d = r.delta == null ? "" : r.delta === 0 ? " (same as last week)" : ` (${r.delta > 0 ? "+" : "−"}${Math.abs(r.delta)} vs last week)`;
  return `${fmtPct(r.overall)} of your plan${d}`;
}

/** Insights-tab card with prev/next week. */
export function weeklyReviewCard(rerender) {
  const today = new Date();
  const base = reviewWeekFor(today);
  const ws = viewWeek || base;
  const r = buildReview(readAll(), ws, today);
  markSeen(r.weekStart);
  const planStartWeek = weekStartOf(parseKey(effectiveProgram().planStart));
  const canPrev = ws > planStartWeek;
  const canNext = ws < base;
  const go = (delta) => {
    const n = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + delta * 7);
    viewWeek = n.getTime() === base.getTime() ? null : n;
    rerender();
  };
  return h("div", { class: "card review-card", id: "weekly-review" }, [
    h("div", { class: "review-nav" }, [
      h("button", { class: "secondary icon-btn", id: "review-prev", "aria-label": "Previous week", disabled: canPrev ? null : "disabled", onclick: () => go(-1) }, "‹"),
      h("div", { class: "review-title" }, [
        h("h2", {}, "Weekly review"),
        h("div", { class: "muted" }, `${fmtDay(r.weekStart)} – ${fmtDay(r.weekEnd)}${r.complete ? "" : " (in progress)"}`),
      ]),
      h("button", { class: "secondary icon-btn", id: "review-next", "aria-label": "Next week", disabled: canNext ? null : "disabled", onclick: () => go(1) }, "›"),
    ]),
    h("p", { class: "review-head" }, headline(r)),
    r.wins.length ? h("div", {}, [h("h3", {}, "What went well"), h("ul", { class: "review-list" }, r.wins.map((w) => h("li", {}, w)))]) : null,
    r.groups.length
      ? h("div", {}, [
          h("h3", {}, "By area"),
          h("ul", { class: "review-list" }, r.groups.map((g) => h("li", {}, `${g.label}: ${fmtPct(g.pct)}${g.prevPct != null ? ` (last week ${fmtPct(g.prevPct)})` : ""}`))),
        ])
      : null,
    r.bestDay && r.worstDay ? h("p", { class: "muted" }, `Strongest day: ${r.bestDay.name} (${fmtPct(r.bestDay.pct)}). Toughest: ${r.worstDay.name} (${fmtPct(r.worstDay.pct)}).`) : null,
    h("div", { class: "review-tip" }, [h("strong", {}, r.suggestion.title), h("div", {}, r.suggestion.text)]),
    h("div", { class: "muted review-note" }, "A rough guide from your own ticks, not medical advice."),
  ]);
}

/** Today-tab nudge, or null when no review is due. */
export function weeklyReviewNudge() {
  const today = new Date();
  let due = false;
  try { due = isReviewDue(today, getSeen(), effectiveProgram().planStart); } catch { return null; }
  if (!due) return null;
  const ws = reviewWeekFor(today);
  const r = buildReview(readAll(), ws, today);
  if (!r.days) return null;
  const card = h("div", { class: "card review-nudge", role: "region", "aria-label": "Weekly review" }, [
    h("p", { class: "review-nudge-msg" }, [h("strong", {}, "Your week in review: "), headline(r)]),
    h("div", { class: "actions-row" }, [
      h("button", { type: "button", id: "review-open", onclick: () => { markSeen(r.weekStart); card.remove(); document.dispatchEvent(new CustomEvent("planner:tab", { detail: "insights" })); } }, "See review"),
      h("button", { type: "button", class: "secondary", id: "review-dismiss", onclick: () => { markSeen(r.weekStart); card.remove(); } }, "Dismiss"),
    ]),
  ]);
  return card;
}
