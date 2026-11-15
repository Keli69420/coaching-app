import {
  parsePlan, sessionsOf, currentIndex, planDone, sessionComplete, hit, fmtTarget, fmtPrescription,
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
// How far back the Progress tab looks: from his first logged week, at least 4 weeks, at most 8,
// so a four-week plan doesn't open on a chart that is mostly empty.
const MIN_WEEKS = 4;
const MAX_WEEKS = 8;
let WEEKS = MIN_WEEKS;

const root = document.querySelector(".app");
const main = document.getElementById("main");
const ladderEl = document.getElementById("ladder");
const chipEl = document.getElementById("chip");
const sheetEl = document.querySelector(".sheet");
const pagesEl = document.getElementById("pages");
const statusEl = document.getElementById("status");

let today = todayIso();
let page = "training"; // or "progress". Always opens on training.
let program = null; // { ladder, plans, errors }
let loadError = "";
let state = tidyLogs(load(), today);
let viewing = null; // index of the session on screen; null means the one the app picks
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
    statusEl.textContent = "nicht gespeichert";
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
const chev = (d) => `<svg viewBox="0 0 10 16" width="8" height="13" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const RIGHT = chev("M2.5 2 8 8l-5.5 6");
const TICK = `<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><path d="M1.5 6.5 6 10.5 14.5 1.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const LEFT = chev("M7.5 2 2 8l5.5 6");

// A dial of n ticks like a watch face; the lit ones fill clockwise from the top. share 0..1.
// Any progress lights at least one tick, and only a full share lights them all.
function ticks(share, size, n, len) {
  const c = size / 2, r1 = c - 1, r0 = r1 - len;
  const raw = Math.round(share * n);
  const lit = share <= 0 ? 0 : share >= 1 ? n : Math.min(n - 1, Math.max(1, raw));
  let out = "";
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI - Math.PI / 2;
    const xy = (r) => [(c + r * Math.cos(a)).toFixed(2), (c + r * Math.sin(a)).toFixed(2)];
    const [x1, y1] = xy(r0), [x2, y2] = xy(r1);
    out += `<line class="${k < lit ? "on" : "off"}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  return `<svg class="ticks" viewBox="0 0 ${size} ${size}" aria-hidden="true">${out}</svg>`;
}

// Each exercise card, and its line in the list before Start, gets one of these colours in turn.
const HUES = 5;

// A value with its number set apart from a smaller unit: "22 s", "6 Wdh.".
const numHtml = (n, unit) => `<b class="num">${esc(n)}</b><small class="unit">${unit === "sec" ? "s" : "Wdh."}</small>`;

const plan = () => program?.plans.find((p) => p.id === state.plan) ?? null;
const sessions = () => sessionsOf(plan());
const current = () => currentIndex(sessions(), state.logs, today);
const shownIndex = () => {
  const list = sessions();
  return viewing == null ? current() : Math.max(0, Math.min(viewing, list.length - 1));
};

function render() {
  for (const b of pagesEl.querySelectorAll("button")) {
    if (b.dataset.page === page) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  const broken = Boolean(loadError || !program || program.errors.length);
  pagesEl.hidden = broken || !plan() || pickerOpen;
  sheetEl.classList.toggle("slim", broken || page !== "progress" || pickerOpen);
  if (broken) {
    chipEl.innerHTML = "";
    ladderEl.innerHTML = "";
    if (loadError) main.innerHTML = msgHtml("Noch kein Plan", `<p>${esc(loadError)}</p>`);
    else if (!program) main.innerHTML = `<p class="loading">Plan wird geladen…</p>`;
    else {
      main.innerHTML = msgHtml("Im Plan stimmt etwas nicht", `
        <p>Korrigiere das in <code>${esc(PLAN_URL)}</code>:</p>
        <ul>${program.errors.map((e) => `<li>${e.line ? `Zeile ${e.line}: ` : ""}${esc(e.msg)}</li>`).join("")}</ul>`);
    }
    return;
  }
  const picked = plan();
  // With one plan in the file there's nothing to switch to, so there's no chip at all.
  chipEl.innerHTML = !picked || program.plans.length === 1 ? ""
    : `<button type="button" class="chip${pickerOpen ? " on" : ""}" data-act="picker" aria-expanded="${pickerOpen}" aria-label="Plan ${esc(picked.id)}. Tippen zum Wechseln.">Plan <b>${esc(picked.id)}</b></button>`;
  if (pickerOpen || !picked) {
    ladderEl.innerHTML = "";
    main.innerHTML = pickerHtml(picked);
  } else if (page === "progress") {
    ladderEl.innerHTML = ladderHtml();
    main.innerHTML = progressHtml();
  } else {
    ladderEl.innerHTML = "";
    main.innerHTML = `<section class="session" id="session">${sessionHtml()}</section>`;
  }
}

const msgHtml = (title, body) => `<section class="msg"><h2>${esc(title)}</h2>${body}</section>`;

/* ---------- the ladder: three rings and the trend of the step he's on ---------- */

function ladderHtml() {
  const { steps, current: at, finished } = ladderState(program.ladder, state.logs, state.tests);
  if (!steps.length) return "";
  const gauges = steps.map((s, i) => {
    const cls = s.done ? "done" : i === at ? "now" : "later";
    const unit = s.unit === "sec" ? " s" : "";
    return `
      <button type="button" class="gauge ${cls}${testing === s.key ? " open" : ""}" data-act="test" data-step="${esc(s.key)}" aria-expanded="${testing === s.key}"
        aria-label="${esc(s.name)}: Rekord ${s.best ?? "noch keiner"} von ${s.target}${unit}. Tippen, um einen Test einzutragen.">
        <span class="dial">${ticks(s.share, 100, 48, 9)}
          <span class="val">${s.best == null ? `<b class="none">0</b>` : `<b>${s.best}</b>`}<small>/${s.target}${unit}</small></span>
        </span>
        <span class="gname">${esc(s.name)}${RIGHT}</span>
      </button>`;
  }).join("");
  const open = testing && steps.find((s) => s.key === testing);
  return `<div class="gauges">${gauges}</div>${open ? testHtml(open) : trendHtml(finished ? steps[steps.length - 1] : steps[at], finished)}`;
}

function trendHtml(step, finished) {
  const hist = stepHistory(step, state.logs, state.tests);
  const sec = step.unit === "sec" ? " s" : "";
  let big;
  let label = esc(step.name);
  if (finished) big = `<b>${step.best}</b><span>${sec ? "s, " : ""}Ziel erreicht</span>`;
  else if (step.best == null) big = `<b class="none">0</b><span>Tipp auf den Ring zum Testen</span>`;
  else {
    big = `<b>${step.target - step.best}</b><span>${sec ? "s " : ""}fehlen noch</span>`;
    label += ` · Rekord ${step.best}${sec}`;
  }
  return `
    <div class="trend">
      <div class="tnum"><p class="tlabel">${label}</p><p class="tbig">${big}</p></div>
      <div class="tchart">${chartSvg(hist, step.target, !finished)}</div>
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
    body += `<circle class="dot" cx="${end[0]}" cy="${end[1]}" r="5.5"/>`;
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
    <form class="test" data-step="${esc(step.key)}" autocomplete="off">
      <label for="testval">${esc(step.name)} · Test heute</label>
      <input class="f" id="testval" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" value="${todays ?? ""}" aria-label="${esc(step.name)}, Test heute, ${step.unit === "sec" ? "Sekunden" : "Wiederholungen"}">
      <span class="unit">${step.unit === "sec" ? "s" : "Wdh."}</span>
      <button type="submit" class="btn">Speichern</button>
      <button type="button" class="x" data-act="closetest" aria-label="Schliessen">×</button>
    </form>`;
}

/* ---------- picking the plan ---------- */

function pickerHtml(picked) {
  return `
    <section class="picker" role="group" aria-label="Plan">
      <p class="pickhead">${picked ? "Plan wechseln" : "Wähl deinen Plan"}</p>
      ${program.plans.map((p) => `
        <button type="button" class="pick" data-act="plan" data-plan="${esc(p.id)}" aria-pressed="${p.id === state.plan}">
          <span class="letter">${esc(p.id)}</span>${p.title ? `<span class="ptitle">${esc(p.title)}</span>` : ""}
        </button>`).join("")}
      ${picked ? `<button type="button" class="link" data-act="picker">Bei Plan ${esc(picked.id)} bleiben</button>` : ""}
    </section>`;
}

/* ---------- today's session ---------- */

function kicker(i) {
  const list = sessions();
  const s = list[i];
  const log = state.logs[s.key];
  const c = current();
  if (i === list.length - 1 && planDone(list, state.logs, today)) return "Plan fertig";
  if (log?.done) return log.date === today ? "Heute · gespeichert" : `Erledigt ${fmtDate(log.date)}`;
  if (log) {
    if (log.date === today) return sessionComplete(s, log) ? "Heute · komplett" : "Heute";
    if (hasValues(log)) return `Nicht gespeichert · ${fmtDate(log.date)}`;
  }
  if (i === c) return "Als Nächstes";
  return i < c ? "Nicht eingetragen" : "Kommt noch";
}

// The whole plan as a row of dots, a gap between weeks, each day of the week in its own
// colour: bright = all sets in, faint = some, hollow = skipped, dark = ahead. The ringed one is on screen.
function dotsHtml(shown) {
  const list = sessions();
  const c = current();
  let nth = 0;
  return list.map((s, j) => {
    const log = state.logs[s.key];
    const st = hasValues(log) ? (sessionComplete(s, log) ? "full" : "part") : j < c ? "missed" : "ahead";
    const newWeek = j > 0 && s.week !== list[j - 1].week;
    nth = newWeek ? 0 : j > 0 ? nth + 1 : 0;
    return `<button type="button" class="dot ${st} hue${nth % HUES}${newWeek ? " wk" : ""}${j === shown ? " here" : ""}" data-act="go" data-i="${j}" aria-label="${esc(s.week)} · ${esc(s.day)}"${j === shown ? ' aria-current="true"' : ""}></button>`;
  }).join("");
}

function sessionHtml() {
  const list = sessions();
  const i = shownIndex();
  const s = list[i];
  const log = state.logs[s.key];
  const c = current();
  const away = i !== c;
  const backTo = state.logs[list[c].key]?.date === today ? "Zurück zu heute" : "Zurück zum nächsten Training";
  const done = i === list.length - 1 && planDone(list, state.logs, today);
  return `
    <div class="sesshead">
      <div class="sesstitle">
        <p class="kicker" id="kicker">${esc(kicker(i))}</p>
        <h2>${esc(s.week)} · ${esc(s.day)}</h2>
      </div>
      <div class="nav">
        <button type="button" data-act="prev" aria-label="Vorheriges Training"${i === 0 ? " disabled" : ""}>${LEFT}</button>
        <button type="button" data-act="next" aria-label="Nächstes Training"${i === list.length - 1 ? " disabled" : ""}>${RIGHT}</button>
      </div>
    </div>
    <div class="dots" id="dots" role="group" aria-label="Trainings">${dotsHtml(i)}</div>
    ${away ? `<button type="button" class="link back" data-act="home">${backTo}</button>` : ""}
    ${done ? `<p class="banner">Das war der ganze Plan. Zeit für einen neuen Test unter Fortschritt.</p>` : ""}
    ${!log ? ghostHtml(s) : log.done ? savedHtml(s, list[i + 1]) : `
      <div class="exbar">
        <button type="button" class="pill" data-act="stop" data-confirm="${log.saved ? "Nochmal tippen: Änderungen weg" : "Nochmal tippen zum Verwerfen"}">${log.saved ? "Bearbeiten abbrechen" : "Training abbrechen"}</button>
      </div>
      <div class="items">${s.items.map((it, n) => itemHtml(it, log, n)).join("")}</div>
      <label class="notes">
        <span>Notizen</span>
        <textarea id="note" rows="2" placeholder="Wie hat es sich angefühlt? Tut etwas weh?">${esc(log.note ?? "")}</textarea>
      </label>
      <button type="button" class="start" data-act="finish"><span>Training speichern</span><span class="knob">${TICK}</span></button>
      <p class="formerr" id="finisherr" role="alert"></p>`}`;
}

// Not started yet: what's coming, and a button to start. Same as Yapp.
function ghostHtml(s) {
  return `
    <button type="button" class="start" data-act="start"><span>Training starten</span><span class="knob">${RIGHT}</span></button>
    <ul class="exlist">${s.items.map((it, n) => `<li class="hue${n % HUES}"><span><i aria-hidden="true"></i>${esc(it.name)}</span>${it.sets.length ? `<small>${esc(fmtPrescription(it))}</small>` : ""}</li>`).join("")}</ul>`;
}

// Saved: a summary card instead of the fields. Bearbeiten opens them again.
function savedHtml(s, next) {
  const { sets, records } = sessionSummary(program.plans.flatMap(sessionsOf), state.logs, s);
  const bits = [count(sets, "Satz", "Sätze")];
  if (records.length) bits.push(count(records.length, "neuer Rekord", "neue Rekorde"));
  return `
    <section class="saved">
      <div class="savedhead">
        <span class="knob small">${TICK}</span>
        <div class="savedtext"><h3>${esc(s.day)} gespeichert</h3><p>${bits.join(" · ")}</p></div>
        <button type="button" class="pill" data-act="reopen">Bearbeiten</button>
      </div>
      ${records.map((r) => `<p class="savedpr"><span class="prtag">Rekord</span><span class="savedname">${esc(r.name)}</span><span class="prval">${numHtml(r.best, r.unit)}</span></p>`).join("")}
      ${next ? `<p class="savednext">Als Nächstes: ${esc(next.week)} · ${esc(next.day)}</p>` : ""}
    </section>
    <button type="button" class="textbtn" data-act="delete">Training löschen</button>`;
}

const hitsOf = (it, vals) => it.sets.filter((t, j) => hit(t, vals[j] ?? null)).length;
const miniHtml = (hits, total) =>
  `<span class="mini" aria-label="${hits} von ${total} Sätzen geschafft">${ticks(hits / total, 44, 24, 5)}<span>${hits}/${total}</span></span>`;

// Each exercise is a card that glows brighter in its own colour as sets get hit. A set is
// a disc: the goal shows inside until he types, and a hit disc turns white.
function itemHtml(it, log, n) {
  if (!it.sets.length) {
    return `
      <div class="item reminder">
        <h3>${esc(it.name)}</h3>
        ${it.note ? `<p class="inote">${esc(it.note)}</p>` : ""}
      </div>`;
  }
  const vals = log?.vals?.[it.key] ?? [];
  const hits = hitsOf(it, vals);
  const discs = it.sets.map((t, j) => {
    const v = vals[j] ?? null;
    const goal = t.min == null ? "max" : fmtTarget(t, it.unit).replace(" s", "s");
    return `
      <span class="set${hit(t, v) ? " hit" : ""}">
        <input class="f" data-item="${esc(it.key)}" data-set="${j}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"
          placeholder="${esc(goal)}" aria-label="${esc(`${it.name}, Satz ${j + 1}, Ziel ${fmtTarget(t, it.unit)}`)}" value="${v ?? ""}">
      </span>`;
  }).join("");
  return `
    <div class="item hue${n % HUES}" data-key="${esc(it.key)}" style="--p:${(hits / it.sets.length).toFixed(3)}">
      <div class="itemhead">
        <div><h3>${esc(it.name)}</h3><p class="rx">${esc(fmtPrescription(it))}</p></div>
        ${miniHtml(hits, it.sets.length)}
      </div>
      ${it.note ? `<p class="inote">${esc(it.note)}</p>` : ""}
      <div class="sets">${discs}</div>
    </div>`;
}

/* ---------- the Progress tab, like Yapp's: this week, sets per week, one card per exercise ---------- */

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function tileHtml(value, one, many, diff) {
  const delta = diff > 0 ? `<b class="up">▲ ${diff}</b> vs. Vorwoche` : diff < 0 ? `<b>▼ ${-diff}</b> vs. Vorwoche` : "Gleich wie Vorwoche";
  return `
    <div class="tile">
      <p class="big">${value}</p>
      <p class="lbl">${value === 1 ? one : many}</p>
      <p class="delta">${delta}</p>
    </div>`;
}

// Each week is a column of dots, two wide: the more sets, the more rows light up.
const BAR_ROWS = 6;
function barDots(sets, max) {
  const lit = sets > 0 ? Math.max(1, Math.round((sets / max) * BAR_ROWS)) : 0;
  let out = "";
  for (let row = BAR_ROWS - 1; row >= 0; row--) out += `<i${row < lit ? ' class="lit"' : ""}></i><i${row < lit ? ' class="lit"' : ""}></i>`;
  return out;
}

function barsHtml(totals) {
  const max = Math.max(1, ...totals.map((t) => t.sets));
  return `
    <div class="pchart" data-chart>
      <p class="clabel">Sätze pro Woche</p>
      <div class="bars" role="group" aria-label="Sätze pro Woche, letzte ${WEEKS} Wochen">
        ${totals.map((t, i) => {
          const say = `${weeksAgoLabel(t.weeksAgo)} · ${count(t.sets, "Satz", "Sätze")}, ${count(t.sessions, "Training", "Trainings")}`;
          return `<button type="button" class="bar${t.weeksAgo === 0 ? " on" : ""}" data-read="${esc(say)}" data-i="${i}" data-dot="${i}" aria-label="${esc(say)}">${barDots(t.sets, max)}</button>`;
        }).join("")}
      </div>
      <p class="axis"><span class="read">${weeksAgoLabel(WEEKS - 1)}</span><span>diese Woche</span></p>
    </div>`;
}

function sparkHtml(st) {
  const W = 300, H = 56, PAD = 10;
  const pts = sparkPoints(st.weekly, W, H, PAD);
  if (!pts.length) return `<p class="none">In den letzten ${WEEKS} Wochen nicht gemacht.</p>`;
  const step = (W - 2 * PAD) / (WEEKS - 1);
  const lastI = pts[pts.length - 1].i;
  const says = st.weekly.map((v, i) => `${weeksAgoLabel(WEEKS - 1 - i)} · ${v == null ? "nicht gemacht" : fmtVal(v, st.unit)}`);
  return `
    <div class="pchart spark" data-chart>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${st.name}, bester Satz pro Woche: ${says.join(", ")}`)}">
        ${pts.length > 1 ? `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}"/>` : ""}
        ${pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="5" data-dot="${p.i}"${p.i === lastI ? ' class="on"' : ""}/>`).join("")}
        ${says.map((say, i) => `<rect x="${PAD + i * step - step / 2}" y="0" width="${step}" height="${H}" fill="transparent" data-read="${esc(say)}" data-i="${i}"/>`).join("")}
      </svg>
      <p class="axis"><span class="read">${weeksAgoLabel(WEEKS - 1)}</span><span>diese Woche</span></p>
    </div>`;
}

function statCardHtml(st) {
  const v = (n) => numHtml(n, st.unit);
  const arrow = { up: "▲", down: "▼", same: "=" }[st.trend] ?? "";
  const word = { up: "besser", down: "schlechter", same: "gleich" }[st.trend] ?? "";
  const cell = (c) => `<div class="cell"><span class="lbl">${weeksAgoLabel(c.weeksAgo)}</span><span class="cval">${v(c.best)}</span></div>`;
  return `
    <section class="pcard">
      <div class="phead">
        <h3>${esc(st.name)}</h3>
        <p class="pr"><span class="prtag">Rekord</span><span class="prval">${v(st.pr.best)}</span></p>
      </div>
      <p class="prdate">${fmtDate(st.pr.date)}</p>
      <div class="cmp${st.previous ? "" : " one"}">
        ${cell(st.latest)}
        ${st.previous ? `<span class="arrow ${st.trend}" role="img" aria-label="${word}">${arrow}</span>${cell(st.previous)}` : ""}
      </div>
      ${sparkHtml(st)}
    </section>`;
}

function progressHtml() {
  const first = Object.values(state.logs).map((l) => l.date).filter(Boolean).sort()[0];
  WEEKS = Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, first ? weeksAgo(first, today) + 1 : 0));
  const totals = weeklyTotals(state.logs, today, WEEKS);
  const now = totals[WEEKS - 1];
  const before = totals[WEEKS - 2];
  const stats = exerciseStats(program.plans.flatMap(sessionsOf), state.logs, today, WEEKS);
  return `
    <section class="progress">
      <p class="sect">Diese Woche</p>
      <div class="tiles">
        ${tileHtml(now.sessions, "Training", "Trainings", now.sessions - before.sessions)}
        ${tileHtml(now.sets, "Satz", "Sätze", now.sets - before.sets)}
      </div>
      ${barsHtml(totals)}
      <p class="sect">Übungen</p>
      ${stats.length ? `<div class="pcards">${stats.map(statCardHtml).join("")}</div>`
        : `<p class="empty">Noch nichts eingetragen. Nach deinem ersten Training stehen hier deine Rekorde.</p>`}
    </section>`;
}

