import { DEFAULT_TIMES, MEDICINES, ACTIONS, MENUS, WORKOUT } from "./data.js";
import { computeDay, dailyMedDayNumber, dailyMedActive, weeklyMedActiveToday, planDayNumber } from "./engine.js";
import { buildICS, buildMultiDayICS, downloadICS } from "./ics.js";
import { backupCard } from "./backup.js";
import { backupNudge } from "./backupnudge.js";
import { remindersSupported, remindersEnabled, setRemindersEnabled, scheduleReminders, snoozeItem } from "./reminders.js";
import { findMissed, missedHint } from "./missed.js";
import { markDone, unmarkDone, parseDeepLink, parseDateKey, SNOOZE_MIN } from "./actions.js";
import { showToast } from "./toast.js";
import { renderLog } from "./log.js";
import { getLog, addWater, glassesFor } from "./logstore.js";
import { renderWeekTab } from "./week.js";
import { renderPlanTab, mealNoteWidget } from "./plan.js";
import { effectiveTimes, effectiveProgram } from "./planstore.js";
import { initNav, syncNav, isKnownTab } from "./nav.js";
import { startOnboardingIfNeeded, setupCard } from "./onboarding.js";

// Program dates are user-editable (Plan tab): `PROGRAM.x` reads the effective value live.
const PROGRAM = new Proxy({}, { get: (_, k) => effectiveProgram()[k] });
import { renderMedsTab } from "./meds.js";
import { renderInsights } from "./insights.js";
import { splitItems, bulkMarkable, nextUpcoming } from "./catchup.js";
import { reportCard } from "./report.js";
import { loadHistory, saveHistory, recordDay, computeStreak } from "./progress.js";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CATEGORY_ICON = { food: "🍽️", medicine: "💊", exercise: "🚶", water: "💧", measure: "⚖️", prep: "🌰", workout: "🏋️" };

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadDayState(key) {
  try {
    const raw = localStorage.getItem(`elevate-planner:${key}`);
    if (!raw) return { overrides: {}, done: [] };
    const parsed = JSON.parse(raw);
    return { overrides: parsed.overrides || {}, done: parsed.done || [] };
  } catch {
    return { overrides: {}, done: [] };
  }
}

function saveDayState(key, state) {
  localStorage.setItem(`elevate-planner:${key}`, JSON.stringify(state));
}

// ---- App state ----
let currentDate = new Date();
let activeTab = "today";

function setTab(tab) {
  activeTab = tab;
  window.scrollTo(0, 0);
  syncNav(tab);
  render();
}

initNav(setTab);

function render() {
  const app = document.getElementById("app");
  app.innerHTML = "";
  if (activeTab === "today") app.appendChild(renderToday());
  else if (activeTab === "week") app.appendChild(renderWeek());
  else if (activeTab === "plan") app.appendChild(renderPlanTab(render));
  else if (activeTab === "workout") app.appendChild(renderWorkout());
  else if (activeTab === "log") app.appendChild(renderLog(render));
  else if (activeTab === "meds") app.appendChild(renderMeds());
  else if (activeTab === "insights") app.appendChild(renderInsights(render));
  else app.appendChild(renderAbout());
  refreshReminders();
}

// Reminders always follow the real "today", whichever day/tab is on screen.
function refreshReminders() {
  const now = new Date();
  const st = loadDayState(dateKey(now));
  scheduleReminders(computeDay(now, st.overrides, new Set(st.done)));
}

