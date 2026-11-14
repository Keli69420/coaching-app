import {
  parsePlan, sessionsOf, currentIndex, planDone, sessionComplete, hit, fmtTarget, fmtPrescription,
  ladderState, stepHistory, parseNum, todayIso, fmtDate, cleanState, emptyState, setValue, setNote, setTest, hasValues,
} from "./logic.js";

// The coach's plan. One file holds the ladder and every starting level (Plan A, B, C...).
const PLAN_URL = "plans/muscle-up.md";
// Everything the client logs, on this phone only. Never rename it: old logs would look lost.
const KEY = "coach.v1";
const SAVE_DELAY_MS = 300;

const root = document.querySelector(".app");
const main = document.getElementById("main");
const ladderEl = document.getElementById("ladder");
const chipEl = document.getElementById("chip");
const statusEl = document.getElementById("status");

let today = todayIso();
let program = null; // { ladder, plans, errors }
let loadError = "";
let state = load();
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
  } catch {
    statusEl.textContent = "nicht gespeichert";
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
const LEFT = chev("M7.5 2 2 8l5.5 6");

// A ring that fills clockwise from the top. share 0..1.
function ring(share, size, r, cls = "") {
  const c = 2 * Math.PI * r;
  const arc = share > 0
    ? `<circle class="arc" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - share)).toFixed(2)}"/>`
    : "";
  return `<svg class="ring ${cls}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}"/>${arc}</svg>`;
}

const plan = () => program?.plans.find((p) => p.id === state.plan) ?? null;
const sessions = () => sessionsOf(plan());
const current = () => currentIndex(sessions(), state.logs, today);
const shownIndex = () => {
  const list = sessions();
  return viewing == null ? current() : Math.max(0, Math.min(viewing, list.length - 1));
};

function render() {
  if (loadError || !program || program.errors.length) {
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
  // With one plan in the file there's nothing to switch to, so the chip is just a label.
  chipEl.innerHTML = !picked ? ""
    : program.plans.length === 1 ? `<span class="chip">Plan <b>${esc(picked.id)}</b></span>`
    : `<button type="button" class="chip${pickerOpen ? " on" : ""}" data-act="picker" aria-expanded="${pickerOpen}" aria-label="Plan ${esc(picked.id)}. Tippen zum Wechseln.">Plan <b>${esc(picked.id)}</b></button>`;
  ladderEl.innerHTML = ladderHtml();
  main.innerHTML = pickerOpen || !picked ? pickerHtml(picked) : `<section class="session" id="session">${sessionHtml()}</section>`;
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
        <span class="dial">${ring(s.share, 100, 43)}
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
  if (hasValues(log)) {
    if (log.date === today) return sessionComplete(s, log) ? "Heute · komplett" : "Heute";
    return `Erledigt ${fmtDate(log.date)}`;
  }
  if (i === c) return "Als Nächstes";
  return i < c ? "Nicht eingetragen" : "Kommt noch";
}

// The whole plan as a row of dots, a gap between weeks: lime = all sets in,
// olive = some, hollow = skipped, dark = ahead. The ringed one is on screen.
function dotsHtml(shown) {
  const list = sessions();
  const c = current();
  return list.map((s, j) => {
    const log = state.logs[s.key];
    const st = hasValues(log) ? (sessionComplete(s, log) ? "full" : "part") : j < c ? "missed" : "ahead";
    const wk = j > 0 && s.week !== list[j - 1].week ? " wk" : "";
    return `<button type="button" class="dot ${st}${wk}${j === shown ? " here" : ""}" data-act="go" data-i="${j}" aria-label="${esc(s.week)} · ${esc(s.day)}"${j === shown ? ' aria-current="true"' : ""}></button>`;
  }).join("");
}

function sessionHtml() {
  const list = sessions();
  const i = shownIndex();
  const s = list[i];
  const log = state.logs[s.key];
  const notes = [...plan().notes, ...s.weekNotes, ...s.notes];
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
    ${done ? `<p class="banner">Das war der ganze Plan. Zeit für einen neuen Test.</p>` : ""}
    ${notes.length ? `<div class="daynotes">${notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>` : ""}
    <div class="items">${s.items.map((it) => itemHtml(it, log)).join("")}</div>
    <label class="notes">
      <span>Notizen</span>
      <textarea id="note" rows="2" placeholder="Wie hat es sich angefühlt? Tut etwas weh?">${esc(log?.note ?? "")}</textarea>
    </label>`;
}

const hitsOf = (it, vals) => it.sets.filter((t, j) => hit(t, vals[j] ?? null)).length;
const miniHtml = (hits, total) =>
  `<span class="mini" aria-label="${hits} von ${total} Sätzen geschafft">${ring(hits / total, 44, 18)}<span>${hits}/${total}</span></span>`;

// Each exercise is a card that glows brighter as sets get hit. A set is a disc:
// the goal shows inside until he types, and a hit disc turns lime.
function itemHtml(it, log) {
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
    <div class="item" data-key="${esc(it.key)}" style="--p:${(hits / it.sets.length).toFixed(3)}">
      <div class="itemhead">
        <div><h3>${esc(it.name)}</h3><p class="rx">${esc(fmtPrescription(it))}</p></div>
        ${miniHtml(hits, it.sets.length)}
      </div>
      ${it.note ? `<p class="inote">${esc(it.note)}</p>` : ""}
      <div class="sets">${discs}</div>
    </div>`;
}

/* ---------- typing ---------- */

root.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "note") {
    const s = sessions()[shownIndex()];
    setNote(state, s, el.value, today);
    refreshAfterLog();
    saveSoon();
    return;
  }
  if (!el.matches(".f[data-item]")) return;
  const s = sessions()[shownIndex()];
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

// Logging a pull-up can move the rings, and the first number turns "Als Nächstes" into "Heute".
// Only those bits are redrawn, so the keyboard stays where it is.
function refreshAfterLog() {
  const i = shownIndex();
  const k = document.getElementById("kicker");
  if (k) k.textContent = kicker(i);
  const d = document.getElementById("dots");
  if (d) d.innerHTML = dotsHtml(i);
  if (!testing) ladderEl.innerHTML = ladderHtml();
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

function show(index) {
  flush();
  viewing = index === current() ? null : index;
  render();
}

root.addEventListener("click", (e) => {
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
  }
});

/* ---------- staying right when the app comes back ---------- */

function checkRollover() {
  const now = todayIso();
  if (now === today) return;
  flush();
  today = now;
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
