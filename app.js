import {
  parsePlan, sessionsOf, currentIndex, planDone, hit, fmtTarget, fmtPrescription,
  ladderState, stepHistory, parseNum, todayIso, fmtDate, cleanState, emptyState, setValue, setNote, setTest, hasValues,
  weeklyTotals, exerciseStats, sparkPoints, weeksAgo, weeksAgoLabel, fmtVal,
  startSession, finishSession, reopenSession, stopSession, deleteSession, tidyLogs, sessionSummary,
} from "./logic.js";

// The coach's plan. One file holds the ladder and every starting level (Plan A, B, C...).
const PLAN_URL = "plans/muscle-up.md";
// Everything the client logs, on this phone only. Never rename it: old logs would look lost.
const KEY = "coach.v1";
const SAVE_DELAY_MS = 300;
const ARMED_MS = 3000; // how long a "tap again to…" button waits for the second tap
// How far back the You tab looks: from his first logged week, at least 4 weeks, at most 8,
// so a four-week plan doesn't open on a chart that is mostly empty.
const MIN_WEEKS = 4;
const MAX_WEEKS = 8;
let WEEKS = MIN_WEEKS;

const root = document.querySelector(".app");
const main = document.getElementById("main");
const chipEl = document.getElementById("chip");
const pagesEl = document.getElementById("pages");
const statusEl = document.getElementById("status");

let today = todayIso();
// Three tabs (Keli, 17 Nov): "today" shows only today's workout, "plan" this week's
// workouts, "you" the ladder and progress. Always opens on today.
let page = "today";
let program = null; // { ladder, plans, errors }
let loadError = "";
let state = tidyLogs(load(), today);
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

/* ---------- drawing helpers ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const stroke = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
const RIGHT = `<svg class="chev" viewBox="0 0 10 16" width="8" height="13" aria-hidden="true"><path d="M2.5 2 8 8l-5.5 6" ${stroke}/></svg>`;
const LEFT = `<svg class="chev" viewBox="0 0 10 16" width="8" height="13" aria-hidden="true"><path d="M7.5 2 2 8l5.5 6" ${stroke}/></svg>`;
const TICK = `<svg class="tick" viewBox="0 0 16 12" width="14" height="11" aria-hidden="true"><path d="M1.5 6.5 6 10.5 14.5 1.5" ${stroke}/></svg>`;
// Gold is for personal records only, like a medal.
const MEDAL = `<svg class="medal" viewBox="0 0 16 18" width="14" height="16" aria-hidden="true"><path d="M4 1h3l1.6 4.5L10.2 1h1.8L9.8 7" fill="none" stroke="var(--gold-deep)" stroke-width="1.6" stroke-linejoin="round"/><circle cx="8" cy="12" r="5" fill="var(--gold)"/></svg>`;

// A number with a smaller unit after it: "22 s", "6 reps".
const numHtml = (n, unit) => `<b class="num">${esc(n)}</b><small class="unit">${unit === "sec" ? "s" : "reps"}</small>`;
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const plan = () => program?.plans.find((p) => p.id === state.plan) ?? null;
const sessions = () => sessionsOf(plan());
const current = () => currentIndex(sessions(), state.logs, today);
// The workout on screen: one opened from the Plan tab, otherwise today's.
const shownIndex = () => {
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
  else if (page === "you") main.innerHTML = youHtml();
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
  const fromPlan = page === "plan";
  return `
    <section class="session">
      ${fromPlan ? `<button type="button" class="back" data-act="back">${LEFT}<span>${esc(s.week)}</span></button>` : ""}
      <header class="head">
        ${fromPlan ? "" : `<p class="eyebrow">${esc(s.week)}</p>`}
        <h2 class="title">${esc(s.day)}</h2>
      </header>
      ${done ? `<p class="banner">That was the whole plan. Time for a new test under You.</p>` : ""}
      ${!log ? ghostHtml(s) : log.done ? savedHtml(s, list[i + 1]) : activeHtml(s, log)}
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

function activeHtml(s, log) {
  return `
    <div class="items">${s.items.map((it) => itemHtml(it, log)).join("")}</div>
    <textarea class="card note" id="note" rows="2" placeholder="How did it feel? Anything hurt?" aria-label="Notes">${esc(log.note ?? "")}</textarea>
    <button type="button" class="cta" data-act="finish">Save workout</button>
    <p class="formerr" id="finisherr" role="alert"></p>
    <button type="button" class="quiet" data-act="stop" data-confirm="${log.saved ? "Tap again to undo edits" : "Tap again to discard"}">${log.saved ? "Stop editing" : "Stop workout"}</button>`;
}

// Saved: a summary card instead of the fields. Edit opens them again.
function savedHtml(s, next) {
  const { sets, records } = sessionSummary(program.plans.flatMap(sessionsOf), state.logs, s);
  const bits = [count(sets, "set", "sets")];
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
const countHtml = (hits, total) => hits === total
  ? `<span class="count full" aria-label="All ${total} sets hit">${TICK}</span>`
  : `<span class="count" aria-label="${hits} of ${total} sets hit">${hits}/${total}</span>`;

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
  const doneN = days.filter((x) => state.logs[x.s.key]?.done).length;
  const rows = days.map(({ s, j }) => {
    const log = state.logs[s.key];
    const n = s.items.filter((it) => it.sets.length).length;
    let st = "later";
    let sub = count(n, "exercise", "exercises");
    if (log?.done) { st = "done"; sub = `Done ${fmtDate(log.date)}`; }
    else if (j === c) { st = "next"; sub = log ? (log.date === today ? "Today" : "In progress") : "Up next"; }
    else if (hasValues(log)) { st = "next"; sub = `Not saved · ${fmtDate(log.date)}`; }
    else if (j < c) { st = "missed"; sub = "Skipped"; }
    return `
      <li><button type="button" class="row" data-act="open" data-i="${j}">
        <span class="st ${st}">${st === "done" ? TICK : ""}</span>
        <span class="rtext"><b>${esc(s.day)}</b><small>${esc(sub)}</small></span>
        ${RIGHT}
      </button></li>`;
  }).join("");
  return `
    <section class="plan">
      <header class="head">
        <p class="eyebrow">This week</p>
        <h2 class="title">${esc(week)}</h2>
      </header>
      <div class="meter" role="img" aria-label="${doneN} of ${days.length} done"><i style="width:${(100 * doneN / days.length).toFixed(1)}%"></i></div>
      <p class="caption">${doneN} of ${days.length} done</p>
      <ul class="card rows">${rows}</ul>
    </section>`;
}

/* ---------- You: the ladder, this week, the exercises ---------- */

