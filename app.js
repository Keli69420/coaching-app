import {
  parsePlan, sessionsOf, currentIndex, planDone, hit, fmtTarget, fmtPrescription,
  ladderState, stepHistory, parseNum, todayIso, fmtDate, cleanState, emptyState, setValue, setNote, setTest, hasValues,
  weeklyTotals, exerciseStats, sparkPoints, weeksAgo, weeksAgoLabel, fmtVal,
  startSession, finishSession, reopenSession, stopSession, deleteSession, tidyLogs, sessionSummary,
  allTimeTotals, cleanPrefs, elapsed, hasClock, pauseClock, resumeClock, fmtClock, fmtDuration, activities,
} from "./logic.js";

// The coach's plan. One file holds the ladder and every starting level (Plan A, B, C...).
const PLAN_URL = "plans/muscle-up.md";
// Everything the client logs, on this phone only. Never rename it: old logs would look lost.
const KEY = "coach.v1";
// Settings (light/dark, his name), apart from the logs. index.html reads the theme from it too.
const PREFS_KEY = "coach.prefs";
const SAVE_DELAY_MS = 300;
const ARMED_MS = 3000; // how long a "tap again to…" button waits for the second tap
// How far back the Progress tab looks: from his first logged week, at least 4 weeks, at most 8,
// so a four-week plan doesn't open on a chart that is mostly empty.
const MIN_WEEKS = 4;
const MAX_WEEKS = 8;
let WEEKS = MIN_WEEKS;

const root = document.querySelector(".app");
const main = document.getElementById("main");
const chipEl = document.getElementById("chip");
const meEl = document.getElementById("me");
const pagesEl = document.getElementById("pages");
const statusEl = document.getElementById("status");

let today = todayIso();
// Three tabs (Keli, 17 Nov): "today" shows only today's workout, "plan" this week's workouts,
// "progress" the ladder and his numbers. "profile" has no tab: his picture top right opens it,
// like Apple Fitness, and Settings sit at its bottom as categories. Always opens on today.
let page = "today";
let before = "today"; // the page the profile was opened from, for its back button
let opened = null; // on the profile: the saved workout opened from his activities (its key)
let setting = null; // on the profile: the settings category he opened ("profile", "appearance", "data")
let profileY = 0; // where the profile was scrolled to, so ‹ Profile comes back to the same spot
let program = null; // { ladder, plans, errors }
let loadError = "";
let state = tidyLogs(load(), today);
let prefs = loadPrefs();
let viewing = null; // on the Plan tab: the workout opened from the week, or null for the week itself
let pickerOpen = false;
let testing = null; // ladder step key while its test field is open
let pending = false;
let timer = null;

/* ---------- storage: this phone only ---------- */

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return cleanState(JSON.parse(raw));
  } catch { /* storage blocked or unreadable: start empty, run from memory */ }
  return emptyState();
}

function persist() {
  clearTimeout(timer);
  timer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    pending = false;
    statusEl.textContent = "";
    return true;
  } catch {
    statusEl.textContent = "not saved";
    return false;
  }
}

function saveSoon() {
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(persist, SAVE_DELAY_MS);
}

const flush = () => { if (pending) persist(); };

function loadPrefs() {
  try {
    return cleanPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || "null"));
  } catch {
    return cleanPrefs(null);
  }
}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* still works for this visit */ }
}

/* ---------- light or dark ---------- */

// "system" follows the phone, and keeps following it while the app is open.
// Same rule as the script at the top of index.html.
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const t = prefs.theme === "light" || prefs.theme === "dark" ? prefs.theme : darkQuery.matches ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === "dark" ? "#000000" : "#F2F2F7";
}
darkQuery.addEventListener?.("change", applyTheme);
applyTheme();

