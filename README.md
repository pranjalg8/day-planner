# Day Planner

A small static day-planner web app for a weight-management program: meal
windows, medicine timing (with buffer/dependency rules), post-meal walks,
water and step targets, and a weekly meal rotation.

No build step — plain HTML/CSS/JS, deployable as-is on GitHub Pages.

## What it does

- **Today** — shows today's plan computed from `data.js`. Edit any actual
  time (wake, breakfast, lunch, dinner, bedtime, etc.) and everything
  dependent on it (medicine buffer windows, post-meal walks) recomputes
  automatically. Check items off as you go. Export the remaining items as an
  `.ics` file any time — iOS opens it straight into "Add to Calendar".
- **Week** — the 7-day meal rotation and daily targets at a glance.
- **Meds** — medicine reference table with dosing/timing notes.
- **About** — how to use it day to day.

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
- `ACTIONS` — water/step/walk/cucumber targets
- `PROGRAM` — course start dates and durations

Commit and push — GitHub Pages redeploys automatically.

## Local preview

Any static file server works, e.g.:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