// Tapping a bar or a week on a line says what it is, under the chart.
function showRead(el) {
  const chart = el.closest("[data-chart]");
  if (!chart) return;
  chart.querySelector(".read").textContent = el.dataset.read;
  for (const d of chart.querySelectorAll("[data-dot]")) d.classList.toggle("on", d.dataset.dot === el.dataset.i);
}

/* ---------- typing ---------- */

root.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "note") {
    const s = sessions()[shownIndex()];
    if (!state.logs[s.key]) return;
    setNote(state, s, el.value, today);
    refreshAfterLog();
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
  const card = el.closest(".item");
  const hits = hitsOf(item, state.logs[s.key]?.vals?.[item.key] ?? []);
  card.style.setProperty("--p", (hits / item.sets.length).toFixed(3));
  card.querySelector(".mini").outerHTML = miniHtml(hits, item.sets.length);
  refreshAfterLog();
  saveSoon();
});

// The first number turns "Als Nächstes" into "Heute" and fills the session's dot.
// Only those bits are redrawn, so the keyboard stays where it is.
function refreshAfterLog() {
  const i = shownIndex();
  const k = document.getElementById("kicker");
  if (k) k.textContent = kicker(i);
  const d = document.getElementById("dots");
  if (d) d.innerHTML = dotsHtml(i);
}

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
  ladderEl.innerHTML = ladderHtml();
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

