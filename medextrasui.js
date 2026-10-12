// DOM for the medicine extras (logic lives in medextras.js).
import { MEDICINES } from "./data.js";
import { effectiveProgram } from "./planstore.js";
import { el as h } from "./dom.js";
import { noteKeyOf, getMedNote, setMedNote, supplyStatus, refillMessages, DOCTOR_LINE, REFILL_ADVICE, MAX_NOTE_LENGTH } from "./medextras.js";

const DISMISS_KEY = "day-planner-ui:refillDismissed"; // UI-only: not backed up
const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Extra lines for a medicine row on Today: your note, and the doctor line. */
export function medItemExtras(item) {
  if (item.category !== "medicine") return null;
  const note = getMedNote(item.id);
  return h("div", { class: "med-extra" }, [
    note ? h("div", { class: "med-note" }, [h("strong", {}, "Your note: "), note]) : null,
    h("div", { class: "muted med-doctor" }, DOCTOR_LINE),
  ]);
}

function dismissedToday() {
  try { return localStorage.getItem(DISMISS_KEY) === todayKey(); } catch { return false; }
}

/** Today-tab reminder when a course is about to run out; null otherwise. */
export function refillNudge() {
  if (dismissedToday()) return null;
  const msgs = refillMessages(new Date(), effectiveProgram());
  if (!msgs.length) return null;
  const card = h("div", { class: "card refill-nudge", role: "region", "aria-label": "Medicine course ending" }, [
    ...msgs.map((m) => h("p", { class: "refill-msg" }, m)),
    h("p", { class: "muted refill-advice" }, REFILL_ADVICE),
    h("div", { class: "actions-row" }, [
      h("button", { type: "button", class: "secondary", id: "refill-dismiss", onclick: () => { try { localStorage.setItem(DISMISS_KEY, todayKey()); } catch { /* ignore */ } card.remove(); } }, "Got it, hide for today"),
    ]),
  ]);
  return card;
}

const STATUS_TEXT = { "not-started": "Not started", ok: "On track", soon: "Ending soon", last: "Last day", ended: "Finished" };

/** Meds-tab card: where each course stands. */
export function supplyCard() {
  const p = effectiveProgram();
  const s = supplyStatus(new Date(), p);
  const dailyLine = s.daily.status === "ended" ? `Ended ${s.daily.endDate}`
    : s.daily.status === "not-started" ? `Starts ${p.dailyMedsCourseStart}`
    : `${s.daily.daysLeft} day${s.daily.daysLeft === 1 ? "" : "s"} left after today (ends ${s.daily.endDate})`;
  const weeklyLine = s.weekly.status === "ended" ? `Ended ${s.weekly.lastDose}`
    : s.weekly.status === "not-started" ? `Starts ${p.weeklyMedStart}`
    : `${s.weekly.dosesLeft} dose${s.weekly.dosesLeft === 1 ? "" : "s"} left, next ${s.weekly.nextDose}`;
  const row = (label, status, text) => h("div", { class: "supply-row" }, [
    h("div", {}, [h("strong", {}, label), h("div", { class: "muted trk-small" }, text)]),
    h("span", { class: `chip supply-${status}` }, STATUS_TEXT[status]),
  ]);
  const needsAdvice = ["soon", "last"].includes(s.daily.status) || ["soon", "last"].includes(s.weekly.status);
  return h("div", { class: "card", id: "supply-card" }, [
    h("h2", {}, "Supply and refills"),
    row(`Daily medicines (${p.dailyMedsCourseDays}-day course)`, s.daily.status, dailyLine),
    row(`Weekly dose (${p.weeklyMedCourseWeeks} weeks)`, s.weekly.status, weeklyLine),
    needsAdvice ? h("p", { class: "refill-advice" }, REFILL_ADVICE) : null,
    h("p", { class: "muted trk-small" }, "Counted from the dates in Plan → Program dates."),
  ]);
}

/** Meds-tab card: a short note per medicine. */
export function notesCard(rerender) {
  const seen = new Set();
  const meds = MEDICINES.filter((m) => { const k = noteKeyOf(m.id); if (seen.has(k)) return false; seen.add(k); return true; });
  return h("div", { class: "card", id: "med-notes" }, [
    h("h2", {}, "My notes"),
    h("p", { class: "muted trk-small" }, "For things like \"take with the bigger meal\" or the pharmacy's name. Shown when you expand a dose on Today."),
    ...meds.map((m) => {
      const ta = h("textarea", { class: "med-note-input", rows: "2", maxlength: String(MAX_NOTE_LENGTH), "aria-label": `Note for ${m.name}`, placeholder: "Add a note" }, []);
      ta.value = getMedNote(m.id);
      const status = h("span", { class: "muted trk-small", role: "status" }, "");
      return h("div", { class: "med-note-row" }, [
        h("label", { class: "med-note-label" }, m.name),
        ta,
        h("div", { class: "actions-row" }, [
          h("button", { type: "button", class: "secondary", "data-med": m.id, onclick: () => { setMedNote(m.id, ta.value); status.textContent = "Saved"; if (rerender) rerender(); } }, "Save"),
          status,
        ]),
      ]);
    }),
  ]);
}