function remindersCard() {
  if (!remindersSupported()) {
    return el("div", { class: "card" }, [
      el("h2", {}, "Reminders"),
      el("p", { class: "muted" }, "This browser doesn't support notifications. On iPhone, add the app to the Home Screen first."),
    ]);
  }
  const on = remindersEnabled();
  return el("div", { class: "card" }, [
    el("h2", {}, "Reminders"),
    el("p", { class: "muted" }, "Get a notification 2 minutes before each unchecked item. Works while the app is open or running in the background; a static site can't send true push notifications when it's fully closed."),
    el("button", {
      class: on ? "secondary" : "primary",
      id: "reminders-toggle",
      onclick: async () => {
        const ok = await setRemindersEnabled(!on);
        if (!ok && !on) alert("Notification permission was not granted.");
        render();
      },
    }, on ? "Turn reminders off" : "Turn reminders on"),
  ]);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

// ---- Today tab ----
let timeDrawerOpen = false; // keeps the tools drawer open across re-renders

function nowMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function renderToday() {
  const key = dateKey(currentDate);
  const state = loadDayState(key);
  const overrides = { ...state.overrides };
  const done = new Set(state.done);
  const todayKey = dateKey(new Date());
  const isToday = key === todayKey;
  const isPast = key < todayKey;
  const isFuture = key > todayKey;
  const nowMin = nowMinutes();

  const wrap = document.createDocumentFragment();
  { const n = backupNudge(render); if (n) wrap.appendChild(n); }

  const items = computeDay(currentDate, overrides, done);
  const doneCount = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;
  const { catchUp, upcoming, done: doneItems } = splitItems(items, { isToday, isPast, nowMin });
  const nextItem = nextUpcoming(upcoming, isToday);
  const missed = findMissed(items, { isToday, isPast, nowMin });
  const missedIds = new Set(missed.map((i) => i.id));

  // History + streak (only real days up to today are recorded)
  let history = loadHistory();
  if (key <= todayKey && items.length) {
    const prev = history[key];
    if (!prev || prev.done !== doneCount || prev.total !== items.length) {
      history = recordDay(history, key, doneCount, items.length);
      saveHistory(history);
    }
  }
  const streak = computeStreak(history, todayKey);

  // ---- Header: one slim row ----
  const picker = el("input", {
    type: "date",
    id: "date-picker",
    class: "date-input",
    value: key,
    "aria-label": "Jump to date",
    onchange: (e) => {
      const d = parseDateKey(e.target.value);
      if (!d) return;
      currentDate = d;
      render();
    },
  });
  const dateLabel = isToday ? "Today" : WEEKDAY_NAMES[currentDate.getDay()];
  const dateRow = el("div", { class: "card today-head" }, [
    el("div", { class: "today-nav" }, [
      el("button", { class: "secondary icon-btn", "aria-label": "Previous day", onclick: () => shiftDate(-1) }, "‹"),
      el("div", { class: "today-title" }, [
        el("strong", {}, dateLabel),
        el("span", { class: "muted" }, ` ${currentDate.toLocaleDateString(undefined, { weekday: isToday ? "short" : undefined, day: "numeric", month: "short" })}`),
      ]),
      el("button", { class: "secondary icon-btn", "aria-label": "Next day", onclick: () => shiftDate(1) }, "›"),
      el("button", {
        class: "secondary icon-btn",
        "aria-label": "Pick a date",
        onclick: () => { try { picker.showPicker(); } catch { picker.focus(); picker.click(); } },
      }, "📅"),
      isToday ? null : el("button", { class: "secondary", onclick: () => { currentDate = new Date(); render(); } }, "Today"),
      picker,
    ]),
    el("div", { class: "muted today-sub" }, [
      planDayNumber(currentDate) ? `Plan day ${planDayNumber(currentDate)}` : `Plan starts ${PROGRAM.planStart}`,
      dailyMedActive(currentDate) ? ` · Meds day ${dailyMedDayNumber(currentDate)}/${PROGRAM.dailyMedsCourseDays}` : "",
      weeklyMedActiveToday(currentDate) ? el("span", { class: "chip" }, "Uprise-D3 day") : null,
    ]),
    isPast ? el("div", { class: "day-banner past", role: "note" }, "Catching up on a past day. Changes save to that date.") : null,
    isFuture ? el("div", { class: "day-banner future", role: "note" }, "Planning ahead. Checks save to that date.") : null,
    el("div", { class: "progress-head" }, [
      el("strong", {}, `${doneCount} of ${items.length} done`),
      el("span", { class: "streak", title: "Consecutive days with at least 80% completion" }, `🔥 ${streak}`),
    ]),
    el("div", { class: "progress-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) }, [
      el("div", { class: "progress-fill", style: `width:${pct}%` }),
    ]),
  ]);
  wrap.appendChild(dateRow);

  // ---- Water: a small counter (everything else is logged on the Log tab) ----
  const glasses = getLog(key).water;
  const glassGoal = glassesFor(ACTIONS.waterTargetLitres);
  wrap.appendChild(
    el("div", { class: "card water-row" }, [
      el("div", { class: "water-text" }, [
        el("strong", {}, `💧 ${glasses}/${glassGoal}`),
        el("span", { class: "muted" }, " glasses"),
      ]),
      el("button", { class: "secondary icon-btn", id: "water-minus", "aria-label": "Remove a glass", disabled: isFuture || glasses === 0 ? "disabled" : null, onclick: () => { addWater(key, -1); render(); } }, "−"),
      el("button", { class: "primary", id: "water-plus", disabled: isFuture ? "disabled" : null, onclick: () => { addWater(key, 1); render(); } }, "+ Glass"),
    ])
  );

  // ---- Rows ----
  const renderItem = (item) => {
    const isMissed = missedIds.has(item.id);
    const isNext = nextItem && item.id === nextItem.id;
    const hasExtra = isMissed || Boolean(item.notes) || (item.links && item.links.length);
    const row = el("div", { class: `item cat-${item.category}${item.done ? " done" : ""}${isMissed ? " missed" : ""}${isNext ? " next" : ""}`, "data-id": item.id }, [
      el("label", { class: "check-hit" }, [
        el("input", {
          type: "checkbox",
          class: "checkbox",
          "aria-label": `Mark done: ${item.label}`,
          checked: item.done ? "checked" : null,
          onchange: (e) => setDone(item, e.target.checked),
        }),
      ]),
      el("div", { class: "item-time" }, item.time),
      el("div", { class: "item-body" }, [
        el("button", {
          type: "button",
          class: "item-label item-toggle",
          "aria-expanded": "false",
          onclick: (e) => {
            const open = row.classList.toggle("open");
            e.currentTarget.setAttribute("aria-expanded", String(open));
          },
        }, [
          `${CATEGORY_ICON[item.category] || ""} ${item.label}`,
          isNext ? el("span", { class: "chip" }, "Next") : null,
          isMissed ? el("span", { class: "chip missed-chip" }, "Missed") : null,
          hasExtra ? el("span", { class: "more-dot", "aria-hidden": "true" }, "▾") : null,
        ]),
        el("div", { class: "item-extra" }, [
          isMissed ? el("div", { class: "missed-hint" }, missedHint(item.id)) : null,
          item.notes ? el("div", { class: "item-notes", style: "white-space:pre-line" }, item.notes) : null,
          mealNoteWidget(key, item.id),
          item.links && item.links.length
            ? el("div", { class: "item-links" }, item.links.map((l) => el("a", { class: "pill-link", href: l.url, target: "_blank", rel: "noopener" }, `▶ ${l.name}`)))
            : null,
        ]),
      ]),
    ]);
    return row;
  };

  // ---- Catch up (what you forgot to tick earlier) ----
  if (catchUp.length) {
    const bulk = bulkMarkable(catchUp);
    wrap.appendChild(
      el("div", { class: "card section-catchup" }, [
        el("div", { class: "section-head" }, [
          el("h2", {}, isPast ? "To tick off" : "Catch up"),
          el("span", { class: "muted" }, `${catchUp.length} earlier`),
        ]),
        bulk.length
          ? el("button", { class: "primary bulk-btn", id: "mark-all-earlier", onclick: () => markMany(bulk) }, `✓ Mark ${bulk.length === catchUp.length ? "all" : "all except medicines"} as done`)
          : null,
        bulk.length && bulk.length < catchUp.length
          ? el("div", { class: "muted bulk-note" }, "Medicines are ticked one at a time so your record stays accurate.")
          : null,
        el("div", {}, catchUp.map(renderItem)),
      ])
    );
  }

  // ---- Coming up ----
  if (upcoming.length) {
    wrap.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "section-head" }, [
          el("h2", {}, isFuture ? "Planned" : "Coming up"),
          el("span", { class: "muted" }, `${upcoming.length} left`),
        ]),
        el("div", {}, upcoming.map(renderItem)),
      ])
    );
  } else if (!catchUp.length && items.length) {
    wrap.appendChild(el("div", { class: "card all-done" }, "All done for this day 🎉"));
  }

  // ---- Done (collapsed) ----
  if (doneItems.length) {
    wrap.appendChild(
      el("details", { class: "card done-section" }, [
        el("summary", {}, `Done · ${doneItems.length}`),
        el("div", {}, doneItems.map(renderItem)),
      ])
    );
  }

  // ---- Log shortcut (water, steps, weight, sets live on the Log tab) ----
  wrap.appendChild(
    el("button", { class: "secondary log-link", id: "go-log", onclick: () => setTab("log") }, "Log water, steps, weight & sets →")
  );

  // ---- Tools: adjust times + calendar, tucked away ----
  const timeFields = ["wake", "earlyMorning", "workout", "breakfast", "lunch", "snack", "stretch", "dinner", "bedtime"];
  const fieldLabels = {
    wake: "Wake",
    earlyMorning: "Early morning",
    workout: "Workout",
    breakfast: "Breakfast",
    lunch: "Lunch",
    snack: "Snack",
    stretch: "Stretching",
    dinner: "Dinner",
    bedtime: "Bedtime",
  };
  const overrideCount = Object.keys(overrides).length;
  const remaining = items.filter((i) => !i.done);
  const tools = el("details", { class: "card time-drawer tools" }, [
    el("summary", {}, [
      "Adjust times & calendar",
      overrideCount ? el("span", { class: "chip" }, `${overrideCount} changed`) : null,
    ]),
    el("div", { class: "muted", style: "margin-top:0.5rem" }, "Running late or early? Change a time and everything tied to it (medicine buffers, walks) recomputes."),
    el(
      "div",
      { class: "row", style: "margin-top:0.5rem" },
      timeFields.map((f) =>
        el("label", { class: "time-field" }, [
          fieldLabels[f],
          el("input", {
            type: "time",
            value: overrides[f] || effectiveTimes()[f],
            onchange: (e) => {
              overrides[f] = e.target.value;
              state.overrides = overrides;
              saveDayState(key, state);
              timeDrawerOpen = true;
              render();
            },
          }),
        ])
      )
    ),
    el("div", { class: "actions-row" }, [
      el("button", {
        class: "secondary",
        onclick: () => {
          if (!overrideCount) return;
          if (!confirm("Reset all adjusted times for this day to the defaults?")) return;
          const before = { ...overrides };
          state.overrides = {};
          saveDayState(key, state);
          render();
          showToast("Times reset to defaults", {
            actionLabel: "Undo",
            onAction: () => { const s2 = loadDayState(key); s2.overrides = before; saveDayState(key, s2); render(); },
          });
        },
      }, "Reset times"),
    ]),
    el("div", { class: "muted", style: "margin-top:0.8rem" }, `${remaining.length} of ${items.length} items left. "Rest of today" only exports what's unchecked.`),
    el("div", { class: "actions-row cal-actions" }, [
      el("button", { class: "primary", onclick: () => downloadICS(`elevate-${key}.ics`, buildICS(currentDate, remaining)) }, "Add rest of today (.ics)"),
      el("button", {
        class: "secondary",
        onclick: () => {
          const monday = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
          monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
          const days = [];
          for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            days.push({ date: d, items: computeDay(d, {}, new Set()) });
          }
          downloadICS(`elevate-week-${dateKey(monday)}.ics`, buildMultiDayICS(days));
        },
      }, "Add whole week (.ics)"),
    ]),
  ]);
  if (timeDrawerOpen) tools.setAttribute("open", "");
  tools.addEventListener("toggle", () => { timeDrawerOpen = tools.open; });
  wrap.appendChild(tools);

  return wrap;

  function setDone(item, checked) {
    const cur = loadDayState(key);
    saveDayState(key, checked ? markDone(cur, item.id) : unmarkDone(cur, item.id));
    render();
    if (checked) {
      showToast(`Marked ${item.label} done`, {
        actionLabel: "Undo",
        onAction: () => { saveDayState(key, unmarkDone(loadDayState(key), item.id)); render(); },
      });
    }
  }

  function markMany(list) {
    const before = loadDayState(key);
    let next = before;
    for (const item of list) next = markDone(next, item.id);
    saveDayState(key, next);
    render();
    showToast(`Marked ${list.length} items done`, {
      actionLabel: "Undo",
      onAction: () => { saveDayState(key, before); render(); },
    });
  }

  function shiftDate(deltaDays) {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + deltaDays);
    currentDate = d;
    render();
  }
}