// After start or delete the session on screen may have become (or stopped being) today's.
function keepShowing(i) {
  viewing = i === current() ? null : i;
}

function show(index) {
  flush();
  viewing = index === current() ? null : index;
  render();
}

root.addEventListener("click", (e) => {
  const read = e.target.closest("[data-read]");
  if (read) { showRead(read); return; }
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "test") {
    testing = testing === btn.dataset.step ? null : btn.dataset.step;
    ladderEl.innerHTML = ladderHtml();
    if (testing) document.getElementById("testval")?.focus();
    return;
  }
  if (act === "closetest") {
    testing = null;
    ladderEl.innerHTML = ladderHtml();
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
    page = "training";
    persist();
    render();
    return;
  }
  if (act === "prev" || act === "next") {
    show(shownIndex() + (act === "prev" ? -1 : 1));
    return;
  }
  if (act === "go") {
    show(Number(btn.dataset.i));
    return;
  }
  if (act === "home") {
    viewing = null;
    render();
    return;
  }
  const i = shownIndex();
  const s = sessions()[i];
  if (act === "start") {
    startSession(state, s, today);
    persist();
    keepShowing(i);
    render();
    // Ask the browser not to clear this site's storage when space runs low.
    navigator.storage?.persist?.().catch(() => {});
  } else if (act === "finish") {
    flush();
    const log = state.logs[s.key];
    const before = log.saved;
    if (!finishSession(state, s)) {
      document.getElementById("finisherr").textContent = "Noch nichts eingetragen.";
      return;
    }
    // Only say it's saved if it really is.
    if (!persist()) {
      log.done = false;
      if (before) log.saved = before;
      document.getElementById("finisherr").textContent = "Konnte nicht speichern. Versuch es nochmal.";
      return;
    }
    render();
    document.body.scrollTo(0, 0);
  } else if (act === "reopen") {
    reopenSession(state, s);
    persist();
    render();
  } else if (act === "stop") {
    if (!armed(btn, btn.dataset.confirm)) return;
    flush();
    stopSession(state, s);
    persist();
    keepShowing(i);
    render();
    document.body.scrollTo(0, 0);
  } else if (act === "delete") {
    if (!armed(btn, "Nochmal tippen zum Löschen")) return;
    deleteSession(state, s);
    persist();
    keepShowing(i);
    render();
    document.body.scrollTo(0, 0);
  }
});

pagesEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-page]");
  if (!btn || btn.dataset.page === page) return;
  flush();
  page = btn.dataset.page;
  testing = null;
  render();
  document.body.scrollTo(0, 0);
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
    loadError = "Der Plan konnte nicht geladen werden. Öffne die App einmal mit Internet.";
  }
  render();
}

start();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