/* ---------- drawing helpers ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const stroke = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
const RIGHT = `<svg class="chev" viewBox="0 0 10 16" width="8" height="13" aria-hidden="true"><path d="M2.5 2 8 8l-5.5 6" ${stroke}/></svg>`;
const LEFT = `<svg class="chev" viewBox="0 0 10 16" width="8" height="13" aria-hidden="true"><path d="M7.5 2 2 8l5.5 6" ${stroke}/></svg>`;
const TICK = `<svg class="tick" viewBox="0 0 16 12" width="14" height="11" aria-hidden="true"><path d="M1.5 6.5 6 10.5 14.5 1.5" ${stroke}/></svg>`;
// Gold is for personal records only, like a medal.
const MEDAL = `<svg class="medal" viewBox="0 0 16 18" width="14" height="16" aria-hidden="true"><path d="M4 1h3l1.6 4.5L10.2 1h1.8L9.8 7" fill="none" stroke="var(--gold-deep)" stroke-width="1.6" stroke-linejoin="round"/><circle cx="8" cy="12" r="5" fill="var(--gold)"/></svg>`;

// A number with its unit after it, small capitals in the same colour, like Apple Fitness: "22 SEC", "6 REPS".
const unitWord = (n, unit) => (unit === "sec" ? "sec" : n === 1 ? "rep" : "reps");
const numHtml = (n, unit) => `<b class="num">${esc(n)}</b><small class="unit">${unitWord(n, unit)}</small>`;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const longDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${fmtDate(iso)}`;
};
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pad2 = (n) => String(n).padStart(2, "0");
const hhmm = (t) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
// "Today", "Yesterday", else "Tuesday, 17 Nov", like Strava's activity dates.
const dayWord = (iso) => {
  if (iso === today) return "Today";
  const [y, m, d] = today.split("-").map(Number);
  return iso === todayIso(new Date(y, m - 1, d - 1)) ? "Yesterday" : longDate(iso);
};
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const plan = () => program?.plans.find((p) => p.id === state.plan) ?? null;
const sessions = () => sessionsOf(plan());
const current = () => currentIndex(sessions(), state.logs, today);
// The workout on screen: one opened from the Plan tab, otherwise today's.
const shownIndex = () => {
  if (page === "profile" && opened) {
    const i = sessions().findIndex((s) => s.key === opened);
    if (i >= 0) return i;
  }
  if (page !== "plan" || viewing == null) return current();
  return Math.max(0, Math.min(viewing, sessions().length - 1));
};

function render() {
  for (const b of pagesEl.querySelectorAll("button")) {
    if (b.dataset.page === page) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  const broken = Boolean(loadError || !program || program.errors.length);
  pagesEl.hidden = broken || !plan() || pickerOpen;
  meEl.hidden = pagesEl.hidden;
  meEl.innerHTML = avatarHtml();
  if (page === "profile") meEl.setAttribute("aria-current", "page");
  else meEl.removeAttribute("aria-current");
  if (broken) {
    chipEl.innerHTML = "";
    if (loadError) main.innerHTML = msgHtml("No plan yet", `<p>${esc(loadError)}</p>`);
    else if (!program) main.innerHTML = `<p class="loading">Loading the plan…</p>`;
    else {
      main.innerHTML = msgHtml("Something in the plan is wrong", `
        <p>Fix this in <code>${esc(PLAN_URL)}</code>:</p>
        <ul>${program.errors.map((e) => `<li>${e.line ? `Line ${e.line}: ` : ""}${esc(e.msg)}</li>`).join("")}</ul>`);
    }
    return;
  }
  const picked = plan();
  // With one plan in the file there's nothing to switch to, so there's no chip at all.
  chipEl.innerHTML = !picked || program.plans.length === 1 ? ""
    : `<button type="button" class="chip${pickerOpen ? " on" : ""}" data-act="picker" aria-expanded="${pickerOpen}" aria-label="Plan ${esc(picked.id)}. Tap to switch.">Plan ${esc(picked.id)}</button>`;
  if (pickerOpen || !picked) main.innerHTML = pickerHtml(picked);
  else if (page === "progress") main.innerHTML = progressHtml();
  else if (page === "profile") main.innerHTML = opened ? sessionHtml(shownIndex()) : setting ? settingHtml(setting) : profileHtml();
  else if (page === "plan" && viewing == null) main.innerHTML = weekHtml();
  else main.innerHTML = sessionHtml(shownIndex());
}

const msgHtml = (title, body) => `<section class="msg"><h2>${esc(title)}</h2>${body}</section>`;

/* ---------- Today: one workout, nothing else ---------- */

function sessionHtml(i) {
  const list = sessions();
  const s = list[i];
  const log = state.logs[s.key];
  const done = i === list.length - 1 && planDone(list, state.logs, today);
  // Opened from the Plan tab or from his activities: a back button instead of the week label.
  const backTo = page === "plan" ? s.week : page === "profile" ? "Profile" : "";
  return `
    <section class="session">
      ${backTo ? `<button type="button" class="back" data-act="back">${LEFT}<span>${esc(backTo)}</span></button>` : ""}
      <header class="head">
        ${backTo ? "" : `<p class="eyebrow">${esc(s.week)}</p>`}
        <h2 class="title">${esc(s.day)}</h2>
      </header>
      ${done && page !== "profile" ? `<p class="banner">That was the whole plan. Time for a new test under Progress.</p>` : ""}
      ${!log ? ghostHtml(s) : log.done ? savedHtml(s, page === "profile" ? null : list[i + 1]) : activeHtml(s, log)}
    </section>`;
}

// Not started yet: what's coming, and a button to start. Same as Yapp.
function ghostHtml(s) {
  return `
    <ul class="card list">${s.items.map((it) => `
      <li><span class="lname">${esc(it.name)}</span>${it.sets.length ? `<span class="rx">${esc(fmtPrescription(it))}</span>` : ""}</li>`).join("")}
    </ul>
    <button type="button" class="cta" data-act="start">Start workout</button>`;
}

const PAUSE = `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.6" height="12" rx="1.2"/><rect x="9.4" y="2" width="3.6" height="12" rx="1.2"/></svg>`;
const PLAY = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.6v10.8c0 .8.9 1.3 1.6.8l8-5.4c.6-.4.6-1.2 0-1.6l-8-5.4c-.7-.5-1.6 0-1.6.8z"/></svg>`;

