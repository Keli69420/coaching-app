# Coaching app (name to come)

Two tabs for a client training toward a goal, switched at the bottom like Yapp.

**The look** (14 Nov, from reference shots Keli sent): near-black with a faint dot grid, frosted dark cards, saturated glow cards (violet, pink, blue, teal, orange), big numbers in a dot-matrix font (Doto, round dots), dials as rings of ticks, thin geometric text (Outfit).

- **Training** (opens here): **today's session** from the coach's plan, nothing else. A dot per session for the whole plan. Like Yapp, he **starts** the session (until then it's a list of what's coming and a Start button), types into one card per exercise with a disc per set, and **saves** it. Each exercise card has its own colour (violet, pink, blue, teal, orange); a hit set turns white and the card glows brighter in its colour as sets get hit. Saved, the session is a summary card (sets, new records, what's next) with Bearbeiten to change it and "Training löschen" (two taps) to remove it.
- **Fortschritt**: the **ladder** as three tiles with a tick dial each, showing how close he is (for the first client: pull-ups → chest-to-bar → muscle-up) and a trend card for the step he's on; tap a dial to type a test. Below it, like Yapp's Progress page: this week's trainings and sets against last week, sets per week as columns of dots, and one card per exercise with his record, this week against the last week he did it, and a line of his best per week.

**The screen is in German** (Swiss: du, "ss" never "ß"), and so are the plan-file error messages. This README and `tools/` stay in English.

The coach's plan is a **text file**, not code. Client three with the same goal needs nothing new; a different goal is a new plan file.

## Install on an iPhone

Open the link in Safari, then **⋯ → Share → View More → Add to Home Screen → Add** (leave "Open as Web App" on). Do this **before logging anything**, then always open it from the home-screen icon. The home-screen app and Safari keep separate data (found on Yapp).

First open: on Fortschritt, tap each ladder step and type the test result. With one plan in the file it is picked for him and there's no plan chip. That's the whole setup.

## Where things live

- **Hosting:** GitHub Pages. Free, no renewals.
- **The plan:** `plans/muscle-up.md`. Keli writes it in the vault at `business/client-plans/muscle-up.md`; `tools/sync_plan.sh` checks it and copies it here.
- **What the client logs:** on his phone only (localStorage, key `coach.v1`). Nothing is sent anywhere, and this repo holds no logs and nothing about who the client is. Keep it that way: the repo is public. Removing the home-screen app deletes his logs.
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

(The numbers above only show the format.) Anything he has to see goes after `|` on an exercise, or on its own as a reminder line. Seconds can also be written `Sek` or `Sekunden`, reps `Wdh`. Obsidian comments (`%% ... %%`), HTML comments and front matter are ignored, so instructions can live in the file.

**Check before every push:**

```bash
node tools/check_plan.mjs plans/muscle-up.md
```

It prints every plan as the app will read it and refuses typos with a line number. If a broken file ever reaches the phone, the app shows the same list instead of the session.

## How it decides things

- **Which session opens:** one he started today; otherwise the one after the furthest session he has logged anything in (so a skipped day doesn't pin the app to it); otherwise the first. `currentIndex()` in `logic.js`.
- **A session's date** is the day he started it. Fixing an old number later doesn't move it.
- **Start, save, edit** work like Yapp: Start makes an empty session, Save needs at least one number, Bearbeiten keeps a copy so "Bearbeiten abbrechen" puts the saved numbers back, and "Training abbrechen" on a new session throws it away (both two taps). A session started on an earlier day with nothing typed is dropped when the app opens. Saving is a summary, not a gate: the dots, the ladder and Fortschritt count every number he typed, saved or not, like Yapp. A record on the saved card has to beat every earlier day for that exercise. `startSession()` to `tidyLogs()` and `sessionSummary()` in `logic.js`.
- **The ladder:** each step's best is the higher of (a) a test typed in by tapping the step and (b) any logged set of an exercise with exactly that step's name, capitals ignored. So "Negative pull-ups" never counts as a pull-up. One test per step per day; typing again the same day replaces it, an empty one removes it. `ladderState()` in `logic.js`.
- **Hit:** at least the bottom of the goal; any number counts for "max". A hit set gets the volt tick.
- **Fortschritt:** weeks run Monday to Sunday. A training counts in the week of its date once it has a number in it. Exercise cards match by name and unit across days and plans, and only count logged sets (tests move the rings, not the cards). The charts start at his first logged week, at least 4 weeks and at most 8 back. `weeklyTotals()` and `exerciseStats()` in `logic.js`.
- **Switching plan** keeps everything: logs are stored per plan and day, and the ladder counts all of them.
- **Logs are keyed by plan, week title and day title,** and exercises by name. Renaming a week or day in the plan file after he has logged it hides those logs from the session (the ladder still counts them). Adding or reordering exercises is safe.

## Files

| Change | File |
|---|---|
| The plan, the ladder, the targets | `plans/muscle-up.md` (via the vault copy) |
| How the plan file is read, which session opens, the ladder rule | `logic.js` |
| The screen | `app.js` |
| Colours, fonts | top of `styles.css` |
| App name | `index.html` (title, apple-mobile-web-app-title, h1) and `manifest.webmanifest` |
| Icon | `tools/make_icon.py` writes `icon-180.png`, `icon-512.png`, `icon.svg` |

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
