# Day Planner

A small static day-planner web app for a weight-management program: meal
windows, medicine timing (with buffer/dependency rules), post-meal walks,
water and step targets, and a weekly meal rotation.

No build step — plain HTML/CSS/JS, deployable as-is on GitHub Pages.

## What it does

Navigation: a bottom tab bar (Today, Log, Insights, Plan) plus a **More** sheet (Week, Workout, Meds, About). A one-time, skippable setup flow asks for wake/meal times, workout days, weight/goal and reminders (flag `elevate-planner-onboarded`, deliberately outside the backup prefix; re-run it from About). Program dates (plan start, medicine courses, review date) are editable on the Plan tab and stored in the plan overrides.

- **Today** — shows today's plan computed from `data.js`. Edit any actual
  time (wake, breakfast, lunch, dinner, bedtime, etc.) and everything
  dependent on it (medicine buffer windows, post-meal walks) recomputes
  automatically. Check items off as you go. Export the remaining items as an
  `.ics` file any time — iOS opens it straight into "Add to Calendar".
- **Week** — the 7-day meal rotation and daily targets at a glance.
- **Workout** — morning warm-up + bodyweight circuit and evening stretching, with video links.
- **Meds** — medicine reference table with dosing/timing notes.
- **About** — how to use it day to day, a **Share report** card (weekly Markdown summary for your coach: pick what to include, weight is off by default; Copy / Share / Download .md), plus Export/Import of your data (JSON backup).

## Design choices

- **No personal data committed.** The repo (and therefore the public GitHub
  Pages site) contains only the operational schedule: medicine names, doses,
  timing rules, and the meal rotation. No diagnosis, doctor/contact details,
  or payment info.
- **All user state is local.** Times you edit and items you check off are
  saved to `localStorage` in your browser only — nothing is sent anywhere or
  written back to the repo.
- **Calendar sync is manual by design.** GitHub Pages is static hosting, so
  there's no backend to push live reminders. The workaround: the app
  computes today's (possibly rescheduled) times, and a button generates an
  `.ics` you import into Calendar. Re-export after a reschedule — completed
  items are excluded, so re-importing won't create duplicates for anything
  you've already checked off.

## Updating the plan

Edit `data.js`:
- `MEDICINES` — dosing, slot, timing/buffer rules
- `MENUS` — the 7-day meal rotation (indexed Sun=0 .. Sat=6)
- `WORKOUT` — exercises, sets/reps, video links, and which weekdays they run
- `ACTIONS` — water/step/walk/cucumber targets
- `PROGRAM` — course start dates and durations

Commit and push — GitHub Pages redeploys automatically.

## Local preview

Any static file server works, e.g.:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Install as an app (PWA)

The site ships a web manifest and a service worker, so it works offline once
loaded. On iPhone: Safari, Share, Add to Home Screen. On Android/desktop
Chrome: use the install icon in the address bar or menu, Install app. The
service worker only registers over HTTPS or `localhost`.

**Releasing changes:** when any cached file changes, bump `CACHE` in `sw.js`
(e.g. `day-planner-v5`) so installed copies fetch the new shell. Every new
`.js`/`.css`/`.html`/icon file must also be listed in `SHELL` in `sw.js`;
`tests/shell.test.mjs` fails CI if one is missing. An updated worker waits
instead of taking over mid-session: the app shows a "New version available"
banner, and tapping Refresh sends `SKIP_WAITING` and reloads once the new
worker is active.

The theme (Auto / Light / Dark) is switched with the button in the header.

## Tests

The schedule engine has dependency-free tests (Node 22+, `node:test`):

```bash
npm test
```

CI runs the same command on every push and pull request
(`.github/workflows/test.yml`).

A browser smoke test (opens every tab at 420px, fails on console/page errors
or failed requests) is separate because it needs Playwright:

```bash
npm run smoke   # PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs to override
```

It skips with a message when Playwright or Chromium is unavailable. CI runs it
in its own `smoke` job.
