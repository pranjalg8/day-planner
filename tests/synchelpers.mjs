export function stubStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}
export function fakeClock(start = 1_000_000) {
  const c = { t: start, now: () => c.t, advance(ms) { c.t += ms; c.runTimers(); }, timers: [], nextId: 1 };
  c.setTimer = (fn, ms) => { const id = c.nextId++; c.timers.push({ id, at: c.t + ms, fn }); return id; };
  c.clearTimer = (id) => { c.timers = c.timers.filter((x) => x.id !== id); };
  c.runTimers = () => { for (;;) { const due = c.timers.filter((x) => x.at <= c.t).sort((a, b) => a.at - b.at)[0]; if (!due) return; c.timers = c.timers.filter((x) => x !== due); due.fn(); } };
  return c;
}
export const tick = () => new Promise((r) => setImmediate(r));
export async function settle(n = 20) { for (let i = 0; i < n; i++) await tick(); }
