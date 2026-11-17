# Pathletics

Four tabs for a client training toward a goal, switched at the bottom: **Today**, **Plan**, **Progress**, **Settings**. His profile opens from his picture top right, like Apple Fitness.

**The look** (17 Nov, Keli: "analyze the fitness app by apple… use more than just 1 color"): laid out like Apple's Fitness app on iOS 27. Big bold title, black (or light grey) screen, rounded cards, big coloured numbers with the unit in small capitals, a floating tab bar. Before that it was Strava-style with one pink (17 Nov), and before that near-black glow cards (14–17 Nov).

Four colours, each with one meaning, so they read at a glance:

| Colour | Means | Where |
|---|---|---|
| **Pink** | the goal | ladder rings, trend line, active tab, the brand |
| **Lime** | done | hit sets, finished workouts, the Start/Save buttons |
| **Sky** | schedule | up next, workouts per week |
| **Gold** | records | PR medals only |

- Apple asks apps not to copy the Activity rings (three nested rings), so the ladder is three separate rings side by side.
- Numbers use the phone's rounded font (Nunito where the phone has none). Text is the system font. Outfit is only the wordmark, which keeps its fading copies in the header and on the icon.
- **Light, dark or system:** set under Settings → Appearance. System follows the phone. The rules and all colours are at the top of `styles.css`.

- **Today** (opens here): **today's workout** from the coach's plan, nothing else. Like Yapp, he **starts** it (until then it's a list of what's coming and a Start button), types into one card per exercise with a disc per set, and **saves** it. **Start also starts a clock** at the top, like recording on Strava, with **Pause / Resume** beside it (Keli, 17 Nov); Save stops it. A hit set turns lime; each exercise has a small ring that fills as sets are hit and ticks when done. Saved, it's a summary card (time, sets, new PRs with gold medals, what's next) with Edit and "Delete workout" (two taps).
- **Plan**: **this week's** workouts, with a segmented bar (lime done, sky up next) and a list marked done, today, up next or missed. Tap one to see it or log it.
- **Progress**: the **ladder** as three rings (for the first client: pull-ups → chest-to-bar → muscle-up) and a trend card for the step he's on; tap a ring to type a test. Below: workouts and sets this week against last week with mini bars, and one row per exercise with his record and a line of his best per week.
- **Profile** (his picture top right, Keli 17 Nov): his initial in a pink circle, or a person until he types a name; tapping it opens his name, goal, lifetime workouts, sets and PRs, with a back button to where he was and **Edit profile** (scrolls down to Name). Under that, his **Activities**: every saved workout as a card, newest first, like Strava's (his name, "Today at 18:30", a title after the time of day such as "Evening Legs", then Time, Sets and PRs). Tapping one opens that workout, with ‹ Profile to go back. At the bottom, the same **Settings** as the Settings tab (Keli 17 Nov). A profile picture would show in that same circle: `avatarHtml()` in `app.js` draws it in both places.
- **Settings** (the last tab, and again at the bottom of the profile): Name and Appearance (System / Light / Dark). Both stay on the phone. `settingsGroupHtml()` draws them in both places.

**Everything is in English** (Keli, 17 Nov): the screen, the plan-file error messages and the plan itself. From 14 to 17 Nov it was in German; the plan reader still takes German units (`Sek`, `Wdh`).

The coach's plan is a **text file**, not code. Client three with the same goal needs nothing new; a different goal is a new plan file.

## Install on an iPhone

Open the link in Safari, then **⋯ → Share → View More → Add to Home Screen → Add** (leave "Open as Web App" on). Do this **before logging anything**, then always open it from the home-screen icon. The home-screen app and Safari keep separate data (found on Yapp).

First open: on **Progress**, tap each ladder ring and type the test result. With one plan in the file it is picked for him and there's no plan chip. That's the whole setup.

## Where things live

- **Hosting:** GitHub Pages. Free, no renewals.
- **The plan:** `plans/muscle-up.md`. Keli writes it in the vault at `business/client-plans/muscle-up.md`; `tools/sync_plan.sh` checks it and copies it here.
- **What the client logs:** on his phone only (localStorage, key `coach.v1`; his name and light/dark setting under `coach.prefs`). Nothing is sent anywhere, and this repo holds no logs and nothing about who the client is. Keep it that way: the repo is public. Removing the home-screen app deletes his logs.
- **Offline:** `sw.js` keeps a copy of the page and the plan, so it opens with no signal. A changed plan reaches the phone the next time it opens with signal (sometimes one open later).

## The plan file

