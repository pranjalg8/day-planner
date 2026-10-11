// Medicine extras: per-medicine notes and course/supply status.
// Pure functions (storage and dates are passed in) so they can be tested without a browser.
// Nothing here is medical advice; it only counts days in the course you entered.

export const NOTES_KEY = "elevate-planner:medNotes"; // included in backups
export const DOCTOR_LINE = "Not medical advice. Check with your doctor if unsure.";
export const REFILL_SOON_DAYS = 5; // warn when this many days (or fewer) of the daily course remain
export const MAX_NOTE_LENGTH = 500;

/** Stable N Fit AM/PM (and similar) share one note. */
export const noteKeyOf = (medId) => medId.replace(/-(am|pm)$/, "");

function readNotes(storage) {
  try {
    const v = JSON.parse(storage.getItem(NOTES_KEY));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function getMedNote(medId, storage = globalThis.localStorage) {
  const v = readNotes(storage)[noteKeyOf(medId)];
  return typeof v === "string" ? v : "";
}

/** Saves (or clears, when blank) the note. Returns the stored text. */
export function setMedNote(medId, text, storage = globalThis.localStorage) {
  const all = readNotes(storage);
  const clean = String(text ?? "").trim().slice(0, MAX_NOTE_LENGTH);
  const key = noteKeyOf(medId);
  if (clean) all[key] = clean;
  else delete all[key];
  try {
    storage.setItem(NOTES_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: ignore */
  }
  return clean;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const parse = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);

/**
 * Where each course stands today.
 * daily:  { kind, status, daysLeft, endDate }  daysLeft counts days after today; 0 = last day.
 * weekly: { kind, status, dosesLeft, nextDose, lastDose }  dosesLeft includes the next dose.
 * status: "not-started" | "ok" | "soon" | "last" | "ended"
 */
export function supplyStatus(today, program) {
  const start = parse(program.dailyMedsCourseStart);
  const days = program.dailyMedsCourseDays;
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days - 1);
  const dayNo = daysBetween(start, today) + 1;
  const daysLeft = daysBetween(today, end);
  let dStatus;
  if (dayNo < 1) dStatus = "not-started";
  else if (daysLeft < 0) dStatus = "ended";
  else if (daysLeft === 0) dStatus = "last";
  else if (daysLeft <= REFILL_SOON_DAYS) dStatus = "soon";
  else dStatus = "ok";

  const wStart = parse(program.weeklyMedStart);
  const weeks = program.weeklyMedCourseWeeks;
  const lastDose = new Date(wStart.getFullYear(), wStart.getMonth(), wStart.getDate() + (weeks - 1) * 7);
  let wStatus, dosesLeft = 0, nextDose = null;
  if (daysBetween(today, wStart) > 0) {
    wStatus = "not-started"; dosesLeft = weeks; nextDose = wStart;
  } else if (daysBetween(today, lastDose) < 0) {
    wStatus = "ended";
  } else {
    const since = daysBetween(wStart, today);
    const idx = Math.ceil(since / 7); // index of the next dose on/after today
    dosesLeft = weeks - idx;
    nextDose = new Date(wStart.getFullYear(), wStart.getMonth(), wStart.getDate() + idx * 7);
    wStatus = dosesLeft <= 1 ? "last" : dosesLeft <= 2 ? "soon" : "ok";
  }
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    daily: { kind: "daily", status: dStatus, daysLeft: Math.max(daysLeft, 0), endDate: key(end) },
    weekly: { kind: "weekly", status: wStatus, dosesLeft, nextDose: nextDose ? key(nextDose) : null, lastDose: key(lastDose) },
  };
}

/** Plain-language lines for courses that need attention soon. Empty when nothing does. */
export function refillMessages(today, program) {
  const s = supplyStatus(today, program);
  const out = [];
  const d = s.daily;
  if (d.status === "last") out.push(`Today is the last day of your ${program.dailyMedsCourseDays}-day medicine course.`);
  else if (d.status === "soon") out.push(`${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"} left in your ${program.dailyMedsCourseDays}-day medicine course (ends ${d.endDate}).`);
  const w = s.weekly;
  if (w.status === "last") out.push(`Your last weekly dose is on ${w.nextDose}.`);
  else if (w.status === "soon") out.push(`${w.dosesLeft} weekly doses left (next ${w.nextDose}).`);
  return out;
}

export const REFILL_ADVICE = "If you need more, ask your doctor or pharmacist about a refill or renewal before it runs out.";
