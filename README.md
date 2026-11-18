# Pathletics

Tabs for a client training toward a goal, switched at the bottom: **Today**, **Plan**, **Progress**, and **Groups** once it's switched on (see Groups setup). His profile opens from his picture top right, like Apple Fitness, and his settings are at the bottom of it.

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
- **Light, dark or system:** set under Profile → Settings → Appearance. System follows the phone. The rules and all colours are at the top of `styles.css`.

- **Today** (opens here): **today's workout** from the coach's plan, nothing else. Like Yapp, he **starts** it (until then it's a list of what's coming and a Start button), types into one card per exercise with a disc per set and a **kg** box under it (Keli, 18 Nov; empty for bodyweight), and **saves** it. **Start also starts a clock** at the top, like recording on Strava, with **Pause / Resume** beside it (Keli, 17 Nov); Save stops it. A hit set turns lime; each exercise has a small ring that fills as sets are hit and ticks when done. Saved, it's a summary card (time, sets, new PRs with gold medals, what's next) with Edit and "Delete workout" (two taps).
- **Plan**: the plan he's on at the top: **this week's** workouts, with a segmented bar (lime done, sky up next) and a list marked done, today, up next or missed. Tap one to see it or log it. Below that, **Your plans** (Keli, 18 Nov): the coach's plan and every plan he made, the one he's on ticked, and **New plan**.
  - **A plan's page:** its weeks, workouts and exercises, **Use this plan** (logs are kept, he can switch back), **Duplicate** (the coach's plan: "Copy to change it"), and for his own **Edit** and **Delete plan** (two taps).
  - **The builder** (Edit, or New plan): name, weeks, workouts, and per exercise a name, sets × reps, a **reps / sec** switch and a note. An empty number means "as many as you can". **Copy this week** adds the same workouts as the next week. Everything saves as he types; an exercise left without a name is dropped on Done.
  - `planpages.js` draws these, `plans.js` holds the rules; his plans are kept on the phone under `coach.plans`.
- **Progress**: the **ladder** as three rings (for the first client: pull-ups → chest-to-bar → muscle-up) and a trend card for the step he's on; tap a ring to type a test. Below: workouts and sets this week against last week with mini bars, and one row per exercise with his record and a line of his best per week.
- **Profile** (his picture top right, Keli 17 Nov): his photo (Keli 17 Nov: chosen under Settings → Profile), else his initial in a pink circle, or a person until he types a name; tapping it opens his name, goal, lifetime workouts, sets and PRs, with a back button to where he was and **Edit profile** (opens Settings → Profile). Under that, his **Activities**: every saved workout as a card, newest first, like Strava's (his name, "Today at 18:30", a title after the time of day such as "Evening Legs", then Time, Sets and PRs). Tapping one opens that workout, with ‹ Profile to go back. At the bottom, **Settings** (see below). `avatarHtml()` in `app.js` is the one place that draws his picture: top right, on the profile, on his activities and in Settings. The photo is cut to the middle square, shrunk to 256 px and kept as a small JPEG on the phone (`coach.avatar`, about 20 KB); `picture.js` holds the crop and the check that only such a JPEG is ever shown.
- **Settings** (Keli 17 Nov: no tab any more, in categories at the bottom of the profile): a list like Strava's, each row showing its current value and opening its own page with ‹ Profile, which goes back to the same spot. **Profile**: photo (Choose / Change / Remove) and Name. **Appearance**: System / Light / Dark. **Account** (only with Groups on): email, Sign out, Delete account (two taps; deletes his posts and memberships, never his logs). **Data & privacy**: logs stay on this phone, and deleting the home-screen app deletes them; with Groups on it also says that what he shares goes to the server. Name and theme stay on the phone. A new setting goes into `SETTINGS` and `settingHtml()` in `app.js`.

- **Groups** (Keli 17 Nov, `groups.js`): invite-only accounts (email + password), groups anyone can make, and posts like Strava's feed. **Share** under a saved workout or under a ladder step he has reached opens a sheet with a preview of exactly what goes (title, day, time, number of sets, PRs; never the set-by-set numbers or notes), who it goes to (always starts on his first group; **Everyone** means every member, a tap of its own each time; nothing is ever on the open web) and an optional caption. A group's owner gets an invite code (7 days, 20 people) that also lets a friend make an account. Posts: Delete your own, Report anyone else's, the owner removes any in the group. Members: the owner removes people; anyone can leave; when the owner leaves, the longest-standing member takes over, and the last one out deletes the group. His name and photo go up with his profile so others see them; signing in on a new phone brings them back down.

**Everything is in English** (Keli, 17 Nov): the screen, the plan-file error messages and the plan itself. From 14 to 17 Nov it was in German; the plan reader still takes German units (`Sek`, `Wdh`).

