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
  water: 1,
  measure: 5,
  prep: 10,
};

/**
 * @param {Date} dateObj - the calendar day these items belong to.
 * @param {Array} items - output of computeDay(), only the ones to export.
 */
export function buildICS(dateObj, items) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//elevate-day-planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const item of items) {
    const [hh, mm] = item.time.split(":").map(Number);
    const durationMin = CATEGORY_DURATION_MIN[item.category] ?? 10;
    const startMinutes = hh * 60 + mm;
    const endMinutes = startMinutes + durationMin;
    const endHH = Math.floor(endMinutes / 60) % 24;
    const endMM = endMinutes % 60;
    const dayOverflow = Math.floor(endMinutes / 1440);
    const endDate = new Date(dateObj);
    endDate.setDate(endDate.getDate() + dayOverflow);

    const uid = `${item.id}-${dateObj.getFullYear()}${pad(dateObj.getMonth() + 1)}${pad(dateObj.getDate())}@elevate-day-planner`;

    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${icsNow()}`,
      `DTSTART:${icsDateLocal(dateObj, hh, mm)}`,
      `DTEND:${icsDateLocal(endDate, endHH, endMM)}`,
      `SUMMARY:${escapeText(item.label)}`,
      item.notes ? `DESCRIPTION:${escapeText(item.notes)}` : null,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(item.label)}`,
      "TRIGGER:-PT2M",
      "END:VALARM",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.filter(Boolean).join("\r\n");
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