// The workout clock, like recording on Strava: it starts with Start, Pause stops it, Save ends it.
// It isn't shown while editing a saved workout: that keeps the time it was saved with.
function clockHtml(log) {
  const running = log.run != null;
  return `
    <div class="card clock${running ? "" : " paused"}">
      <div>
        <p class="clabel">${running ? "Time" : "Paused"}</p>
        <p class="big sky"><b class="num" id="clocktime">${fmtClock(elapsed(log, Date.now()))}</b></p>
      </div>
      <button type="button" class="pausebtn${running ? "" : " go"}" data-act="${running ? "pause" : "resume"}">${running ? PAUSE : PLAY}<span>${running ? "Pause" : "Resume"}</span></button>
    </div>`;
}

function activeHtml(s, log) {
  return `
    ${hasClock(log) && !log.saved ? clockHtml(log) : ""}
    <div class="items">${s.items.map((it) => itemHtml(it, log)).join("")}</div>
    <textarea class="card note" id="note" rows="2" placeholder="Notes" aria-label="Notes">${esc(log.note ?? "")}</textarea>
    <button type="button" class="cta" data-act="finish">Save workout</button>
    <p class="formerr" id="finisherr" role="alert"></p>
    <button type="button" class="quiet" data-act="stop" data-confirm="${log.saved ? "Tap again to undo edits" : "Tap again to discard"}">${log.saved ? "Stop editing" : "Stop workout"}</button>`;
}

// Saved: a summary card instead of the fields. Edit opens them again.
function savedHtml(s, next) {
  const { sets, records } = sessionSummary(program.plans.flatMap(sessionsOf), state.logs, s);
  const log = state.logs[s.key];
  const bits = [count(sets, "set", "sets")];
  if (log?.ms != null) bits.unshift(fmtDuration(log.ms));
  if (records.length) bits.push(count(records.length, "PR", "PRs"));
  const nextName = next ? (next.week === s.week ? next.day : `${next.week} · ${next.day}`) : "";
  return `
    <div class="card saved">
      <div class="savedhead">
        <span class="okdot">${TICK}</span>
        <div class="savedtext"><h3>${esc(s.day)} saved</h3><p>${bits.join(" · ")}</p></div>
        <button type="button" class="ghostbtn" data-act="reopen">Edit</button>
      </div>
      ${records.length ? `<ul class="prs">${records.map((r) => `<li>${MEDAL}<span class="prname">${esc(r.name)}</span><span class="prval">${numHtml(r.best, r.unit)}</span></li>`).join("")}</ul>` : ""}
    </div>
    ${nextName ? `<p class="next">Up next: ${esc(nextName)}</p>` : ""}
    <button type="button" class="quiet" data-act="delete">Delete workout</button>`;
}

const hitsOf = (it, vals) => it.sets.filter((t, j) => hit(t, vals[j] ?? null)).length;
// A small ring per exercise that fills as sets get hit, with a tick once they all are.
const countHtml = (hits, total) => `
  <span class="count${hits === total ? " full" : ""}" role="img" aria-label="${hits === total ? `All ${total} sets hit` : `${hits} of ${total} sets hit`}">
    ${ring(total ? hits / total : 0)}${hits === total ? TICK : `<b class="num">${hits}</b>`}
  </span>`;

// One card per exercise. A set is a disc with the goal inside until he types; a hit disc fills in.
function itemHtml(it, log) {
  if (!it.sets.length) {
    return `
      <div class="card item reminder">
        <h3>${esc(it.name)}</h3>
        ${it.note ? `<p class="inote">${esc(it.note)}</p>` : ""}
      </div>`;
  }
  const vals = log?.vals?.[it.key] ?? [];
  const discs = it.sets.map((t, j) => {
    const v = vals[j] ?? null;
    const goal = t.min == null ? "max" : fmtTarget(t, it.unit).replace(" s", "s");
    return `
      <span class="set${hit(t, v) ? " hit" : ""}">
        <input class="f" data-item="${esc(it.key)}" data-set="${j}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"
          placeholder="${esc(goal)}" aria-label="${esc(`${it.name}, set ${j + 1}, goal ${fmtTarget(t, it.unit)}`)}" value="${v ?? ""}">
      </span>`;
  }).join("");
  return `
    <div class="card item" data-key="${esc(it.key)}">
      <div class="itemhead"><h3>${esc(it.name)}</h3>${countHtml(hitsOf(it, vals), it.sets.length)}</div>
      ${it.note ? `<p class="inote">${esc(it.note)}</p>` : ""}
      <div class="sets">${discs}</div>
    </div>`;
}

/* ---------- Plan: this week's workouts ---------- */