// A progress ring: grey track, the share done in the brand colour, clockwise from the top.
function ring(share) {
  const r = 27;
  const C = 2 * Math.PI * r;
  const len = share <= 0 ? 0 : Math.max(0.04, Math.min(1, share)) * C;
  return `<svg class="ring" viewBox="0 0 64 64" aria-hidden="true"><circle class="track" cx="32" cy="32" r="${r}"/>${len ? `<circle class="arc" cx="32" cy="32" r="${r}" stroke-dasharray="${len.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/>` : ""}</svg>`;
}

function ladderHtml() {
  const { steps, current: at, finished } = ladderState(program.ladder, state.logs, state.tests);
  if (!steps.length) return "";
  const tiles = steps.map((s, i) => {
    const cls = s.done ? "done" : i === at ? "now" : "later";
    const unit = s.unit === "sec" ? " s" : "";
    return `
      <button type="button" class="step ${cls}${testing === s.key ? " open" : ""}" data-act="test" data-step="${esc(s.key)}" aria-expanded="${testing === s.key}"
        aria-label="${esc(s.name)}: PR ${s.best ?? "none yet"} of ${s.target}${unit}. Tap to log a test.">
        <span class="dial">${ring(s.share)}<span class="sval"><b class="num">${s.best ?? 0}</b><small>/${s.target}${s.unit === "sec" ? "s" : ""}</small></span></span>
        <span class="sname">${esc(s.name)}</span>
      </button>`;
  }).join("");
  const open = testing && steps.find((s) => s.key === testing);
  return `<div class="steps">${tiles}</div>${open ? testHtml(open) : trendHtml(finished ? steps[steps.length - 1] : steps[at], finished)}`;
}

function trendHtml(step, finished) {
  const hist = stepHistory(step, state.logs, state.tests);
  const sec = step.unit === "sec" ? " s" : "";
  let big;
  if (finished) big = `<b class="num">${step.best}</b><span>${sec ? "s · " : ""}goal reached</span>`;
  else if (step.best == null) big = `<b class="num">${step.target}</b><span>${sec ? "s " : ""}to go</span>`;
  else big = `<b class="num">${step.target - step.best}</b><span>${sec ? "s " : ""}to go</span>`;
  return `
    <div class="card trend">
      <div class="tnum">
        <p class="tname">${esc(step.name)}${step.best == null ? " · tap to test" : !finished ? ` · PR ${step.best}${sec}` : ""}</p>
        <p class="tbig">${big}</p>
      </div>
      ${hist.length ? `<div class="tchart">${chartSvg(hist, step.target, !finished)}</div>` : ""}
    </div>`;
}

