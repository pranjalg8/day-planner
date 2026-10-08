// Builds a downloadable .ics file from a computed day's items. iOS Safari
// opens a downloaded .ics straight into the "Add to Calendar" sheet.

function pad(n) {
  return String(n).padStart(2, "0");
}

function icsDateLocal(dateObj, hh, mm) {
  // Floating local time (no Z suffix) so it displays at the wall-clock time
  // shown in the app regardless of the importing device's timezone setting.
  return `${dateObj.getFullYear()}${pad(dateObj.getMonth() + 1)}${pad(dateObj.getDate())}T${pad(hh)}${pad(mm)}00`;
}

function icsNow() {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeText(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

const CATEGORY_DURATION_MIN = {
  food: 30,
  medicine: 5,
  exercise: 15,
  workout: 30,
  water: 1,
  measure: 5,
  prep: 10,
};

function description(item) {
  const parts = [item.notes, ...(item.links || []).map((l) => `${l.name}: ${l.url}`)];
  return parts.filter(Boolean).join("\n");
}

const HEADER = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//elevate-day-planner//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];

function eventLines(dateObj, item) {
  const [hh, mm] = item.time.split(":").map(Number);
  const durationMin = item.durationMin ?? CATEGORY_DURATION_MIN[item.category] ?? 10;
  const endMinutes = hh * 60 + mm + durationMin;
  const endHH = Math.floor(endMinutes / 60) % 24;
  const endMM = endMinutes % 60;
  const endDate = new Date(dateObj);
  endDate.setDate(endDate.getDate() + Math.floor(endMinutes / 1440));
  const uid = `${item.id}-${dateObj.getFullYear()}${pad(dateObj.getMonth() + 1)}${pad(dateObj.getDate())}@elevate-day-planner`;
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsNow()}`,
    `DTSTART:${icsDateLocal(dateObj, hh, mm)}`,
    `DTEND:${icsDateLocal(endDate, endHH, endMM)}`,
    `SUMMARY:${escapeText(item.label)}`,
    description(item) ? `DESCRIPTION:${escapeText(description(item))}` : null,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(item.label)}`,
    "TRIGGER:-PT2M",
    "END:VALARM",
    "END:VEVENT",
  ];
}

/**
 * Multi-day builder.
 * @param {Array<{date: Date, items: Array}>} days
 */
export function buildMultiDayICS(days) {
  const lines = [...HEADER];
  for (const { date, items } of days) for (const item of items) lines.push(...eventLines(date, item));
  lines.push("END:VCALENDAR");
  return lines.filter(Boolean).join("\r\n");
}

/**
 * @param {Date} dateObj - the calendar day these items belong to.
 * @param {Array} items - output of computeDay(), only the ones to export.
 */
export function buildICS(dateObj, items) {
  return buildMultiDayICS([{ date: dateObj, items }]);
}

export function downloadICS(filename, icsText) {
  const blob = new Blob([icsText], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
