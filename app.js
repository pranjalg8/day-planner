import { PROGRAM, DEFAULT_TIMES, MEDICINES, ACTIONS, MENUS, WORKOUT } from "./data.js";
import { computeDay, dailyMedDayNumber, dailyMedActive, weeklyMedActiveToday, planDayNumber } from "./engine.js";
import { buildICS, buildMultiDayICS, downloadICS } from "./ics.js";
import { groupItems } from "./grouping.js";
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
  document.querySelectorAll(".tab").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
  render();
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (btn) setTab(btn.dataset.tab);
});

function render() {
  const app = document.getElementById("app");
  app.innerHTML = "";
  if (activeTab === "today") app.appendChild(renderToday());
  else if (activeTab === "week") app.appendChild(renderWeek());
  else if (activeTab === "workout") app.appendChild(renderWorkout());
  else if (activeTab === "meds") app.appendChild(renderMeds());
  else app.appendChild(renderAbout());
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
let scrollPending = true; // auto-scroll to "now" on first load / when jumping to Today
const blockOpen = new Map(); // `${dateKey}:${blockId}` -> user's open/closed choice

function nowMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function renderToday() {
  const key = dateKey(currentDate);
  const state = loadDayState(key);
  const overrides = { ...state.overrides };
  const done = new Set(state.done);
  const isToday = key === dateKey(new Date());
  const nowMin = nowMinutes();

  const wrap = document.createDocumentFragment();

  // Computed schedule (needed up-front for progress + next-up bar)
  const items = computeDay(currentDate, overrides, done);
  const doneCount = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;
  const nextItem = isToday ? items.find((i) => !i.done && i.minutes >= nowMin) : null;

  // History + streak (only real days up to today are recorded)
  let history = loadHistory();
  const todayKey = dateKey(new Date());
  if (key <= todayKey && items.length) {
    const prev = history[key];
    if (!prev || prev.done !== doneCount || prev.total !== items.length) {
      history = recordDay(history, key, doneCount, items.length);
      saveHistory(history);
    }
  }
  const streak = computeStreak(history, todayKey);

  // Sticky "Next up" bar
  const topbar = document.querySelector(".topbar");
  if (topbar) document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
  if (isToday) {
    wrap.appendChild(
      el("div", { class: `nextup${nextItem ? "" : " nextup-none"}` }, [
        el("span", { class: "nextup-label" }, "Next up"),
        nextItem
          ? el("span", { class: "nextup-text" }, [el("strong", {}, nextItem.time), ` ${nextItem.label}`])
          : el("span", { class: "nextup-text" }, items.every((i) => i.done) ? "All done for today 🎉" : "Nothing left on the clock today"),
      ])
    );
  }

  // Date + day-shift controls
  const dateCard = el("div", { class: "card" }, [
    el("div", { class: "row" }, [
      el("button", { class: "secondary", onclick: () => shiftDate(-1) }, "‹ Prev"),
      el("strong", {}, `${WEEKDAY_NAMES[currentDate.getDay()]}, ${key}`),
      el("button", { class: "secondary", onclick: () => shiftDate(1) }, "Next ›"),
      el("button", { class: "secondary", onclick: () => { currentDate = new Date(); scrollPending = true; render(); } }, "Today"),
    ]),
    planDayNumber(currentDate)
      ? el("div", { class: "muted" }, `Plan day ${planDayNumber(currentDate)}`)
      : el("div", { class: "muted" }, `Plan starts ${PROGRAM.planStart}`),
    dailyMedActive(currentDate)
      ? el("div", { class: "muted" }, `Daily meds: day ${dailyMedDayNumber(currentDate)} of ${PROGRAM.dailyMedsCourseDays}`)
      : el("div", { class: "muted" }, "Daily 30-day medicine course is not active on this date."),
    weeklyMedActiveToday(currentDate) ? el("div", { class: "chip" }, "Uprise-D3 day") : null,
  ]);
  wrap.appendChild(dateCard);

  // Progress
  wrap.appendChild(
    el("div", { class: "card progress-card" }, [
      el("div", { class: "progress-head" }, [
        el("strong", {}, `${doneCount} of ${items.length} done`),
        el("span", { class: "streak", title: "Consecutive days with at least 80% completion" }, `🔥 ${streak}-day streak`),
      ]),
      el("div", { class: "progress-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) }, [
        el("div", { class: "progress-fill", style: `width:${pct}%` }),
      ]),
    ])
  );

  // Actual-time overrides, collapsed by default
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
  const timeCard = el("details", { class: "card time-drawer" }, [
    el("summary", {}, [
      "Adjust times",
      overrideCount ? el("span", { class: "chip" }, `${overrideCount} changed`) : null,
    ]),
    el("div", { class: "muted", style: "margin-top:0.5rem" }, "Running late or early? Change any time below — everything tied to it (medicine buffers, walks) recomputes automatically."),
    el(
      "div",
      { class: "row", style: "margin-top:0.5rem" },
      timeFields.map((f) =>
        el("label", { class: "time-field" }, [
          fieldLabels[f],
          el("input", {
            type: "time",
            value: overrides[f] || DEFAULT_TIMES[f],
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
      el(
        "button",
        {
          class: "secondary",
          onclick: () => {
            state.overrides = {};
            saveDayState(key, state);
            render();
          },
        },
        "Reset to defaults"
      ),
    ]),
  ]);
  if (timeDrawerOpen) timeCard.setAttribute("open", "");
  timeCard.addEventListener("toggle", () => { timeDrawerOpen = timeCard.open; });
  wrap.appendChild(timeCard);

  // Grouped schedule
  const renderItem = (item) => {
    const past = isToday && !item.done && item.minutes < nowMin;
    const isNext = nextItem && item.id === nextItem.id;
    return el("div", { class: `item cat-${item.category}${item.done ? " done" : ""}${past ? " past" : ""}${isNext ? " next" : ""}`, "data-id": item.id }, [
      el("label", { class: "check-hit" }, [
        el("input", {
          type: "checkbox",
          class: "checkbox",
          "aria-label": `Mark done: ${item.label}`,
          checked: item.done ? "checked" : null,
          onchange: (e) => {
            const s = new Set(done);
            if (e.target.checked) s.add(item.id);
            else s.delete(item.id);
            state.done = [...s];
            saveDayState(key, state);
            render();
          },
        }),
      ]),
      el("div", { class: "item-time" }, item.time),
      el("div", { class: "item-body" }, [
        el("div", { class: "item-label" }, [`${CATEGORY_ICON[item.category] || ""} ${item.label}`, isNext ? el("span", { class: "chip" }, "Next") : null]),
        item.notes ? el("div", { class: "item-notes", style: "white-space:pre-line" }, item.notes) : null,
        item.links && item.links.length
          ? el(
              "div",
              { class: "item-links" },
              item.links.map((l) => el("a", { class: "pill-link", href: l.url, target: "_blank", rel: "noopener" }, `▶ ${l.name}`))
            )
          : null,
      ]),
    ]);
  };

  const blocks = groupItems(items);
  const listCard = el("div", { class: "card" }, [
    el("h2", {}, isToday ? "Today's schedule" : "Schedule"),
    ...blocks.map((b) => {
      const bk = `${key}:${b.id}`;
      const allDone = b.doneCount === b.count;
      const containsNext = nextItem && b.items.some((i) => i.id === nextItem.id);
      const open = blockOpen.has(bk) ? blockOpen.get(bk) : !allDone || containsNext;
      const d = el("details", { class: `block${allDone ? " block-done" : ""}` }, [
        el("summary", {}, [
          el("span", { class: "block-name" }, `${b.icon} ${b.name}`),
          el("span", { class: "block-count" }, `${b.doneCount}/${b.count} done`),
        ]),
        el("div", {}, b.items.map(renderItem)),
      ]);
      if (open) d.setAttribute("open", "");
      d.addEventListener("toggle", () => blockOpen.set(bk, d.open));
      return d;
    }),
  ]);
  wrap.appendChild(listCard);

  // Calendar export
  const remaining = items.filter((i) => !i.done);
  const calCard = el("div", { class: "card" }, [
    el("h2", {}, "Calendar"),
    el("div", { class: "muted" }, `${remaining.length} of ${items.length} items remaining — "rest of today" only exports what's left, so re-exporting after rescheduling won't duplicate things you've already checked off.`),
    el("div", { class: "actions-row cal-actions" }, [
      el(
        "button",
        {
          class: "primary",
          onclick: () => downloadICS(`elevate-${key}.ics`, buildICS(currentDate, remaining)),
        },
        "Add rest of today (.ics)"
      ),
      el(
        "button",
        {
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
        },
        "Add whole week (.ics)"
      ),
    ]),
  ]);
  wrap.appendChild(calCard);

  if (scrollPending && isToday) {
    scrollPending = false;
    requestAnimationFrame(() => {
      const target = document.querySelector(".item.next") || document.querySelector(".item:not(.done):not(.past)");
      if (target) target.scrollIntoView({ block: "center" });
    });
  }

  return wrap;

  function shiftDate(deltaDays) {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + deltaDays);
    currentDate = d;
    render();
  }
}

let timeDrawerOpen = false;

// ---- Week tab ----
function renderWeek() {
  const wrap = document.createDocumentFragment();
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, ["Day", "Early AM", "Breakfast", "Lunch", "Snack", "Dinner"].map((h) => el("th", {}, h)))),
    el(
      "tbody",
      {},
      WEEKDAY_NAMES.map((name, i) =>
        el("tr", {}, [
          el("td", {}, [name.slice(0, 3), i === PROGRAM.weeklyMedDayOfWeek ? el("span", { class: "chip" }, "D3") : null]),
          el("td", {}, MENUS.earlyMorning[i]),
          el("td", {}, MENUS.breakfast[i]),
          el("td", {}, MENUS.lunch[i]),
          el("td", {}, MENUS.snack[i]),
          el("td", {}, MENUS.dinner[i]),
        ])
      )
    ),
  ]);
  wrap.appendChild(el("div", { class: "card" }, [el("h2", {}, "Weekly menu rotation"), table]));
  wrap.appendChild(
    el("div", { class: "card" }, [
      el("h2", {}, "Daily targets"),
      el("div", {}, `Water: ${ACTIONS.waterTargetLitres}L/day`),
      el("div", {}, `Steps: ${ACTIONS.stepTarget}/day`),
      el("div", {}, `Walking: ${ACTIONS.walkTargetMin} min/day (covered by 3× ${ACTIONS.walkAfterMealMin}-min post-meal walks)`),
      el("div", {}, `Cucumber: ${ACTIONS.cucumberSlices} slices to start breakfast, lunch, and dinner`),
    ])
  );
  return wrap;
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
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, ["Medicine", "Slot", "Course", "Notes"].map((h) => el("th", {}, h)))),
    el(
      "tbody",
      {},
      MEDICINES.map((m) =>
        el("tr", {}, [
          el("td", {}, m.name),
          el("td", {}, m.slot),
          el("td", {}, m.course),
          el("td", { class: "muted" }, m.notes),
        ])
      )
    ),
  ]);
  return el("div", {}, [
    el("div", { class: "card" }, [
      el("h2", {}, "Medicine reference"),
      table,
      el("div", { class: "muted", style: "margin-top:0.6rem" }, `Prescription review checkpoint: ${PROGRAM.reviewDate}`),
    ]),
  ]);
}

// ---- About tab ----
function renderAbout() {
  return el("div", { class: "card" }, [
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
  ]);
}

render();
