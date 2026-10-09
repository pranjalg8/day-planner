// Weekly grocery list generated from the meal rotation (plus any per-date
// swaps from the plan). Quantity parsing is best effort: ingredients with a
// parseable quantity are summed; the rest are listed per meal.

import { ACTIONS } from "./data.js";
import { MEAL_SLOTS, SLOT_LABELS, mealFor, loadPlan, normalizePlan, dateKeyOf } from "./planstore.js";

// ---- pure parsing ----
const NOISE = /\b(raw|soaked|chopped|small|large|steamed|sauteed|sautéed|fresh|each|cooked)\b/g;
const SYNONYMS = [
  [/^soy(a)? chunks?( .*)?$/, "soya chunks"],
  [/^sooji\/suji$|^suji$|^sooji$/, "sooji"],
  [/^paneer( cubes| tikka| stuffing)?$/, "paneer"],
  [/^flour$/, "wheat flour"],
  [/^dal$/, "dal (raw)"],
  [/^curd( bowl)?$/, "curd"],
  [/^sprouts( salad| chaat)?$/, "sprouts"],
  [/^(veg|vegetables?|mix veg|stir-fried vegetables|vegetable)$/, "vegetables"],
  [/^(olive )?oil$/, "oil"],
  [/^roti$/, "roti"],
];
const SKIP = /^(warm water|water|spices?)$/;
const QTY_RE = /(\d+(?:\.\d+)?)\s*(kg|g|ml|l|tbsp|tsp|katori|slices?)?(?![a-z\d])/i;

function cleanName(s) {
  let n = s.toLowerCase().replace(/^\d+(?:\.\d+)?\s*/, "").replace(NOISE, " ").replace(/[()]/g, " ").replace(/\s+/g, " ").trim().replace(/^[+,\-\s]+|[+,\-\s]+$/g, "");
  for (const [re, to] of SYNONYMS) if (re.test(n)) return to;
  return n;
}

function parseQty(str) {
  const m = str.match(QTY_RE);
  if (!m) return null;
  let qty = parseFloat(m[1]);
  let unit = (m[2] || "").toLowerCase();
  if (unit === "kg") { qty *= 1000; unit = "g"; }
  else if (unit === "l") { qty *= 1000; unit = "ml"; }
  else if (unit === "slice") unit = "slices";
  return { qty, unit: unit || "pcs", rest: (str.slice(0, m.index) + " " + str.slice(m.index + m[0].length)).trim() };
}