The coach's plan is a **text file**, not code. Client three with the same goal needs nothing new; a different goal is a new plan file.

## Install on an iPhone

Open the link in Safari, then **⋯ → Share → View More → Add to Home Screen → Add** (leave "Open as Web App" on). Do this **before logging anything**, then always open it from the home-screen icon. The home-screen app and Safari keep separate data (found on Yapp).

First open: on **Progress**, tap each ladder ring and type the test result. With one plan in the file it is picked for him. (With several, or after deleting the plan he was on, the app shows **Pick your plan** first.) That's the whole setup.

## Where things live

- **Hosting:** GitHub Pages. Free, no renewals.
- **The plan:** `plans/muscle-up.md`. Keli writes it in the vault at `business/client-plans/muscle-up.md`; `tools/sync_plan.sh` checks it and copies it here.
- **What the client logs:** on his phone only (localStorage, key `coach.v1`; his name and light/dark setting under `coach.prefs`, his photo under `coach.avatar`, plans he made under `coach.plans`). Logs are never sent anywhere, and this repo holds no logs and nothing about who the client is.
- **Groups:** a Supabase project (free plan, EU). Accounts, groups, posts, names and photos live there, behind the rules in `supabase/migrations/`. The sign-in is kept on the phone under `pathletics.session` (never the password). Only the project URL and the **publishable** key are in this repo (`config.js`); a secret key must never be. Keep it that way: the repo is public. Removing the home-screen app deletes his logs.
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
- **Hit:** at least the bottom of the goal; any number counts for "max". A hit disc turns lime. Weight plays no part in it.
- **Weight** (Keli, 18 Nov): every set has a small **kg** box under its disc; empty means bodyweight. It takes "60", "62,5", "+10" and a minus for help ("-20" for a band), rounded to 0.25. **The iPhone's number pad has no minus key,** so help can only be typed from a keyboard that has one; on the phone, give band work its own exercise name instead ("Band Pull-ups"). The box's text is 16 px on purpose: smaller, and Safari zooms the page on every tap. The box shows greyed what he loaded last time. Stored per log as `kg` beside `vals`, same positions; logs from before have none and read as before. `weight.js`.
  - **Records and PRs:** the heaviest set is the best; at the same weight, more reps (or seconds). An exercise that never had a weight is judged on reps, as before. Shown as "60 KG × 8". `better()` in `weight.js`, used by `exerciseStats()` and `sessionSummary()`.
  - **The ladder** still counts reps, with or without added weight, but **not a set with a minus weight**: band pull-ups aren't pull-ups yet.
  - **A weight alone isn't a logged set:** only reps or seconds date a workout and let it be saved.