// ---- Week tab ----
function renderWeek() {
  return renderWeekTab();
}

// ---- Workout tab ----
function renderWorkout() {
  const link = (e) => el("a", { href: e.url, target: "_blank", rel: "noopener" }, "Watch");
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, ["Exercise", "Sets", "Target", "Video"].map((h) => el("th", {}, h)))),
    el(
      "tbody",
      {},
      WORKOUT.circuit.map((e) =>
        el("tr", {}, [el("td", {}, e.name), el("td", {}, String(e.sets)), el("td", {}, e.target), el("td", {}, link(e))])
      )
    ),
  ]);
  return el("div", {}, [
    el("div", { class: "card" }, [
      el("h2", {}, "Morning workout"),
      el("p", {}, ["1. ", el("a", { href: WORKOUT.warmup.url, target: "_blank", rel: "noopener" }, WORKOUT.warmup.name)]),
      el("p", {}, "2. Circuit:"),
      table,
    ]),
    el("div", { class: "card" }, [
      el("h2", {}, "Evening"),
      el("p", {}, el("a", { href: WORKOUT.stretch.url, target: "_blank", rel: "noopener" }, WORKOUT.stretch.name)),
    ]),
  ]);
}

// ---- Meds tab ----
function renderMeds() {
  return renderMedsTab(render);
}