function weekHtml() {
  const list = sessions();
  const c = current();
  const week = list[c].week;
  const days = list.map((s, j) => ({ s, j })).filter((x) => x.s.week === week);
  let doneN = 0;
  const rows = days.map(({ s, j }) => {
    const log = state.logs[s.key];
    const n = s.items.filter((it) => it.sets.length).length;
    let st = "later";
    let sub = count(n, "exercise", "exercises");
    if (log?.done) { st = "done"; sub = `Done ${fmtDate(log.date)}`; doneN += 1; }
    else if (j === c) { st = "next"; sub = log ? (log.date === today ? "Today" : "In progress") : "Up next"; }
    else if (hasValues(log)) { st = "next"; sub = `Not saved · ${fmtDate(log.date)}`; }
    else if (j < c) { st = "missed"; sub = "Skipped"; }
    return { st, html: `
      <li><button type="button" class="row" data-act="open" data-i="${j}">
        <span class="st ${st}">${st === "done" ? TICK : ""}</span>
        <span class="rtext"><b>${esc(s.day)}</b><small>${esc(sub)}</small></span>
        ${RIGHT}
      </button></li>` };
  });
  return `
    <section class="plan">
      <header class="head">
        <p class="eyebrow">This week</p>
        <h2 class="title">${esc(week)}</h2>
      </header>
      <div class="card metric">
        <h3 class="ctitle">Workouts</h3>
        <p class="big lime"><b class="num">${doneN}/${days.length}</b><small class="unit">done</small></p>
        <div class="segs" aria-hidden="true">${rows.map((r) => `<i class="${r.st}"></i>`).join("")}</div>
      </div>
      <ul class="card rows">${rows.map((r) => r.html).join("")}</ul>
    </section>`;
}

/* ---------- Progress: the ladder, this week, records ---------- */

// A progress ring: a dim track in the ring's own colour, the share done on top, clockwise
// from the top. The colour comes from the element around it (pink, lime, or grey).
function ring(share) {
  const r = 27;
  const C = 2 * Math.PI * r;
  const len = share <= 0 ? 0 : Math.max(0.04, Math.min(1, share)) * C;
  return `<svg class="ring" viewBox="0 0 64 64" aria-hidden="true"><circle class="track" cx="32" cy="32" r="${r}"/>${len ? `<circle class="arc" cx="32" cy="32" r="${r}" stroke-dasharray="${len.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/>` : ""}</svg>`;
}

// Three separate rings, never nested: nested red/green/blue rings are Apple's Activity
// rings, and Apple asks apps not to imitate them. Pink = the step he's on, lime = done.
function ladderHtml() {
  const { steps, current: at, finished } = ladderState(program.ladder, state.logs, state.tests);
  if (!steps.length) return "";
  const tiles = steps.map((s, i) => {
    const cls = s.done ? "done" : i === at ? "now" : "later";
    const unit = s.unit === "sec" ? " s" : "";
    return `
      <button type="button" class="step ${cls}${testing === s.key ? " open" : ""}" data-act="test" data-step="${esc(s.key)}" aria-expanded="${testing === s.key}"
        aria-label="${esc(s.name)}: PR ${s.best ?? "none yet"} of ${s.target}${unit}. Tap to log a test.">
        <span class="dial">${ring(s.share)}<span class="sval">${s.done ? TICK : `<b class="num">${s.best ?? 0}</b><small>/${s.target}</small>`}</span></span>
        <span class="sname">${esc(s.name)}</span>
      </button>`;
  }).join("");
  const open = testing && steps.find((s) => s.key === testing);
  return `
    <div class="card">
      <h3 class="ctitle">Ladder</h3>
      <div class="steps">${tiles}</div>
    </div>
    ${open ? testHtml(open) : trendHtml(finished ? steps[steps.length - 1] : steps[at], finished)}`;
}

// The step he's on, Apple Fitness style: "4/5 REPS" big in pink, how far to go, and the climb.
function trendHtml(step, finished) {
  const hist = stepHistory(step, state.logs, state.tests);
  const left = step.target - (step.best ?? 0);
  const label = finished ? "Goal reached" : step.best == null ? "Not tested yet · tap its ring" : `${left} to go`;
  return `
    <div class="card trend">
      <h3 class="ctitle">${esc(step.name)}</h3>
      <p class="clabel">${esc(label)}</p>
      <p class="big ${finished ? "lime" : "pink"}"><b class="num">${step.best ?? 0}/${step.target}</b><small class="unit">${unitWord(step.target, step.unit)}</small></p>
      ${hist.length ? chartSvg(hist, step.target, !finished) : ""}
    </div>`;
}