- **Progress:** weeks run Monday to Sunday. A workout counts in the week of its date once it has a number in it. Exercise cards match by name and unit across days and plans, and only count logged sets (tests move the rings, not the cards). The charts start at his first logged week, at least 4 weeks and at most 8 back. `weeklyTotals()` and `exerciseStats()` in `logic.js`.
- **Switching plan** keeps everything: logs are stored per plan and day, and the ladder counts all of them. It's done on the Plan tab (the header chip is gone since 18 Nov).
- **His own plans** (`plans.js`): weeks and workouts have ids of their own and logs hang on those, so renaming one keeps its numbers; exercises are keyed by name as in the coach's file, so renaming an exercise detaches that day's numbers for it (the ladder still counts them). `toProgramPlan()` turns a plan into the shape `parsePlan()` gives, so the rest of the app can't tell them apart; `sessionsOfAny()` is the one way to get a plan's workouts. A plan with no exercise in it can't be used; if the plan he's on ends up empty, the app asks him to pick one. Limits: 30 plans, 12 weeks, 7 workouts a week, 15 exercises, 10 sets. The ladder still comes from the coach's file for every plan.
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
| Groups screens and buttons | `groups.js` |
| Calls to the Groups server, signing in | `social.js` (plain fetch, no library) |
| Weight on a set: reading what's typed, which set is better, how it reads | `weight.js` (tested) |
| His own plans: their shape, limits, the builder's changes, turning one into workouts | `plans.js` (tested) |
| The plan list, a plan's page, the builder | `planpages.js` |
| What a post holds, cleaning what the server sends, error wording | `share-logic.js` (tested) |
| Who may see and do what on the server | `supabase/migrations/20261117000001_groups.sql`, checked by `supabase/tests/rls.sql` |
| Groups on or off, which server | `config.js` (empty = off) and `connect-src` in `index.html` |
| What the page may load (security policy) | the `Content-Security-Policy` meta in `index.html`. It holds a hash of the inline theme script: change that script and make the hash again (`python3 -c` over the script's text, sha256, base64) or the theme stops working |
| Icon | `tools/icon.html` draws it, `python3 -I tools/make_icon.py` saves `icon-180.png` and `icon-512.png` (open the link it prints) |

**Before pushing:**

```bash
node --test tests/logic.test.mjs tests/picture.test.mjs tests/share-logic.test.mjs tests/weight.test.mjs tests/plans.test.mjs
```

After changing anything in `supabase/`, also run the rules test against the local server (see Groups setup) and see `PASS`.

A new file the app imports goes into `SHELL` in `sw.js`, with the cache name bumped in the same commit. New helpers go in new files rather than `logic.js`: the service worker fetches each file separately, so a new `app.js` can meet an old saved `logic.js` once. The same goes for `index.html`: `app.js` reloads once when the page has no Groups tab button (the check at its top), so when `app.js` starts relying on a new element in `index.html`, make that check look for it. And for what a log holds: when `logic.js` learns a new part of a log (weights were the first), raise `LOGIC_V` there and the number `app.js` asks for, so an older saved `logic.js` never loads a newer log and saves it back with that part missing. `app.js` reads `LOGIC_V` through `import * as LOGIC`, never by name.

**To preview locally:** copy the site into `qa/site` (ignored by git) with the demo plan from `tests/fixtures/demo.md`, then

```bash
python3 -m http.server 8921 --bind 127.0.0.1 --directory qa/site
```

**After changing any file the phone caches,** bump `CACHE` in `sw.js` only if a file is added or removed from `SHELL`. Changed contents are picked up without it.

## Groups setup

**Keli, once** (I can't make accounts or handle passwords):

1. Make a free account at supabase.com and **one project**, region **EU** (Frankfurt or Zurich). Keep the database password in your password manager; the app never needs it.
2. **Connect** (button at the top of the project) shows the **Project URL** and the **publishable** key (`sb_publishable_…`; also under **Project Settings → API Keys**). Send me both. Never the secret key.
3. **Authentication → Sign In / Providers → Email**: switch **Confirm email** off (Supabase's own mail only reaches you, so nobody else could confirm).
4. **SQL Editor**: paste all of `supabase/migrations/20261117000001_groups.sql`, Run. Then paste all of `supabase/tests/rls.sql`, Run: the last line must say `PASS: 66 checks`.
5. **Authentication → Hooks → Before User Created → Postgres**: schema `public`, function `hook_require_invite`, save. Now sign-ups without a code are refused.
6. **SQL Editor**: run snippet 1 of `supabase/owner-snippets.sql`. It prints your own invite code. In the app: Groups → I have an invite code.
7. Make a group, tap **Invite friends**, send the code.

**Turning it on** (me, after step 2): put the URL and key in `config.js`, put the exact project URL in `connect-src` in `index.html` instead of `https://*.supabase.co`, push.

**Owner jobs** (`supabase/owner-snippets.sql`, one snippet at a time in the SQL Editor): a new invite code; a new password for someone who forgot theirs; read reports; remove a post; see everyone; remove someone completely.

**Testing locally:** Colima + Docker + the Supabase CLI are installed on Keli's Mac.

```bash
colima start
supabase start -x realtime,storage-api,imgproxy,mailpit,studio,edge-runtime,logflare,vector,supavisor,postgres-meta
supabase db reset
docker exec -i supabase_db_coaching-app psql -U postgres -d postgres < supabase/tests/rls.sql
```

`supabase/config.toml` switches the sign-up hook on locally. For the app, `qa/site/config.js` points at `http://127.0.0.1:54321` with the local publishable key (`supabase status`), and `qa/site/index.html` gets that address added to `connect-src`.

## Don't touch

- The `coach.v1` storage key. If the data shape ever has to change, migrate on load and keep the old key as a backup. Adding a part beside the old ones (like `kg`) needs no migration, only the `LOGIC_V` step above.
- Week and day titles of a plan the client is already using (see above).

## Known limits

- One phone, no backup, no way for the coach to see logs remotely. Fine while the coach sees him every week.
- One goal per app for now (`PLAN_URL` in `app.js`). A client with a different goal needs a way to pick the plan file, probably a per-client link.
- Reps and seconds only, no kg.
- **Groups:** a free Supabase project pauses after a week nobody opens Groups; Groups then says it can't be reached until Keli un-pauses it in the dashboard (logging is never affected). No emails, so a forgotten password is reset by Keli with a snippet. No videos yet (Step 4: about 40 clips of 20 seconds fit the free 1 GB). No followers yet (Step 3). Posts can't be edited, only deleted. New posts show when Groups is opened or its tab tapped again, not live.
- Every app on `keli69420.github.io` shares one browser storage, so the sign-in there could be read by Keli's other apps. Fine while they're all his; an own domain before Groups goes public.