// ---- About tab ----
function renderAbout() {
  const wrap = document.createDocumentFragment();
  wrap.appendChild(el("div", { class: "card" }, [
    el("h2", {}, "About this planner"),
    el("p", {}, "A static, on-device day planner for a weight-management program: meal windows, medicine timing (including buffer rules), post-meal walks, water and step targets."),
    el("p", {}, "Nothing here is medical advice — it's a scheduling tool built from the plan you already have. Confirm anything medication-related with your doctor/coach."),
    el("p", {}, "Data (your edited times and checked-off items) is stored only in this browser's local storage — it is not synced anywhere and is not committed to the repo."),
    el("h2", {}, "Using it day to day"),
    el("ul", {}, [
      el("li", {}, "Open it each morning; it defaults to today's date and the week's menu rotation."),
      el("li", {}, "Running late or early to something? Edit that time field — dependent items (medicine buffers, walks) recompute instantly."),
      el("li", {}, "Tap “Download / update today's calendar” any time — it only includes items you haven't checked off, so re-importing later in the day won't duplicate what's already passed."),
      el("li", {}, "On iPhone, tap the downloaded .ics to open Calendar's add-event sheet. Add to Home Screen from Safari's share sheet for quick access."),
    ]),
  ]));
  wrap.appendChild(remindersCard());
  wrap.appendChild(setupCard(render));
  wrap.appendChild(reportCard());
  wrap.appendChild(backupCard(render));
  return wrap;
}

