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

// German too: the client and the coach write the plan in German.
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
    if (n < 1 || n > 20) return "die Anzahl Sätze muss zwischen 1 und 20 liegen";
    const one = parseTarget(many[2]);
    if (!one) return `kann "${many[2].trim()}" nicht lesen`;
    targets = Array.from({ length: n }, () => ({ ...one }));
  } else {
    const parts = t.split(/\s*[,/]\s*/).filter(Boolean);
    if (!parts.length) return "nach dem Doppelpunkt steht nichts";
    targets = [];
    for (const p of parts) {
      const one = parseTarget(p);
      if (!one) return `kann "${p}" nicht lesen`;
      targets.push(one);
    }
    if (targets.length > 20) return "mehr als 20 Sätze";
  }
  const unit = targets[0].unit;
  if (targets.some((x) => x.unit !== unit)) return "mischt Wiederholungen und Sekunden";
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
        if (section === "ladder" || ladder.length) err(line, "zweimal # Ladder");
        section = "ladder";
        plan = null;
        return;
      }
      const p = title.match(/^plan\s+([a-z0-9]{1,3})\s*(?:[:—–-]\s*(.*))?$/i);
      if (!p) { err(line, `"# ${title}" muss "# Ladder" oder "# Plan A: für wen" heissen`); section = null; plan = null; return; }
      const id = p[1].toUpperCase();
      if (plans.some((x) => x.id === id)) err(line, `zweimal Plan ${id}`);
      plan = { id, title: (p[2] || "").trim(), notes: [], weeks: [] };
      plans.push(plan);
      section = "plan";
      return;
    }

    m = s.match(/^##\s+(.+)$/);
    if (m && !s.startsWith("###")) {
      if (!plan) { err(line, "eine ## Woche muss unter einem # Plan stehen"); return; }
      const title = m[1].trim();
      if (plan.weeks.some((w) => keyOf(w.title) === keyOf(title))) err(line, `"${title}" kommt in Plan ${plan.id} zweimal vor`);
      week = { title, notes: [], days: [] };
      plan.weeks.push(week);
      day = null;
      return;
    }

    m = s.match(/^###\s+(.+)$/);
    if (m && !s.startsWith("####")) {
      if (!week) { err(line, "ein ### Tag muss unter einer ## Woche stehen"); return; }
      const title = m[1].trim();
      if (week.days.some((d) => keyOf(d.title) === keyOf(title))) err(line, `"${title}" kommt in ${week.title} zweimal vor`);
      day = { title, notes: [], items: [], line };
      week.days.push(day);
      return;
    }

    if (/^#/.test(s)) { err(line, "es gibt nur Überschriften mit #, ## und ###"); return; }

    m = s.match(/^[-*+]\s+(.*)$/);
    if (m) {
      const body = m[1].trim();
      if (section === "ladder") {
        const r = body.match(/^([^:|]+):\s*(.+)$/);
        const target = r && parseTarget(r[2]);
        if (!r || !target || target.min == null) { err(line, 'eine Stufe der Leiter heisst "- Name: Zahl", z. B. "- Klimmzüge: 10"'); return; }
        if (target.min !== target.max) { err(line, "eine Stufe der Leiter braucht eine Zahl, keinen Bereich"); return; }
        if (ladder.some((x) => keyOf(x.name) === keyOf(r[1]))) { err(line, `"${r[1].trim()}" steht zweimal auf der Leiter`); return; }
        ladder.push({ name: r[1].trim(), target: target.min, unit: target.unit });
        return;
      }
      if (!day) { err(line, "eine Übung muss unter einem ### Tag stehen"); return; }
      const bar = body.indexOf("|");
      const main = (bar < 0 ? body : body.slice(0, bar)).trim();
      const note = bar < 0 ? "" : body.slice(bar + 1).trim();
      const colon = main.indexOf(":");
      if (colon < 0) {
        if (!main) { err(line, "leerer Punkt in der Liste"); return; }
        day.items.push({ name: main, note, unit: null, sets: [] });
        warnings.push({ line, msg: `"${main}" hat keine Sätze und erscheint als Hinweis` });
        return;
      }
      const name = main.slice(0, colon).trim();
      if (!name) { err(line, "die Übung braucht einen Namen vor dem Doppelpunkt"); return; }
      const rx = parsePrescription(main.slice(colon + 1));
      if (typeof rx === "string") { err(line, `${name}: ${rx}`); return; }
      day.items.push({ name, note, unit: rx.unit, sets: rx.sets });
      return;
    }

    // Plain text: a note for whatever it sits under.
    if (day) day.notes.push(s);
    else if (week) week.notes.push(s);
    else if (plan) plan.notes.push(s);
    else if (section === "ladder") err(line, 'unter # Ladder ist jede Zeile "- Name: Zahl"');
    else warnings.push({ line, msg: "Text vor der ersten Überschrift wird ignoriert" });
  });

  if (!plans.length) err(0, "kein # Plan in der Datei");
  for (const p of plans) {
    const days = p.weeks.flatMap((w) => w.days);
    if (!days.length) err(0, `Plan ${p.id} hat keine Tage`);
    for (const d of days) if (!d.items.length) err(d.line, `"${d.title}" in Plan ${p.id} hat keine Übungen`);
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
// 1. one he has already logged something in today (so reopening mid-workout lands there),
// 2. otherwise the one after the furthest session he has logged anything in (so a skipped
//    day doesn't pin the app to it forever),
// 3. otherwise the first one.
// When the last session was logged on an earlier day, the plan is done: it stays on the last.
export function currentIndex(sessions, logs, today) {
  let todays = -1;
  let furthest = -1;
  sessions.forEach((s, i) => {
    const log = logs[s.key];
    if (!hasValues(log)) return;
    furthest = i;
    if (log.date === today) todays = i;
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

export function fmtDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

/* ---------- the saved state on the phone ---------- */

export function emptyState() {
  return { v: 1, plan: null, logs: {}, tests: {} };
}

// Reads whatever was saved, keeps what makes sense, drops the rest.
export function cleanState(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== "object") return s;
  if (typeof raw.plan === "string") s.plan = raw.plan;
  if (raw.logs && typeof raw.logs === "object") {
    for (const [k, log] of Object.entries(raw.logs)) {
      if (!log || typeof log !== "object") continue;
      const vals = {};
      for (const [ik, arr] of Object.entries(log.vals || {})) {
        if (Array.isArray(arr)) vals[ik] = arr.map((v) => (Number.isFinite(v) ? v : null));
      }
      s.logs[k] = { date: typeof log.date === "string" ? log.date : null, vals, note: typeof log.note === "string" ? log.note : "" };
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
  if (!hasValues(log) && !log.note) delete state.logs[session.key];
  return state;
}

export function setNote(state, session, text, today) {
  const log = state.logs[session.key] || (state.logs[session.key] = { date: null, vals: {}, note: "" });
  log.note = text;
  if (!log.date && text.trim()) log.date = today;
  if (!hasValues(log) && !log.note) delete state.logs[session.key];
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

export const weeksAgoLabel = (n) => (n === 0 ? "diese Woche" : n === 1 ? "letzte Woche" : `vor ${n} Wochen`);

export const fmtVal = (n, unit) => (unit === "sec" ? `${n} s` : `${n} Wdh.`);

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