// Best per day as a smooth line, the target as a dashed line. While the goal is still
// ahead, a dashed path climbs from his latest best to a dot on the target: the gap, drawn.
function chartSvg(hist, target, ahead) {
  const W = 300, top = 14, bottom = 66, l = 4, r = W - 8;
  // The axis starts a little under his lowest day, not at 0, so a rep gained shows as a climb.
  const bests = hist.map((h) => h.best);
  const max = Math.max(target, ...bests);
  const min = bests.length ? Math.max(0, Math.min(...bests) - Math.ceil(target / 5)) : 0;
  const y = (v) => bottom - ((v - min) / (max - min || 1)) * (bottom - top);
  const n = hist.length;
  const last = n ? hist[n - 1].best : null;
  const climb = ahead && last != null && last < target;
  const histR = climb ? W - 80 : r; // leave room on the right for the path to the goal
  const x = (i) => (n === 1 ? (climb ? l + 6 : r) : l + (i * (histR - l)) / (n - 1));
  const ty = +y(target).toFixed(1);
  let body = "";
  if (n) {
    const pts = hist.map((h, i) => [x(i), y(h.best)].map((v) => +v.toFixed(1)));
    const curve = (a, b) => {
      const mx = +((a[0] + b[0]) / 2).toFixed(1);
      return ` C${mx} ${a[1]} ${mx} ${b[1]} ${b[0]} ${b[1]}`;
    };
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < n; i++) d += curve(pts[i - 1], pts[i]);
    const end = pts[n - 1];
    if (n > 1) body += `<path class="area" d="${d} L${end[0]} ${bottom} L${pts[0][0]} ${bottom}Z"/><path class="line" d="${d}"/>`;
    if (climb) {
      body += `<path class="climb" d="M${end[0]} ${end[1]}${curve(end, [r, ty])}"/><circle class="flag" cx="${r}" cy="${ty}" r="4.5"/>`;
    }
    body += `<circle class="dot" cx="${end[0]}" cy="${end[1]}" r="5"/>`;
    // First and latest day, each under its own point.
    const at = (pt, h, anchor) => `<text class="day" x="${pt[0]}" y="84" text-anchor="${anchor}">${fmtDate(h.date)}</text>`;
    if (n > 1) body += at(pts[0], hist[0], "start");
    body += at(end, hist[n - 1], end[0] > W - 20 ? "end" : n === 1 ? "start" : "middle");
  }
  return `
    <svg class="chart" viewBox="0 0 ${W} 88" aria-hidden="true">
      <line class="goal" x1="0" x2="${W}" y1="${ty}" y2="${ty}"/>
      <text class="goaltxt" x="0" y="${(ty - 5).toFixed(1)}">${target}</text>
      ${body}
    </svg>`;
}

function testHtml(step) {
  const todays = state.tests[step.key]?.[today];
  return `
    <form class="card test" data-step="${esc(step.key)}" autocomplete="off">
      <label class="ctitle" for="testval">${esc(step.name)} test</label>
      <div class="testrow">
        <input class="f" id="testval" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" value="${todays ?? ""}" aria-label="${esc(step.name)}, test today, ${step.unit === "sec" ? "seconds" : "reps"}">
        <span class="unit">${step.unit === "sec" ? "sec" : "reps"}</span>
        <button type="submit" class="btn">Save</button>
        <button type="button" class="x" data-act="closetest" aria-label="Close">×</button>
      </div>
    </form>`;
}

// One number per card, Apple Fitness style: title, "This week", the number big in the card's
// colour, then a bar per week with this week bright.
function metricHtml(title, hue, one, many, totals, pick) {
  const vals = totals.map(pick);
  const now = vals[vals.length - 1];
  const diff = now - vals[vals.length - 2];
  const max = Math.max(1, ...vals);
  const delta = diff > 0 ? `<small class="delta">+${diff}</small>` : diff < 0 ? `<small class="delta">−${-diff}</small>` : "";
  const says = totals.map((t, i) => `${weeksAgoLabel(t.weeksAgo)} ${count(vals[i], one, many)}`).join(", ");
  return `
    <div class="card metric ${hue}">
      <h3 class="ctitle">${title}</h3>
      <p class="clabel">This week</p>
      <p class="big"><b class="num">${now}</b>${delta}</p>
      <div class="minibars" role="img" aria-label="${esc(capital(`${title} per week: ${says}`))}">
        ${vals.map((v, i) => `<i class="${i === vals.length - 1 ? "on" : ""}" style="height:${v ? Math.max(8, Math.round((100 * v) / max)) : 0}%"></i>`).join("")}
      </div>
    </div>`;
}

function sparkSvg(st) {
  const W = 88, H = 32, PAD = 4;
  const pts = sparkPoints(st.weekly, W, H, PAD);
  if (!pts.length) return "";
  const says = st.weekly.map((v, i) => `${weeksAgoLabel(WEEKS - 1 - i)} ${v == null ? "not done" : fmtVal(v, st.unit)}`);
  const last = pts[pts.length - 1];
  return `
    <svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Best set per week: ${says.join(", ")}`)}">
      ${pts.length > 1 ? `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}"/>` : ""}
      <circle cx="${last.x}" cy="${last.y}" r="3.2"/>
    </svg>`;
}

const exRowHtml = (st) => `
  <li class="exrow">
    <div class="extext"><b>${esc(st.name)}</b><span class="pr">${MEDAL}${numHtml(st.pr.best, st.unit)}</span></div>
    ${sparkSvg(st)}
  </li>`;

function progressHtml() {
  const first = Object.values(state.logs).map((l) => l.date).filter(Boolean).sort()[0];
  WEEKS = Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, first ? weeksAgo(first, today) + 1 : 0));
  const totals = weeklyTotals(state.logs, today, WEEKS);
  const stats = exerciseStats(program.plans.flatMap(sessionsOf), state.logs, today, WEEKS);
  return `
    <section class="progress">
      <header class="head">
        <p class="eyebrow">${esc(longDate(today))}</p>
        <h2 class="title">Progress</h2>
      </header>
      <div id="ladder">${ladderHtml()}</div>
      <div class="grid2">
        ${metricHtml("Workouts", "sky", "workout", "workouts", totals, (t) => t.sessions)}
        ${metricHtml("Sets", "lime", "set", "sets", totals, (t) => t.sets)}
      </div>
      <h2 class="sect">Records</h2>
      ${stats.length ? `<ul class="card rows ex">${stats.map(exRowHtml).join("")}</ul>`
        : `<p class="empty">Your PRs show up here after your first workout.</p>`}
    </section>`;
}

const redrawLadder = () => {
  const el = document.getElementById("ladder");
  if (el) el.innerHTML = ladderHtml();
};

/* ---------- his profile (from the picture top right), with Settings at its bottom ---------- */

const PERSON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4" fill="currentColor"/><path d="M4.5 20.5c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5z" fill="currentColor"/></svg>`;
// One place draws his picture, top right and on the profile: his initial, or a person until he
// types a name. A profile picture (on the Later list) goes here as an <img>, and shows in both.
const avatarHtml = () => {
  const n = prefs.name.trim();
  return n ? esc(n.charAt(0).toUpperCase()) : PERSON;
};
const PAGE_NAMES = { today: "Today", plan: "Plan", progress: "Progress" };