function splitTop(text, sep) {
  const out = [];
  let depth = 0, cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    if (c === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && text.startsWith(sep, i)) { out.push(cur); cur = ""; i += sep.length - 1; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parsePart(part) {
  const paren = part.match(/^(.*?)\s*\(([^()]*\d[^()]*)\)\s*(.*)$/);
  if (paren) {
    const [, head, inside, tail] = paren;
    const q = parseQty(inside);
    if (q) {
      const fromInside = cleanName(q.rest);
      const name = fromInside && fromInside !== "raw" ? fromInside : cleanName(`${head} ${tail}`);
      return [{ name, qty: q.qty, unit: q.unit }];
    }
  }
  const stripped = part.replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ").trim();
  const q = parseQty(stripped);
  if (q) return [{ name: cleanName(q.rest), qty: q.qty, unit: q.unit }];
  return [{ name: cleanName(stripped), qty: null, unit: null }];
}

/** "Besan chilla (40g besan) + oil 1 tsp" -> [{ name, qty, unit }]. qty null = unquantified. */
export function parseMeal(text) {
  const body = String(text || "").split("—")[0];
  const out = [];
  for (const part of splitTop(body, " + ")) {
    const inner = part.match(/^[^()]*\((.*\s\+\s.*)\)$/);
    const pieces = inner ? splitTop(inner[1], " + ") : [part];
    for (const p of pieces) for (const it of parsePart(p)) if (it.name && !SKIP.test(it.name)) out.push(it);
  }
  return out;
}

export function formatQty(qty, unit) {
  const r = (n) => String(Math.round(n * 100) / 100);
  if (unit === "g") return qty >= 1000 ? `${r(qty / 1000)} kg` : `${r(qty)} g`;
  if (unit === "ml") return qty >= 1000 ? `${r(qty / 1000)} L` : `${r(qty)} ml`;
  if (unit === "pcs") return `${r(qty)} pcs`;
  return `${r(qty)} ${unit}`;
}

/**
 * @param {Date[]} dates - the days to shop for (usually a week).
 * @param {object} [plan] - plan with meal swaps (defaults to saved plan).
 * @returns {{ items: {key,name,qtyText}[], other: {slot,label,names:string[]}[], days: number }}
 */
export function buildGrocery(dates, plan = loadPlan()) {
  plan = normalizePlan(plan);
  const totals = new Map(); // name -> Map(unit -> qty)
  const unq = new Map(); // slot -> Set(name)
  for (const d of dates) {
    const key = dateKeyOf(d);
    for (const slot of MEAL_SLOTS) {
      for (const it of parseMeal(mealFor(plan, key, slot, d.getDay()))) {
        if (it.qty === null) {
          if (!unq.has(slot)) unq.set(slot, new Set());
          unq.get(slot).add(it.name);
        } else {
          if (!totals.has(it.name)) totals.set(it.name, new Map());
          const u = totals.get(it.name);
          u.set(it.unit, (u.get(it.unit) || 0) + it.qty);
        }
      }
    }
  }
  if (dates.length) {
    const u = (totals.get("cucumber") || totals.set("cucumber", new Map()).get("cucumber"));
    u.set("slices", (u.get("slices") || 0) + ACTIONS.cucumberSlices * 3 * dates.length);
  }
  const items = [...totals]
    .map(([name, units]) => ({ key: name, name, qtyText: [...units].map(([unit, q]) => formatQty(q, unit)).join(" + ") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const other = [];
  for (const slot of MEAL_SLOTS) {
    const names = [...(unq.get(slot) || [])].filter((n) => !totals.has(n)).sort();
    if (names.length) other.push({ slot, label: SLOT_LABELS[slot], names });
  }
  return { items, other, days: dates.length };
}

/** Plain-text version for clipboard / share. `checked` is a Set of item keys to mark. */
export function groceryText(list, title = "Grocery list", checked = new Set()) {
  const lines = [title, ""];
  for (const it of list.items) lines.push(`${checked.has(it.key) ? "[x]" : "[ ]"} ${it.name} — ${it.qtyText}`);
  for (const o of list.other) lines.push("", `${o.label} (no quantity listed):`, ...o.names.map((n) => `${checked.has(`other:${o.slot}:${n}`) ? "[x]" : "[ ]"} ${n}`));
  return lines.join("\n");
}

/** The 7 days (Mon..Sun) of the week containing `now`, shifted by `weekOffset` weeks. */
export function weekOf(now = new Date(), weekOffset = 0) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + 7 * weekOffset);
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
}

// ---- checked-state storage: { [weekStartKey]: string[] } ----
const GROCERY_KEY = "elevate-planner:grocery";

export function loadChecked(weekKey) {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(GROCERY_KEY) || "{}");
    return new Set(Array.isArray(v?.[weekKey]) ? v[weekKey] : []);
  } catch {
    return new Set();
  }
}

export function saveChecked(weekKey, set) {
  try {
    let v = {};
    try { v = JSON.parse(localStorage.getItem(GROCERY_KEY) || "{}") || {}; } catch { v = {}; }
    if (set.size) v[weekKey] = [...set];
    else delete v[weekKey];
    const keep = Object.keys(v).sort().slice(-6); // prune old weeks
    for (const k of Object.keys(v)) if (!keep.includes(k)) delete v[k];
    if (Object.keys(v).length) localStorage.setItem(GROCERY_KEY, JSON.stringify(v));
    else localStorage.removeItem(GROCERY_KEY);
    return true;
  } catch {
    return false;
  }
}

// ---- DOM ----
function h(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

let weekOffset = 0;

export function groceryCard(rerender) {
  const dates = weekOf(new Date(), weekOffset);
  const weekKey = dateKeyOf(dates[0]);
  const list = buildGrocery(dates);
  const checked = loadChecked(weekKey);
  const title = `Grocery list, week of ${weekKey}`;
  const status = h("div", { class: "muted", role: "status", id: "grocery-status" });

  const row = (key, name, qty) =>
    h("label", { class: `grocery-row${checked.has(key) ? " got" : ""}` }, [
      h("input", {
        type: "checkbox", class: "checkbox", checked: checked.has(key) ? "checked" : null, "data-key": key,
        onchange: (e) => { if (e.target.checked) checked.add(key); else checked.delete(key); saveChecked(weekKey, checked); rerender(); },
      }),
      h("span", { class: "grocery-name" }, name),
      qty ? h("span", { class: "grocery-qty" }, qty) : null,
    ]);

  const copy = async () => {
    const text = groceryText(list, title, checked);
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "Copied to clipboard.";
    } catch {
      const ta = h("textarea", { style: "position:fixed;opacity:0" });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { /* ignore */ }
      ta.remove();
      status.textContent = ok ? "Copied to clipboard." : "Couldn't copy on this browser.";
    }
  };

  return h("div", { class: "card", id: "grocery-card" }, [
    h("h2", {}, "Grocery list"),
    h("div", { class: "row" }, [
      h("button", { class: "secondary", onclick: () => { weekOffset -= 1; rerender(); } }, "‹ Prev"),
      h("strong", {}, weekOffset === 0 ? "This week" : weekOffset === 1 ? "Next week" : `Week of ${weekKey}`),
      h("button", { class: "secondary", onclick: () => { weekOffset += 1; rerender(); } }, "Next ›"),
    ]),
    h("p", { class: "muted" }, `Totals for ${list.days} days of the menu rotation (incl. any meal swaps), best-effort from the quantities in the menu. Check items off as you shop.`),
    h("div", { class: "grocery-list" }, list.items.map((it) => row(it.key, it.name, it.qtyText))),
    ...list.other.flatMap((o) => [
      h("h3", { class: "grocery-sub" }, `${o.label} — no quantity listed`),
      h("div", { class: "grocery-list" }, o.names.map((n) => row(`other:${o.slot}:${n}`, n, ""))),
    ]),
    h("div", { class: "actions-row cal-actions" }, [
      h("button", { class: "primary", id: "grocery-copy", onclick: copy }, "Copy list"),
      typeof navigator !== "undefined" && navigator.share
        ? h("button", { class: "secondary", onclick: () => navigator.share({ title, text: groceryText(list, title, checked) }).catch(() => {}) }, "Share")
        : null,
      checked.size ? h("button", { class: "secondary", onclick: () => { saveChecked(weekKey, new Set()); rerender(); } }, "Clear ticks") : null,
    ]),
    status,
  ]);
}