// ---- Quick actions: deep links + messages from notification buttons ----
function applyQuickAction(action, id, date) {
  const target = parseDateKey(date) || new Date();
  const k = dateKey(target);
  if (action === "done") {
    saveDayState(k, markDone(loadDayState(k), id));
    const label = computeDay(target, loadDayState(k).overrides, new Set()).find((i) => i.id === id)?.label || "item";
    render();
    showToast(`Marked ${label} done`, {
      actionLabel: "Undo",
      onAction: () => { saveDayState(k, unmarkDone(loadDayState(k), id)); render(); },
    });
  } else if (action === "snooze") {
    const st = loadDayState(k);
    const item = computeDay(target, st.overrides, new Set(st.done)).find((i) => i.id === id);
    if (item && snoozeItem(item)) showToast(`Snoozed ${item.label} for ${SNOOZE_MIN} min`);
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (ev) => {
    const d = ev.data;
    if (d && d.type === "planner-action") applyQuickAction(d.action, d.id, d.date);
  });
}

startOnboardingIfNeeded(render);
render();
{
  const link = parseDeepLink(location.search);
  if (link.tab && isKnownTab(link.tab)) setTab(link.tab);
  if (link.done) applyQuickAction("done", link.done, link.date);
  else if (link.snooze) applyQuickAction("snooze", link.snooze, link.date);
  if (link.tab || link.done || link.snooze) {
    try { history.replaceState(null, "", location.pathname); } catch { /* ignore */ }
  }
}