function profileHtml() {
  const all = allTimeTotals(program.plans.flatMap(sessionsOf), state.logs);
  const steps = ladderState(program.ladder, state.logs, state.tests).steps;
  const goal = steps.length ? steps[steps.length - 1].name : "";
  const sub = [goal && `Goal: ${goal}`, all.since && `since ${fmtDate(all.since)}`].filter(Boolean).join(" · ");
  const acts = activities(program.plans.flatMap(sessionsOf), state.logs);
  return `
    <section class="you">
      <button type="button" class="back" data-act="unprofile">${LEFT}<span>${PAGE_NAMES[before] || "Back"}</span></button>
      <div class="profile">
        <span class="avatar">${avatarHtml()}</span>
        <div class="ptext">
          <h2 class="pname">${esc(prefs.name.trim() || "You")}</h2>
          ${sub ? `<p class="psub">${esc(sub)}</p>` : ""}
        </div>
      </div>
      <div class="card totals">
        <div class="sky"><b class="num">${all.workouts}</b><span>${all.workouts === 1 ? "Workout" : "Workouts"}</span></div>
        <div class="lime"><b class="num">${all.sets}</b><span>Sets</span></div>
        <div class="gold"><b class="num">${all.prs}</b><span>${all.prs === 1 ? "PR" : "PRs"}</span></div>
      </div>
      <button type="button" class="back edit" data-act="editprofile">Edit profile</button>
      <h2 class="sect">Activities</h2>
      ${acts.length ? `<ul class="acts">${acts.map(activityHtml).join("")}</ul>` : `<p class="empty">Saved workouts show up here.</p>`}
      <h2 class="sect">Settings</h2>
      <ul class="card rows">${SETTINGS.map((c) => `
        <li><button type="button" class="row set" data-act="setting" data-cat="${c.key}">
          <span class="rtext"><b>${c.label}</b></span>
          <span class="val">${esc(c.value())}</span>${RIGHT}
        </button></li>`).join("")}
      </ul>
    </section>`;
}

// One saved workout as a card, like an activity on Strava: who, when, its name, then its numbers.
function activityHtml(a) {
  const when = `${dayWord(a.date)}${a.t0 != null ? ` at ${hhmm(a.t0)}` : ""}`;
  const canOpen = sessions().some((s) => s.key === a.key);
  const stat = (label, value, hue) => `<span class="${hue}"><small>${label}</small><b class="num">${esc(value)}</b></span>`;
  const body = `
    <span class="actwho">
      <span class="avatar sm">${avatarHtml()}</span>
      <span class="actmeta"><b>${esc(prefs.name.trim() || "You")}</b><small>${esc(when)}</small></span>
    </span>
    <span class="acttitle">${esc(a.title)}</span>
    <span class="actstats">
      ${a.ms != null ? stat("Time", fmtDuration(a.ms), "sky") : ""}${stat("Sets", a.sets, "lime")}${stat("PRs", a.prs, "gold")}
    </span>`;
  return `<li>${canOpen
    ? `<button type="button" class="card act" data-act="activity" data-key="${esc(a.key)}">${body}</button>`
    : `<div class="card act">${body}</div>`}</li>`;
}

// Settings, in categories (Keli, 17 Nov): a list at the bottom of his profile, each opening its own
// page with ‹ Profile to go back, like Strava's. A new setting goes into one of these, or a new one.
const THEMES = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];
const SETTINGS = [
  { key: "profile", label: "Profile", value: () => prefs.name.trim() || "Add your name" },
  { key: "appearance", label: "Appearance", value: () => (THEMES.find(([v]) => v === prefs.theme) || THEMES[0])[1] },
  { key: "data", label: "Data & privacy", value: () => "On this phone" },
];