```
# Ladder
- Pull-ups: 10
- Chest-to-bar: 5
- Muscle-up: 1

# Plan A: who it's for
A plain line is for the coach only: the app doesn't show it.

## Week 1

### Day 1
- Exercise: 3 x 5            3 sets of 5 reps
- Exercise: 3 x 20s          seconds
- Exercise: 3 x max          he types whatever he got
- Exercise: 3 x 8-12         a range: the bottom number counts as hitting it
- Exercise: 5, 4, 3          a different goal per set
- Exercise: 3 x 5 | note     everything after | is shown under the name
- Something to remember      no colon: a reminder with no fields
```

(The numbers above only show the format.) Anything he has to see goes after `|` on an exercise, or on its own as a reminder line. Seconds can also be written `sec` or `seconds` (or German `Sek`, `Sekunden`), reps `reps` (or `Wdh`). Obsidian comments (`%% ... %%`), HTML comments and front matter are ignored, so instructions can live in the file.

**Check before every push:**

```bash
node tools/check_plan.mjs plans/muscle-up.md
```

It prints every plan as the app will read it and refuses typos with a line number. If a broken file ever reaches the phone, the app shows the same list instead of the session.

## How it decides things

- **Which session opens:** one he started today; otherwise the one after the furthest session he has logged anything in (so a skipped day doesn't pin the app to it); otherwise the first. `currentIndex()` in `logic.js`.
- **A session's date** is the day he started it. Fixing an old number later doesn't move it.
- **The clock** is three numbers on the workout's log: `t0` when he pressed Start, `ms` counted so far, `run` when it last started (none while paused or saved). The time on screen is worked out from them, so it keeps counting with the app closed and holds while paused. Editing a saved workout doesn't run it again. Workouts started before the clock existed have none and show no time. `elapsed()`, `pauseClock()`, `resumeClock()` and `activities()` in `logic.js`.
- **Start, save, edit** work like Yapp: Start makes an empty session, Save needs at least one number, Edit keeps a copy so "Stop editing" puts the saved numbers back, and "Stop workout" on a new session throws it away (both two taps). A session started on an earlier day with nothing typed is dropped when the app opens. Saving is a summary, not a gate: the Plan list, the ladder and Progress count every number he typed, saved or not, like Yapp. A PR on the saved card has to beat every earlier day for that exercise. `startSession()` to `tidyLogs()` and `sessionSummary()` in `logic.js`.
- **The ladder:** each step's best is the higher of (a) a test typed in by tapping the step and (b) any logged set of an exercise with exactly that step's name, capitals ignored. So "Negative pull-ups" never counts as a pull-up. One test per step per day; typing again the same day replaces it, an empty one removes it. `ladderState()` in `logic.js`.
- **Hit:** at least the bottom of the goal; any number counts for "max". A hit disc turns lime.
- **Progress:** weeks run Monday to Sunday. A workout counts in the week of its date once it has a number in it. Exercise cards match by name and unit across days and plans, and only count logged sets (tests move the rings, not the cards). The charts start at his first logged week, at least 4 weeks and at most 8 back. `weeklyTotals()` and `exerciseStats()` in `logic.js`.
- **Switching plan** keeps everything: logs are stored per plan and day, and the ladder counts all of them.
- **Logs are keyed by plan, week title and day title,** and exercises by name. Renaming a week or day in the plan file after he has logged it hides those logs from the session (the ladder still counts them). Adding or reordering exercises is safe.

## Files

| Change | File |
|---|---|
| The plan, the ladder, the targets | `plans/muscle-up.md` (via the vault copy) |
| How the plan file is read, which session opens, the ladder rule | `logic.js` |
| The screen | `app.js` |
| Colours, fonts, the design rules | top of `styles.css` (light and dark tokens; `--pink`, `--lime`, `--sky`, `--gold`) |
| Light/dark before first paint | inline script in `index.html` (keep in step with `applyTheme()` in `app.js`) |
| App name | `index.html` (title, apple-mobile-web-app-title, h1) and `manifest.webmanifest` |
| Icon | `tools/icon.html` draws it, `python3 -I tools/make_icon.py` saves `icon-180.png` and `icon-512.png` (open the link it prints) |

**Before pushing:**

```bash
node --test tests/logic.test.mjs
```

**To preview locally:** copy the site into `qa/site` (ignored by git) with the demo plan from `tests/fixtures/demo.md`, then

```bash
python3 -m http.server 8921 --bind 127.0.0.1 --directory qa/site
```

**After changing any file the phone caches,** bump `CACHE` in `sw.js` only if a file is added or removed from `SHELL`. Changed contents are picked up without it.

## Don't touch

- The `coach.v1` storage key. If the data shape ever has to change, migrate on load and keep the old key as a backup.
- Week and day titles of a plan the client is already using (see above).

## Known limits

- One phone, no backup, no way for the coach to see logs remotely. Fine while the coach sees him every week.
- One goal per app for now (`PLAN_URL` in `app.js`). A client with a different goal needs a way to pick the plan file, probably a per-client link.
- Reps and seconds only, no kg.
