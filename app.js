import { PROGRAM, DEFAULT_TIMES, MEDICINES, ACTIONS, MENUS, WORKOUT } from "./data.js";
import { computeDay, dailyMedDayNumber, dailyMedActive, weeklyMedActiveToday, planDayNumber } from "./engine.js";
import { buildICS, downloadICS } from "./ics.js";
import { renderLog } from "./log.js";
import { renderWeekTab } from "./week.js";
import { renderMedsTab } from "./meds.js";

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
  else if (activeTab === "log") app.appendChild(renderLog(render));
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
function renderToday() {
  const key = dateKey(currentDate);
  const state = loadDayState(key);
  const overrides = { ...state.overrides };
  const done = new Set(state.done);

  const wrap = document.createDocumentFragment();

  // Date + day-shift controls
  const dateCard = el("div", { class: "card" }, [
    el("div", { class: "row" }, [
      el("button", { class: "secondary", onclick: () => shiftDate(-1) }, "‹ Prev"),
      el("strong", {}, `${WEEKDAY_NAMES[currentDate.getDay()]}, ${key}`),
      el("button", { class: "secondary", onclick: () => shiftDate(1) }, "Next ›"),
      el("button", { class: "secondary", onclick: () => { currentDate = new Date(); render(); } }, "Today"),
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

  // Actual-time overrides
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
  const timeCard = el("div", { class: "card" }, [
    el("h2", {}, "Actual times today"),
    el("div", { class: "muted" }, "Running late or early? Change any time below — everything tied to it (medicine buffers, walks) recomputes automatically."),
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
  wrap.appendChild(timeCard);

  // Computed schedule
  const items = computeDay(currentDate, overrides, done);
  const listCard = el("div", { class: "card" }, [
    el("h2", {}, "Today's schedule"),
    el(
      "div",
      {},
      items.map((item) =>
        el("div", { class: `item${item.done ? " done" : ""}` }, [
          el("input", {
            type: "checkbox",
            class: "checkbox",
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
          el("div", { class: "item-time" }, item.time),
          el("div", { class: "item-body" }, [
            el("div", { class: "item-label" }, [
              `${CATEGORY_ICON[item.category] || ""} ${item.label}`,
            ]),
            item.notes ? el("div", { class: "item-notes", style: "white-space:pre-line" }, item.notes) : null,
            item.links && item.links.length
              ? el(
                  "div",
                  { class: "item-notes" },
                  item.links.map((l) => el("a", { href: l.url, target: "_blank", rel: "noopener", style: "margin-right:0.6rem" }, `▶ ${l.name}`))
                )
              : null,
          ]),
        ])
      )
    ),
  ]);
  wrap.appendChild(listCard);

  // Calendar export
  const remaining = items.filter((i) => !i.done);
  const calCard = el("div", { class: "card" }, [
    el("h2", {}, "Calendar"),
    el("div", { class: "muted" }, `${remaining.length} of ${items.length} items remaining — export builds events only for what's left, so re-exporting after rescheduling won't duplicate things you've already checked off.`),
    el(
      "button",
      {
        class: "primary",
        style: "margin-top:0.6rem",
        onclick: () => {
          const ics = buildICS(currentDate, remaining);
          downloadICS(`elevate-${key}.ics`, ics);
        },
      },
      "Download / update today's calendar (.ics)"
    ),
  ]);
  wrap.appendChild(calCard);

  return wrap;

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