function settingHtml(key) {
  const cat = SETTINGS.find((c) => c.key === key) || SETTINGS[0];
  let body = "";
  if (cat.key === "profile") {
    body = `
      <div class="card group">
        <label class="grow">
          <span>Name</span>
          <input id="name" type="text" maxlength="40" autocomplete="off" autocapitalize="words" enterkeyhint="done" placeholder="Add your name" value="${esc(prefs.name)}">
        </label>
      </div>
      <p class="foot">Shows on your profile and your activities.</p>`;
  } else if (cat.key === "appearance") {
    body = `
      <div class="card group">
        <div class="grow stack">
          <div class="seg" role="radiogroup" aria-label="Appearance">
            ${THEMES.map(([v, label]) => `<button type="button" role="radio" aria-checked="${prefs.theme === v}" data-act="theme" data-theme="${v}">${label}</button>`).join("")}
          </div>
        </div>
      </div>
      <p class="foot">System follows your phone's light or dark mode.</p>`;
  } else {
    body = `
      <div class="card info">
        <p>Everything you log is saved on this phone only. Nothing is sent anywhere.</p>
        <p>Keep Pathletics on your home screen: deleting it from there deletes your logs too.</p>
      </div>`;
  }
  return `
    <section class="settings">
      <button type="button" class="back" data-act="back">${LEFT}<span>Profile</span></button>
      <header class="head"><h2 class="title">${cat.label}</h2></header>
      ${body}
    </section>`;
}

/* ---------- picking the plan ---------- */

function pickerHtml(picked) {
  return `
    <section class="picker" role="group" aria-label="Plan">
      <h2 class="title">${picked ? "Switch plan" : "Pick your plan"}</h2>
      <ul class="card rows">${program.plans.map((p) => `
        <li><button type="button" class="row" data-act="plan" data-plan="${esc(p.id)}" aria-pressed="${p.id === state.plan}">
          <span class="st ${p.id === state.plan ? "done" : "later"}">${p.id === state.plan ? TICK : ""}</span>
          <span class="rtext"><b>Plan ${esc(p.id)}</b>${p.title ? `<small>${esc(p.title)}</small>` : ""}</span>
        </button></li>`).join("")}
      </ul>
      ${picked ? `<button type="button" class="quiet" data-act="picker">Stay on Plan ${esc(picked.id)}</button>` : ""}
    </section>`;
}

/* ---------- typing ---------- */

root.addEventListener("input", (e) => {
  const el = e.target;
  // His name: only the picture top right is redrawn, so the keyboard stays up.
  if (el.id === "name") {
    prefs.name = el.value.slice(0, 40);
    savePrefs();
    meEl.innerHTML = avatarHtml();
    if (page === "profile") {
      const shown = prefs.name.trim() || "You";
      main.querySelectorAll(".avatar").forEach((a) => { a.innerHTML = avatarHtml(); });
      main.querySelectorAll(".pname, .actmeta b").forEach((b) => { b.textContent = shown; });
    }
    return;
  }
  if (el.id === "note") {
    const s = sessions()[shownIndex()];
    if (!state.logs[s.key]) return;
    setNote(state, s, el.value, today);
    saveSoon();
    return;
  }
  if (!el.matches(".f[data-item]")) return;
  const s = sessions()[shownIndex()];
  if (!state.logs[s.key]) return;
  const item = s.items.find((it) => it.key === el.dataset.item);
  const j = Number(el.dataset.set);
  const v = parseNum(el.value);
  setValue(state, s, item.key, j, v, today);
  el.closest(".set").classList.toggle("hit", hit(item.sets[j], v));
  // Only the counter is redrawn, so the keyboard stays where it is.
  const hits = hitsOf(item, state.logs[s.key]?.vals?.[item.key] ?? []);
  el.closest(".item").querySelector(".count").outerHTML = countHtml(hits, item.sets.length);
  saveSoon();
});

// Tapping a number selects it, so typing replaces it. Safari puts the caret down on
// mouseup, so that first mouseup is cancelled too. Same as Yapp.
let justFocused = null;
root.addEventListener("focusin", (e) => {
  if (!e.target.matches(".f")) return;
  justFocused = e.target;
  e.target.setSelectionRange(0, e.target.value.length);
});
root.addEventListener("mouseup", (e) => {
  if (e.target === justFocused) {
    e.preventDefault();
    e.target.setSelectionRange(0, e.target.value.length);
  }
  justFocused = null;
});
root.addEventListener("focusout", (e) => {
  if (e.target.matches(".f[data-item]") && parseNum(e.target.value) === null) e.target.value = "";
});

root.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "name") e.target.blur();
});

root.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target.closest("form.test");
  if (!form) return;
  const raw = form.querySelector("input").value;
  const v = parseNum(raw);
  if (raw.trim() && v === null) { form.querySelector("input").select(); return; }
  setTest(state, form.dataset.step, v, today);
  testing = null;
  persist();
  redrawLadder();
});

/* ---------- buttons ---------- */

// Throwing something away is two taps with no pop-up: the first arms the button. Same as Yapp.
function armed(btn, label) {
  if (btn.dataset.armed) return true;
  const was = btn.textContent;
  btn.dataset.armed = "1";
  btn.textContent = label;
  btn.classList.add("armed");
  setTimeout(() => {
    if (!btn.isConnected) return;
    delete btn.dataset.armed;
    btn.textContent = was;
    btn.classList.remove("armed");
  }, ARMED_MS);
  return false;
}

const toTop = () => document.body.scrollTo(0, 0);

