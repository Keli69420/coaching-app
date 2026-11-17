// Everything here is plain data in, plain data out, so it can be tested without a browser.
// The coach's plan lives in a text file (plans/*.md). This reads it, works out which
// session is today's, and how far up the ladder the client is.

/* ---------- reading the plan file ---------- */

// The format, in short (the full version is in the README):
//   # Ladder                      then one "- Name: target" line per step
//   # Plan A: who it's for        one per starting level
//   ## Week 1                     any title
//   ### Day 1                     any title, unique inside its week
//   - Pull-ups: 3 x 8 | note      also 3 x 20s, 3 x max, 3 x 5-8, 5, 4, 3
//   - Wrist circles               a bullet with no colon is a reminder, no fields
//   Plain line under a heading    a note shown with that plan, week or day
// Obsidian comments (%% ... %%), HTML comments and front matter are ignored.

// German units are read too: the plan was written in German until 17 Nov.
const SECONDS = /^(s|sec|secs|second|seconds|sek|sekunde|sekunden)$/i;
const REPS = /^(reps?|wdh|wiederholung|wiederholungen)$/i;

// "8", "5-8", "20s", "20 s", "max", "max s". Returns { min, max, unit } or null.
// For "max" both min and max are null: any number he enters counts.
export function parseTarget(text) {
  const t = String(text).trim();
  let m = t.match(/^max(?:\s*([a-z]+))?$/i);
  if (m) {
    if (m[1] && !SECONDS.test(m[1]) && !REPS.test(m[1])) return null;
    return { min: null, max: null, unit: m[1] && SECONDS.test(m[1]) ? "sec" : "reps" };
  }
  m = t.match(/^(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?\s*([a-z]+)?$/i);
  if (!m) return null;
  const min = Number(m[1]);
  const max = m[2] == null ? min : Number(m[2]);
  if (min < 1 || max < min) return null;
  let unit = "reps";
  if (m[3]) {
    if (SECONDS.test(m[3])) unit = "sec";
    else if (!REPS.test(m[3])) return null;
  }
  return { min, max, unit };
}

// "3 x 8", "3×20s", "5, 4, 3", "20s / 15s". Returns { unit, sets: [target...] } or an error string.
export function parsePrescription(text) {
  const t = String(text).trim();
  const many = t.match(/^(\d{1,2})\s*[x×X*]\s*(.+)$/);
  let targets;
  if (many) {
    const n = Number(many[1]);
    if (n < 1 || n > 20) return "the number of sets has to be between 1 and 20";
    const one = parseTarget(many[2]);
    if (!one) return `can't read "${many[2].trim()}"`;
    targets = Array.from({ length: n }, () => ({ ...one }));
  } else {
    const parts = t.split(/\s*[,/]\s*/).filter(Boolean);
    if (!parts.length) return "nothing after the colon";
    targets = [];
    for (const p of parts) {
      const one = parseTarget(p);
      if (!one) return `can't read "${p}"`;
      targets.push(one);
    }
    if (targets.length > 20) return "more than 20 sets";
  }
  const unit = targets[0].unit;
  if (targets.some((x) => x.unit !== unit)) return "mixes reps and seconds";
  return { unit, sets: targets.map(({ min, max }) => ({ min, max })) };
}

function stripComments(text) {
  let t = String(text).replace(/\r\n?/g, "\n");
  // Front matter: blank it out but keep the line numbers.
  const fm = t.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
  if (fm) t = fm[0].replace(/[^\n]/g, "") + t.slice(fm[0].length);
  const blank = (s) => s.replace(/[^\n]/g, "");
  return t.replace(/%%[\s\S]*?%%/g, blank).replace(/<!--[\s\S]*?-->/g, blank);
}

export const keyOf = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");

export function parsePlan(text) {
  const errors = [];
  const warnings = [];
  const ladder = [];
  const plans = [];
  let section = null; // "ladder" | "plan"
  let plan = null;
  let week = null;
  let day = null;
  const err = (line, msg) => errors.push({ line, msg });

  stripComments(text).split("\n").forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (!s) return;

    let m = s.match(/^#\s+(.+)$/);
    if (m) {
      week = day = null;
      const title = m[1].trim();
      if (/^ladder$/i.test(title)) {
        if (section === "ladder" || ladder.length) err(line, "# Ladder twice");
        section = "ladder";
        plan = null;
        return;
      }
      const p = title.match(/^plan\s+([a-z0-9]{1,3})\s*(?:[:—–-]\s*(.*))?$/i);
      if (!p) { err(line, `"# ${title}" has to be "# Ladder" or "# Plan A: who it's for"`); section = null; plan = null; return; }
      const id = p[1].toUpperCase();
      if (plans.some((x) => x.id === id)) err(line, `Plan ${id} twice`);
      plan = { id, title: (p[2] || "").trim(), notes: [], weeks: [] };
      plans.push(plan);
      section = "plan";
      return;
    }

    m = s.match(/^##\s+(.+)$/);
    if (m && !s.startsWith("###")) {
      if (!plan) { err(line, "a ## week has to be under a # Plan"); return; }
      const title = m[1].trim();
      if (plan.weeks.some((w) => keyOf(w.title) === keyOf(title))) err(line, `"${title}" is in Plan ${plan.id} twice`);
      week = { title, notes: [], days: [] };
      plan.weeks.push(week);
      day = null;
      return;
    }

    m = s.match(/^###\s+(.+)$/);
    if (m && !s.startsWith("####")) {
      if (!week) { err(line, "a ### day has to be under a ## week"); return; }
      const title = m[1].trim();
      if (week.days.some((d) => keyOf(d.title) === keyOf(title))) err(line, `"${title}" is in ${week.title} twice`);
      day = { title, notes: [], items: [], line };
      week.days.push(day);
      return;
    }

    if (/^#/.test(s)) { err(line, "headings only go #, ## and ###"); return; }

    m = s.match(/^[-*+]\s+(.*)$/);
    if (m) {
      const body = m[1].trim();
      if (section === "ladder") {
        const r = body.match(/^([^:|]+):\s*(.+)$/);
        const target = r && parseTarget(r[2]);
        if (!r || !target || target.min == null) { err(line, 'a ladder step is "- Name: number", e.g. "- Pull-ups: 10"'); return; }
        if (target.min !== target.max) { err(line, "a ladder step needs one number, not a range"); return; }
        if (ladder.some((x) => keyOf(x.name) === keyOf(r[1]))) { err(line, `"${r[1].trim()}" is on the ladder twice`); return; }
        ladder.push({ name: r[1].trim(), target: target.min, unit: target.unit });
        return;
      }
      if (!day) { err(line, "an exercise has to be under a ### day"); return; }
      const bar = body.indexOf("|");
      const main = (bar < 0 ? body : body.slice(0, bar)).trim();
      const note = bar < 0 ? "" : body.slice(bar + 1).trim();
      const colon = main.indexOf(":");
      if (colon < 0) {
        if (!main) { err(line, "empty bullet"); return; }
        day.items.push({ name: main, note, unit: null, sets: [] });
        warnings.push({ line, msg: `"${main}" has no sets and shows as a reminder` });
        return;
      }
      const name = main.slice(0, colon).trim();
      if (!name) { err(line, "the exercise needs a name before the colon"); return; }
      const rx = parsePrescription(main.slice(colon + 1));
      if (typeof rx === "string") { err(line, `${name}: ${rx}`); return; }
      day.items.push({ name, note, unit: rx.unit, sets: rx.sets });
      return;
    }

    // Plain text: a note for whatever it sits under.
    if (day) day.notes.push(s);
    else if (week) week.notes.push(s);
    else if (plan) plan.notes.push(s);
    else if (section === "ladder") err(line, 'under # Ladder every line is "- Name: number"');
    else warnings.push({ line, msg: "text before the first heading is ignored" });
  });

  if (!plans.length) err(0, "no # Plan in the file");
  for (const p of plans) {
    const days = p.weeks.flatMap((w) => w.days);
    if (!days.length) err(0, `Plan ${p.id} has no days`);
    for (const d of days) if (!d.items.length) err(d.line, `"${d.title}" in Plan ${p.id} has no exercises`);
  }
  for (const p of plans) for (const w of p.weeks) for (const d of w.days) {
    const seen = {};
    for (const it of d.items) {
      const k = keyOf(it.name);
      seen[k] = (seen[k] || 0) + 1;
      it.key = seen[k] === 1 ? k : `${k}#${seen[k]}`; // same exercise twice in a day gets its own slot
    }
    delete d.line;
  }
  return { ladder, plans, errors, warnings };
}

/* ---------- sessions: the plan as one list, in order ---------- */

export function sessionsOf(plan) {
  if (!plan) return [];
  const out = [];
  for (const w of plan.weeks) for (const d of w.days) {
    out.push({ key: `${plan.id}|${keyOf(w.title)}|${keyOf(d.title)}`, week: w.title, day: d.title, weekNotes: w.notes, notes: d.notes, items: d.items });
  }
  return out;
}

export const hasValues = (log) => Boolean(log && Object.values(log.vals || {}).some((arr) => arr.some((v) => v != null)));

// Which session the app opens on:
// 1. one he started today (so reopening mid-workout or after saving lands there),
// 2. otherwise the one after the furthest session he has logged anything in (so a skipped
//    day doesn't pin the app to it forever),
// 3. otherwise the first one.
// When the last session was logged on an earlier day, the plan is done: it stays on the last.
export function currentIndex(sessions, logs, today) {
  let todays = -1;
  let furthest = -1;
  sessions.forEach((s, i) => {
    const log = logs[s.key];
    if (log?.date === today) todays = i;
    if (hasValues(log)) furthest = i;
  });
  if (todays >= 0) return todays;
  if (furthest < 0) return 0;
  return Math.min(furthest + 1, sessions.length - 1);
}

export function planDone(sessions, logs, today) {
  if (!sessions.length) return false;
  const last = logs[sessions[sessions.length - 1].key];
  return hasValues(last) && last.date !== today;
}

// Every field filled in. Reminders have no fields and don't count.
export function sessionComplete(session, log) {
  const withSets = session.items.filter((it) => it.sets.length);
  if (!withSets.length || !log) return false;
  return withSets.every((it) => {
    const vals = log.vals?.[it.key] || [];
    return it.sets.every((_, i) => vals[i] != null);
  });
}

/* ---------- what counts ---------- */

export const hit = (target, val) => val != null && (target.min == null || val >= target.min);

export function fmtTarget(target, unit) {
  if (target.min == null) return unit === "sec" ? "max s" : "max";
  const n = target.min === target.max ? `${target.min}` : `${target.min}–${target.max}`;
  return unit === "sec" ? `${n} s` : n;
}

// "3 × 8", "3 × 20 s", "5, 4, 3", "3 × max"
export function fmtPrescription(item) {
  if (!item.sets.length) return "";
  const each = item.sets.map((t) => fmtTarget(t, item.unit));
  if (each.every((x) => x === each[0])) return `${each.length} × ${each[0]}`;
  return each.join(", ");
}

/* ---------- the ladder ---------- */

// Each step's best comes from two places, whichever is higher:
// a test typed in on the ladder itself, or any logged set of an exercise with
// exactly that step's name (capitals don't matter).
export function ladderState(ladder, logs, tests) {
  const steps = ladder.map((step) => {
    const k = keyOf(step.name);
    let best = null;
    let date = null;
    const take = (v, d) => {
      if (v == null) return;
      if (best == null || v > best || (v === best && d < date)) { best = v; date = d; }
    };
    for (const [d, v] of Object.entries(tests?.[k] || {})) take(v, d);
    for (const log of Object.values(logs || {})) {
      for (const [itemKey, vals] of Object.entries(log.vals || {})) {
        if (itemKey.replace(/#\d+$/, "") !== k) continue;
        for (const v of vals) take(v, log.date);
      }
    }
    const done = best != null && best >= step.target;
    const share = best == null ? 0 : Math.min(1, best / step.target);
    return { ...step, key: k, best, date, done, share };
  });
  const current = steps.findIndex((s) => !s.done);
  return { steps, current, finished: steps.length > 0 && current < 0 };
}

// One point per day for the trend line under the rings: that day's best of tests and
// logged sets of an exercise with exactly the step's name. Logs with no date are left out.
export function stepHistory(step, logs, tests) {
  const k = keyOf(step.name);
  const byDate = {};
  const take = (v, d) => {
    if (v == null || !d) return;
    if (byDate[d] == null || v > byDate[d]) byDate[d] = v;
  };
  for (const [d, v] of Object.entries(tests?.[k] || {})) take(v, d);
  for (const log of Object.values(logs || {})) {
    for (const [itemKey, vals] of Object.entries(log.vals || {})) {
      if (itemKey.replace(/#\d+$/, "") !== k) continue;
      for (const v of vals) take(v, log.date);
    }
  }
  return Object.keys(byDate).sort().map((date) => ({ date, best: byDate[date] }));
}

/* ---------- numbers and dates ---------- */

// Whole numbers only: reps and seconds. Junk becomes null.
export function parseNum(text) {
  const t = String(text).trim();
  return /^\d{1,4}$/.test(t) ? Number(t) : null;
}

export function todayIso(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "17 Nov".
export function fmtDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/* ---------- the saved state on the phone ---------- */

export function emptyState() {
  return { v: 1, plan: null, logs: {}, tests: {} };
}

// The workout timer, like Strava's: t0 is when he pressed Start (for the time of day), ms the
// time counted so far, run when the clock last started; no run means paused or saved.
const TIMER_KEYS = ["t0", "ms", "run"];

// Reads whatever was saved, keeps what makes sense, drops the rest.
function cleanLog(log) {
  const vals = {};
  for (const [ik, arr] of Object.entries(log.vals || {})) {
    if (Array.isArray(arr)) vals[ik] = arr.map((v) => (Number.isFinite(v) ? v : null));
  }
  const out = { date: typeof log.date === "string" ? log.date : null, vals, note: typeof log.note === "string" ? log.note : "" };
  for (const k of TIMER_KEYS) if (Number.isFinite(log[k]) && log[k] >= 0) out[k] = log[k];
  return out;
}

export function cleanState(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== "object") return s;
  if (typeof raw.plan === "string") s.plan = raw.plan;
  if (raw.logs && typeof raw.logs === "object") {
    for (const [k, log] of Object.entries(raw.logs)) {
      if (!log || typeof log !== "object") continue;
      s.logs[k] = cleanLog(log);
      if (log.done === true) s.logs[k].done = true;
      if (log.saved && typeof log.saved === "object") s.logs[k].saved = cleanLog(log.saved);
    }
  }
  if (raw.tests && typeof raw.tests === "object") {
    for (const [k, byDate] of Object.entries(raw.tests)) {
      if (!byDate || typeof byDate !== "object") continue;
      s.tests[k] = {};
      for (const [d, v] of Object.entries(byDate)) if (Number.isFinite(v)) s.tests[k][d] = v;
    }
  }
  return s;
}

// Writes one number into a session's log. The session takes today's date the first time
// anything goes in, and keeps it after that, so fixing an old number doesn't move it.
export function setValue(state, session, itemKey, setIndex, value, today) {
  const log = state.logs[session.key] || (state.logs[session.key] = { date: null, vals: {}, note: "" });
  const item = session.items.find((it) => it.key === itemKey);
  const arr = log.vals[itemKey] || (log.vals[itemKey] = []);
  const size = Math.max(arr.length, item ? item.sets.length : setIndex + 1);
  while (arr.length < size) arr.push(null);
  arr[setIndex] = value;
  if (!log.date && value != null) log.date = today;
  return state;
}

export function setNote(state, session, text, today) {
  const log = state.logs[session.key] || (state.logs[session.key] = { date: null, vals: {}, note: "" });
  log.note = text;
  if (!log.date && text.trim()) log.date = today;
  return state;
}

/* ---------- start, save, edit: same flow as Yapp ---------- */

const copyLog = (log) => {
  const out = { date: log.date, vals: JSON.parse(JSON.stringify(log.vals || {})), note: log.note || "" };
  if (log.t0 != null) out.t0 = log.t0;
  if (log.ms != null) out.ms = log.ms;
  return out;
};

// Start: an empty log dated today. A session's date is the day he started it.
// With `now` (ms since 1970) the clock starts too.
export function startSession(state, session, today, now) {
  if (!state.logs[session.key]) {
    state.logs[session.key] = { date: today, vals: {}, note: "" };
    if (Number.isFinite(now)) Object.assign(state.logs[session.key], { t0: now, ms: 0, run: now });
  }
  return state;
}

/* ---------- the clock: counts while running, keeps going with the app closed, like Strava ---------- */

export const elapsed = (log, now) => (log?.ms || 0) + (log?.run != null ? Math.max(0, now - log.run) : 0);
export const hasClock = (log) => log?.t0 != null;

export function pauseClock(log, now) {
  if (log?.run == null) return;
  log.ms = elapsed(log, now);
  delete log.run;
}

export function resumeClock(log, now) {
  if (hasClock(log) && log.run == null) log.run = now;
}

// "12:05", "1:02:09".
export function fmtClock(ms) {
  const t = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// "45s", "52m 10s", "1h 2m": how Strava writes a workout's time.
export function fmtDuration(ms) {
  const t = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return m ? `${m}m ${t % 60}s` : `${t}s`;
}

// Save: only with at least one number in it. Returns false when there's nothing to save.
// The clock stops at the time it shows.
export function finishSession(state, session, now) {
  const log = state.logs[session.key];
  if (!hasValues(log)) return false;
  if (Number.isFinite(now)) pauseClock(log, now);
  log.done = true;
  delete log.saved;
  return true;
}

// Edit a saved session: keep a copy, so stopping the edit puts the saved one back.
export function reopenSession(state, session) {
  const log = state.logs[session.key];
  if (!log) return state;
  log.saved = log.saved || copyLog(log);
  log.done = false;
  return state;
}

// Stop: an edit goes back to what was saved, a new session is thrown away.
export function stopSession(state, session) {
  const log = state.logs[session.key];
  if (log?.saved) state.logs[session.key] = { ...copyLog(log.saved), done: true };
  else delete state.logs[session.key];
  return state;
}

export function deleteSession(state, session) {
  delete state.logs[session.key];
  return state;
}

// On opening and when the day changes: a session started on an earlier day with nothing
// typed in it is dropped, and an edit that was emptied falls back to what was saved.
export function tidyLogs(state, today) {
  for (const [k, log] of Object.entries(state.logs)) {
    if (hasValues(log)) continue;
    if (log.saved) state.logs[k] = { ...copyLog(log.saved), done: true };
    else if (log.date !== today && !log.note) delete state.logs[k];
  }
  return state;
}

// One test per step per day: typing again the same day replaces it, an empty one removes it.
export function setTest(state, stepKey, value, today) {
  const byDate = state.tests[stepKey] || (state.tests[stepKey] = {});
  if (value == null) delete byDate[today];
  else byDate[today] = value;
  if (!Object.keys(byDate).length) delete state.tests[stepKey];
  return state;
}

/* ---------- the Progress tab: weeks run Monday to Sunday, same as Yapp ---------- */

const DAY_MS = 86400000;
const utc = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export function weekStart(iso) {
  const t = utc(iso);
  const sinceMonday = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

export const weeksAgo = (iso, today) => Math.round((utc(weekStart(today)) - utc(weekStart(iso))) / (7 * DAY_MS));

export const weeksAgoLabel = (n) => (n === 0 ? "this week" : n === 1 ? "last week" : `${n} weeks ago`);

export const fmtVal = (n, unit) => (unit === "sec" ? `${n} s` : `${n} reps`);

const filled = (vals) => (vals || []).filter((v) => v != null);

// Trainings and sets per week, oldest first, ending with this week. A training counts
// in the week of its date once it has a number in it.
export function weeklyTotals(logs, today, weeks = 8) {
  const out = Array.from({ length: weeks }, (_, i) => ({ weeksAgo: weeks - 1 - i, sessions: 0, sets: 0 }));
  for (const log of Object.values(logs || {})) {
    if (!log.date || !hasValues(log)) continue;
    const ago = weeksAgo(log.date, today);
    if (ago < 0 || ago >= weeks) continue;
    const bucket = out[weeks - 1 - ago];
    bucket.sessions += 1;
    bucket.sets += Object.values(log.vals).reduce((n, arr) => n + filled(arr).length, 0);
  }
  return out;
}

// One card per exercise he has typed a number in, most recently done first. Matched by name
// and unit across days and plans, so push-ups on two different days are one card. The record
// is his best single set; a tie keeps the first day he got it. Logs of a day that was renamed
// in the plan file have no exercises to match, so they only count in the weekly totals.
export function exerciseStats(sessions, logs, today, weeks = 8) {
  const seen = new Map();
  for (const s of sessions) {
    const log = logs?.[s.key];
    if (!log?.date) continue;
    for (const it of s.items) {
      const vals = filled(log.vals?.[it.key]);
      if (!it.sets.length || !vals.length) continue;
      const k = `${keyOf(it.name)}|${it.unit}`;
      if (!seen.has(k)) seen.set(k, { name: it.name, unit: it.unit, days: [] });
      seen.get(k).days.push({ date: log.date, best: Math.max(...vals) });
    }
  }
  return [...seen.values()].map(({ name, unit, days }) => {
    days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let pr = null;
    const byWeek = new Map();
    for (const d of days) {
      if (!pr || d.best > pr.best) pr = d;
      const ago = weeksAgo(d.date, today);
      if (!byWeek.has(ago) || d.best > byWeek.get(ago)) byWeek.set(ago, d.best);
    }
    const logged = [...byWeek.keys()].sort((a, b) => a - b);
    const at = (i) => (logged[i] === undefined ? null : { weeksAgo: logged[i], best: byWeek.get(logged[i]) });
    const latest = at(0);
    const previous = at(1);
    const trend = !previous ? null : latest.best > previous.best ? "up" : latest.best < previous.best ? "down" : "same";
    const weekly = Array.from({ length: weeks }, (_, i) => byWeek.get(weeks - 1 - i) ?? null);
    return { name, unit, pr: { best: pr.best, date: pr.date }, latest, previous, trend, weekly, lastDate: days[days.length - 1].date };
  }).sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0));
}

// Where each week's best sits in a w × h box, empty weeks skipped. Highest at the top.
export function sparkPoints(weekly, w, h, pad) {
  const vals = weekly.filter((v) => v != null);
  if (!vals.length) return [];
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const step = weekly.length > 1 ? (w - 2 * pad) / (weekly.length - 1) : 0;
  return weekly.flatMap((v, i) => {
    if (v == null) return [];
    const y = hi === lo ? h / 2 : pad + ((hi - v) / (hi - lo)) * (h - 2 * pad);
    return [{ i, x: +(pad + i * step).toFixed(1), y: +y.toFixed(1) }];
  });
}

// What the saved card says: sets typed, and new records. A record has to beat every earlier
// day for that exercise, so a first time isn't one, and neither is a tie. Same as Yapp.
export function sessionSummary(sessions, logs, session) {
  const log = logs?.[session.key];
  let sets = 0;
  const now = new Map();
  for (const it of session.items) {
    const vals = filled(log?.vals?.[it.key]);
    sets += vals.length;
    if (!it.sets.length || !vals.length) continue;
    const k = `${keyOf(it.name)}|${it.unit}`;
    const best = Math.max(...vals);
    if (!now.has(k) || best > now.get(k).best) now.set(k, { name: it.name, unit: it.unit, best });
  }
  const before = new Map();
  for (const s of sessions) {
    const other = logs?.[s.key];
    if (!other?.date || !log?.date || other.date >= log.date) continue;
    for (const it of s.items) {
      const vals = filled(other.vals?.[it.key]);
      if (!vals.length) continue;
      const k = `${keyOf(it.name)}|${it.unit}`;
      before.set(k, Math.max(before.get(k) ?? -Infinity, ...vals));
    }
  }
  const records = [...now.entries()].filter(([k, r]) => before.has(k) && r.best > before.get(k)).map(([, r]) => r);
  return { sets, records };
}

/* ---------- the You tab: lifetime totals and settings ---------- */

// Everything since the first workout: workouts with a number in them, sets typed, PRs set
// (each time a workout beat every earlier day for an exercise, as on the saved card), and
// the first workout's date. `sessions` is every plan's, so a renamed plan still counts.
export function allTimeTotals(sessions, logs) {
  let workouts = 0;
  let sets = 0;
  let since = null;
  for (const log of Object.values(logs || {})) {
    if (!log.date || !hasValues(log)) continue;
    workouts += 1;
    sets += Object.values(log.vals).reduce((n, arr) => n + filled(arr).length, 0);
    if (!since || log.date < since) since = log.date;
  }
  let prs = 0;
  for (const s of sessions) {
    if (logs?.[s.key]?.date && hasValues(logs[s.key])) prs += sessionSummary(sessions, logs, s).records.length;
  }
  return { workouts, sets, prs, since };
}

// Settings live apart from the logs, under their own key, so the page can pick the
// colours before it draws anything. The name stays on the phone like everything else.
export const THEMES = ["system", "light", "dark"];

export function cleanPrefs(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  return {
    theme: THEMES.includes(p.theme) ? p.theme : "system",
    name: typeof p.name === "string" ? p.name.trim().slice(0, 40) : "",
  };
}

/* ---------- activities: every saved workout, newest first, like Strava's ---------- */

// Strava names an activity after the time of day: "Evening Legs".
export function partOfDay(hour) {
  if (hour >= 5 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Afternoon";
  if (hour >= 17 && hour < 22) return "Evening";
  return "Night";
}

// Saved workouts only (one being edited still counts). `sessions` is every plan's.
// `hourOf` turns t0 into the phone's local hour; passed in so tests don't depend on the clock.
export function activities(sessions, logs, hourOf = (t) => new Date(t).getHours()) {
  const out = [];
  for (const s of sessions) {
    const log = logs?.[s.key];
    if (!log?.date || !(log.done || log.saved) || !hasValues(log)) continue;
    const { sets, records } = sessionSummary(sessions, logs, s);
    out.push({
      key: s.key,
      title: log.t0 != null ? `${partOfDay(hourOf(log.t0))} ${s.day}` : s.day,
      date: log.date,
      t0: log.t0 ?? null,
      ms: log.ms ?? null,
      sets,
      prs: records.length,
    });
  }
  return out.sort((a, b) => (a.date === b.date ? (b.t0 ?? 0) - (a.t0 ?? 0) : a.date < b.date ? 1 : -1));
}