// Best per day as a smooth line, the target as a dashed line. While the goal is still
// ahead, a dashed path climbs from his latest best to a dot on the target: the gap, drawn.
function chartSvg(hist, target, ahead) {
  const W = 200, top = 14, bottom = 66, l = 4, r = 192;
  // The axis starts a little under his lowest day, not at 0, so a rep gained shows as a climb.
  const bests = hist.map((h) => h.best);
  const max = Math.max(target, ...bests);
  const min = bests.length ? Math.max(0, Math.min(...bests) - Math.ceil(target / 5)) : 0;
  const y = (v) => bottom - ((v - min) / (max - min || 1)) * (bottom - top);
  const n = hist.length;
  const last = n ? hist[n - 1].best : null;
  const climb = ahead && last != null && last < target;
  const histR = climb ? 136 : r; // leave room on the right for the path to the goal
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
      <label for="testval">${esc(step.name)} · test today</label>
      <div class="testrow">
        <input class="f" id="testval" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" value="${todays ?? ""}" aria-label="${esc(step.name)}, test today, ${step.unit === "sec" ? "seconds" : "reps"}">
        <span class="unit">${step.unit === "sec" ? "s" : "reps"}</span>
        <button type="submit" class="btn">Save</button>
        <button type="button" class="x" data-act="closetest" aria-label="Close">×</button>
      </div>
    </form>`;
}

function statHtml(value, one, many, diff) {
  const delta = diff > 0 ? `<small class="delta up" aria-label="${diff} more than last week">+${diff}</small>`
    : diff < 0 ? `<small class="delta" aria-label="${-diff} fewer than last week">−${-diff}</small>` : "";
  return `<div class="stat"><b class="num">${value}</b><span>${value === 1 ? one : many}${delta}</span></div>`;
}

// Sets per week as plain bars, this week in the brand colour. Tapping one says what it is.
function barsHtml(totals) {
  const max = Math.max(1, ...totals.map((t) => t.sets));
  const says = totals.map((t) => capital(`${weeksAgoLabel(t.weeksAgo)} · ${count(t.sets, "set", "sets")}, ${count(t.sessions, "workout", "workouts")}`));
  return `
    <div class="pchart" data-chart>
      <div class="bars" role="group" aria-label="Sets per week, last ${WEEKS} weeks">
        ${totals.map((t, i) => `<button type="button" class="bar${t.weeksAgo === 0 ? " on" : ""}" data-read="${esc(says[i])}" data-i="${i}" data-dot="${i}" aria-label="${esc(says[i])}"><i style="height:${t.sets ? Math.max(6, Math.round((100 * t.sets) / max)) : 0}%"></i></button>`).join("")}
      </div>
      <p class="read">${esc(says[says.length - 1])}</p>
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

function youHtml() {
  const first = Object.values(state.logs).map((l) => l.date).filter(Boolean).sort()[0];
  WEEKS = Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, first ? weeksAgo(first, today) + 1 : 0));
  const totals = weeklyTotals(state.logs, today, WEEKS);
  const now = totals[WEEKS - 1];
  const before = totals[WEEKS - 2];
  const stats = exerciseStats(program.plans.flatMap(sessionsOf), state.logs, today, WEEKS);
  return `
    <section class="you">
      <div id="ladder">${ladderHtml()}</div>
      <h2 class="sect">This week</h2>
      <div class="card week">
        <div class="stats">
          ${statHtml(now.sessions, "Workout", "Workouts", now.sessions - before.sessions)}
          ${statHtml(now.sets, "Set", "Sets", now.sets - before.sets)}
        </div>
        ${barsHtml(totals)}
      </div>
      <h2 class="sect">Exercises</h2>
      ${stats.length ? `<ul class="card rows ex">${stats.map(exRowHtml).join("")}</ul>`
        : `<p class="empty">Your PRs show up here after your first workout.</p>`}
    </section>`;
}

// Tapping a bar says what it is, under the chart.
function showRead(el) {
  const chart = el.closest("[data-chart]");
  if (!chart) return;
  chart.querySelector(".read").textContent = el.dataset.read;
  for (const d of chart.querySelectorAll("[data-dot]")) d.classList.toggle("on", d.dataset.dot === el.dataset.i);
}

const redrawLadder = () => {
  const el = document.getElementById("ladder");
  if (el) el.innerHTML = ladderHtml();
};

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
  const read = e.target.closest("[data-read]");
  if (read) { showRead(read); return; }
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
    viewing = null;
    render();
    toTop();
    return;
  }
  const s = sessions()[shownIndex()];
  if (act === "start") {
    startSession(state, s, today);
    persist();
    render();
    // Ask the browser not to clear this site's storage when space runs low.
    navigator.storage?.persist?.().catch(() => {});
  } else if (act === "finish") {
    flush();
    const log = state.logs[s.key];
    const before = log.saved;
    if (!finishSession(state, s)) {
      document.getElementById("finisherr").textContent = "Nothing logged yet.";
      return;
    }
    // Only say it's saved if it really is.
    if (!persist()) {
      log.done = false;
      if (before) log.saved = before;
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
    persist();
    render();
    toTop();
  }
});

// Tapping the tab you're on goes back to its start, like most apps.
pagesEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-page]");
  if (!btn) return;
  if (btn.dataset.page === page && viewing == null) { toTop(); return; }
  flush();
  page = btn.dataset.page;
  viewing = null;
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