root.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "test") {
    testing = testing === btn.dataset.step ? null : btn.dataset.step;
    redrawLadder();
    if (testing) document.getElementById("testval")?.focus();
    return;
  }
  if (act === "closetest") {
    testing = null;
    redrawLadder();
    return;
  }
  if (act === "theme") {
    prefs.theme = btn.dataset.theme;
    savePrefs();
    applyTheme();
    render();
    return;
  }
  if (act === "picker") {
    pickerOpen = !pickerOpen;
    render();
    return;
  }
  if (act === "plan") {
    flush();
    state.plan = btn.dataset.plan;
    pickerOpen = false;
    viewing = null;
    page = "today";
    persist();
    render();
    return;
  }
  if (act === "open") {
    flush();
    viewing = Number(btn.dataset.i);
    render();
    toTop();
    return;
  }
  if (act === "back") {
    flush();
    if (page === "profile") {
      opened = null;
      setting = null;
      render();
      document.body.scrollTo(0, profileY);
      return;
    }
    viewing = null;
    render();
    toTop();
    return;
  }
  if (act === "activity") {
    profileY = document.body.scrollTop;
    opened = btn.dataset.key;
    render();
    toTop();
    return;
  }
  if (act === "setting" || act === "editprofile") {
    profileY = document.body.scrollTop;
    setting = act === "editprofile" ? "profile" : btn.dataset.cat;
    render();
    toTop();
    return;
  }
  if (act === "unprofile") {
    opened = null;
    setting = null;
    page = before;
    render();
    toTop();
    return;
  }
  const s = sessions()[shownIndex()];
  if (act === "pause" || act === "resume") {
    const log = state.logs[s.key];
    if (act === "pause") pauseClock(log, Date.now());
    else resumeClock(log, Date.now());
    persist();
    render();
    return;
  }
  if (act === "start") {
    startSession(state, s, today, Date.now());
    persist();
    render();
    // Ask the browser not to clear this site's storage when space runs low.
    navigator.storage?.persist?.().catch(() => {});
  } else if (act === "finish") {
    flush();
    const log = state.logs[s.key];
    const kept = { saved: log.saved, ms: log.ms, run: log.run };
    if (!finishSession(state, s, Date.now())) {
      document.getElementById("finisherr").textContent = "Nothing logged yet.";
      return;
    }
    // Only say it's saved if it really is.
    if (!persist()) {
      log.done = false;
      if (kept.saved) log.saved = kept.saved;
      if (kept.run != null) Object.assign(log, { ms: kept.ms, run: kept.run });
      document.getElementById("finisherr").textContent = "Couldn't save. Try again.";
      return;
    }
    render();
    toTop();
  } else if (act === "reopen") {
    reopenSession(state, s);
    persist();
    render();
  } else if (act === "stop") {
    if (!armed(btn, btn.dataset.confirm)) return;
    flush();
    stopSession(state, s);
    persist();
    render();
    toTop();
  } else if (act === "delete") {
    if (!armed(btn, "Tap again to delete")) return;
    deleteSession(state, s);
    if (page === "profile") opened = null; // back to his activities
    persist();
    render();
    toTop();
  }
});

// His picture top right opens his profile; tapping it there again goes back.
meEl.addEventListener("click", () => {
  flush();
  opened = null;
  setting = null;
  if (page === "profile") page = before;
  else { before = page; page = "profile"; }
  testing = null;
  render();
  toTop();
});

// Tapping the tab you're on goes back to its start, like most apps.
pagesEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-page]");
  if (!btn) return;
  if (btn.dataset.page === page && viewing == null) { toTop(); return; }
  flush();
  page = btn.dataset.page;
  viewing = null;
  opened = null;
  setting = null;
  testing = null;
  render();
  toTop();
});

/* ---------- staying right when the app comes back ---------- */

function checkRollover() {
  const now = todayIso();
  if (now === today) return;
  flush();
  today = now;
  tidyLogs(state, today);
  persist();
  viewing = null;
  testing = null;
  render();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) flush();
  else checkRollover();
});
window.addEventListener("pagehide", flush);
window.addEventListener("pageshow", checkRollover);
setInterval(checkRollover, 60000);

// The clock on screen ticks once a second. The time itself comes from the saved start and
// pause times, so it stays right with the app closed or the phone locked.
setInterval(() => {
  const el = document.getElementById("clocktime");
  const s = el && sessions()[shownIndex()];
  if (s && state.logs[s.key]) el.textContent = fmtClock(elapsed(state.logs[s.key], Date.now()));
}, 1000);

/* ---------- start ---------- */

async function start() {
  render();
  try {
    const res = await fetch(PLAN_URL);
    if (!res.ok) throw new Error(String(res.status));
    program = parsePlan(await res.text());
    if (state.plan && !program.plans.some((p) => p.id === state.plan)) state.plan = null;
    // Only one plan in the file: it's his, no picking needed.
    if (!state.plan && !program.errors.length && program.plans.length === 1) {
      state.plan = program.plans[0].id;
      persist();
    }
  } catch {
    loadError = "Couldn't load the plan. Open the app once with internet.";
  }
  render();
}

start();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
