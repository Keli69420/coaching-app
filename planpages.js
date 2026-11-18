// The Plan tab below this week's workouts (Keli, 18 Nov): his plans, a plan's own page, and the
// builder for making or changing one. The pure parts are in plans.js. app.js hands over what it
// needs through initPlans(), like groups.js.
//
// His own plans live on this phone under coach.plans, apart from his logs (coach.v1).

import {
  LIMITS, cleanPlans, newPlan, addWeek, copyWeek, addDay, addItem, removeWeek, removeDay, removeItem, setItemField,
  findDay, findWeek, copyPlan, fromProgramPlan, checkPlan, planSummary, fmtItem, toProgramPlan,
} from "./plans.js";

const KEY = "coach.plans";
let ctx = null;
let store = load();
let shaped = null; // his plans in the shape the rest of the app reads, rebuilt after every change
// Which plan's page is open (its id), whether it's being changed, and a line to show once on it.
const P = { open: null, edit: false, note: "" };

function load() {
  try { return cleanPlans(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return cleanPlans(null); }
}

// True when it's stored. A plan is small, so every change is written at once: no timer to lose.
function save() {
  shaped = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    ctx?.status("");
    return true;
  } catch {
    ctx?.status("plan not saved");
    return false;
  }
}

export function initPlans(c) { ctx = c; }

// His own plans, ready for sessionsOfAny(): the same shape as the coach's file gives.
export function ownPlans() {
  if (!shaped) shaped = store.plans.map(toProgramPlan);
  return shaped;
}

export const planPageOpen = () => P.open != null;
export function closePlanPage() { P.open = null; P.edit = false; P.note = ""; }

const mine = (id) => store.plans.find((p) => p.id === id) ?? null;
const fromFile = (id) => ctx.filePlans().find((p) => p.id === id) ?? null;

// What a plan is called on screen. With one plan in the coach's file it's just "Coach's plan".
export function planLabel(id) {
  const own = mine(id);
  if (own) return own.title.trim() || "My plan";
  const file = fromFile(id);
  if (!file) return "Plan";
  return ctx.filePlans().length === 1 ? "Coach's plan" : `Plan ${file.id}`;
}

// "4 weeks · 3 workouts a week" for the coach's plan, the same words planSummary() gives his own.
function fileSummary(p) {
  const weeks = p.weeks.map((w) => w.days.length).filter(Boolean);
  const total = weeks.reduce((a, b) => a + b, 0);
  const w = `${weeks.length} ${weeks.length === 1 ? "week" : "weeks"}`;
  if (weeks.length > 1 && weeks.every((n) => n === weeks[0])) return `${w} · ${weeks[0]} ${weeks[0] === 1 ? "workout" : "workouts"} a week`;
  return `${w} · ${total} ${total === 1 ? "workout" : "workouts"}`;
}

/* ---------- the list under this week's workouts ---------- */

export function plansListHtml(heading = "Your plans") {
  const { esc, TICK, RIGHT } = ctx;
  const cur = ctx.currentId();
  const row = (id, name, sub) => `
    <li><button type="button" class="row" data-act="p-open" data-plan="${esc(id)}">
      <span class="st ${id === cur ? "done" : "later"}">${id === cur ? TICK : ""}</span>
      <span class="rtext"><b>${esc(name)}</b><small>${esc(sub)}</small></span>
      ${RIGHT}
    </button></li>`;
  const rows = [
    ...ctx.filePlans().map((p) => row(p.id, planLabel(p.id), fileSummary(p))),
    ...store.plans.map((p) => row(p.id, planLabel(p.id), p.by ? `${planSummary(p)} · by ${p.by}` : planSummary(p))),
  ];
  const full = store.plans.length >= LIMITS.plans;
  return `
    <h2 class="sect">${esc(heading)}</h2>
    <ul class="card rows">
      ${rows.join("")}
      ${full ? "" : `<li><button type="button" class="row add" data-act="p-new"><span class="gicon plus" aria-hidden="true">+</span><span class="rtext"><b>New plan</b></span></button></li>`}
    </ul>
    ${full ? `<p class="foot">That's ${LIMITS.plans} plans, the most the app keeps. Delete one to make room.</p>` : ""}`;
}

/* ---------- one plan's page ---------- */

export function planPageHtml() {
  const own = mine(P.open);
  if (own && P.edit) return builderHtml(own);
  const file = own ? null : fromFile(P.open);
  if (!own && !file) { closePlanPage(); return plansListHtml(); }
  const { esc, LEFT } = ctx;
  const missing = own ? checkPlan(own) : "";
  const isCurrent = P.open === ctx.currentId() && !missing;
  const weeks = own
    ? own.weeks.map((w) => ({ title: w.title, days: w.days.map((d) => ({ title: d.title, items: d.items.filter((it) => it.name.trim()).map((it) => ({ name: it.name, rx: fmtItem(it) })) })) }))
    : file.weeks.map((w) => ({ title: w.title, days: w.days.map((d) => ({ title: d.title, items: d.items.map((it) => ({ name: it.name, rx: it.sets.length ? ctx.fmtPrescription(it) : "" })) })) }));
  const note = P.note;
  P.note = "";
  return `
    <section class="planpage">
      <button type="button" class="back" data-act="p-back">${LEFT}<span>Plan</span></button>
      <header class="head">
        <p class="eyebrow">${own ? (own.by ? `By ${esc(own.by)}` : "Your plan") : "From your coach"}</p>
        <h2 class="title">${esc(planLabel(P.open))}</h2>
        <p class="psum">${esc(own ? planSummary(own) : fileSummary(file))}</p>
      </header>
      ${note ? `<p class="gnote" role="status">${esc(note)}</p>` : ""}
      ${isCurrent ? `<p class="gnote">This is the plan you're on.</p>`
        : `<button type="button" class="cta" data-act="p-use"${missing ? " disabled" : ""}>Use this plan</button>
           ${missing ? `<p class="foot">${esc(missing)}</p>` : `<p class="foot">Everything you've logged stays, and you can switch back any time.</p>`}`}
      <div class="pacts">
        ${own ? `<button type="button" class="ghostbtn" data-act="p-edit">Edit</button>` : ""}
        <button type="button" class="ghostbtn plain" data-act="p-copy">${own ? "Duplicate" : "Copy to change it"}</button>
      </div>
      ${weeks.map((w) => `
        <h3 class="pweekname">${esc(w.title)}</h3>
        ${w.days.length ? w.days.map((d) => `
          <p class="pdayname">${esc(d.title)}</p>
          ${d.items.length ? `<ul class="card list">${d.items.map((it) => `<li><span class="lname">${esc(it.name)}</span>${it.rx ? `<span class="rx">${esc(it.rx)}</span>` : ""}</li>`).join("")}</ul>`
            : `<p class="empty">No exercises yet.</p>`}`).join("")
          : `<p class="empty">No workouts yet.</p>`}`).join("")}
      ${own ? `<button type="button" class="quiet danger" data-act="p-delete">Delete plan</button>` : ""}
    </section>`;
}

/* ---------- the builder ---------- */

// Every field saves as he types and nothing is redrawn while he does, so the keyboard stays up.
// Only adding or removing a part redraws the page.
function builderHtml(plan) {
  const { esc, LEFT } = ctx;
  const itemHtml = (d, it, i) => `
    <div class="pitem">
      <div class="pline">
        <input class="pin pex" data-pf="name" data-d="${d.id}" data-i="${i}" type="text" maxlength="${LIMITS.name}" autocomplete="off" autocapitalize="words"
          placeholder="Exercise" aria-label="Exercise name" value="${esc(it.name)}">
        <button type="button" class="pdel" data-act="p-rmitem" data-d="${d.id}" data-i="${i}" aria-label="Remove ${esc(it.name || "exercise")}">Remove</button>
      </div>
      <div class="pline wrap">
        <input class="pin pnum" data-pf="sets" data-d="${d.id}" data-i="${i}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" aria-label="Sets" value="${it.sets}">
        <span class="times">×</span>
        <input class="pin pnum" data-pf="amount" data-d="${d.id}" data-i="${i}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off"
          placeholder="max" aria-label="${it.unit === "sec" ? "Seconds" : "Reps"} per set, empty for as many as you can" value="${it.amount ?? ""}">
        <button type="button" class="punit" data-act="p-unit" data-d="${d.id}" data-i="${i}" aria-label="Counted in ${it.unit === "sec" ? "seconds" : "reps"}. Tap to change.">${it.unit === "sec" ? "sec" : "reps"}</button>
        <input class="pin pnote" data-pf="note" data-d="${d.id}" data-i="${i}" type="text" maxlength="${LIMITS.note}" autocomplete="off" placeholder="Note" aria-label="Note" value="${esc(it.note)}">
      </div>
    </div>`;
  const dayHtml = (d) => `
    <div class="card pday">
      <div class="pline phead">
        <input class="pin pdaytitle" data-pf="day" data-d="${d.id}" type="text" maxlength="${LIMITS.title}" autocomplete="off" autocapitalize="words" aria-label="Workout name" value="${esc(d.title)}">
        <button type="button" class="pdel" data-act="p-rmday" data-d="${d.id}">Remove</button>
      </div>
      ${d.items.map((it, i) => itemHtml(d, it, i)).join("")}
      ${d.items.length < LIMITS.items ? `<button type="button" class="padd" data-act="p-additem" data-d="${d.id}">+ Add exercise</button>` : ""}
    </div>`;
  return `
    <section class="planpage build">
      <button type="button" class="back" data-act="p-done">${LEFT}<span>Done</span></button>
      <div class="card group">
        <label class="grow"><span>Name</span><input data-pf="title" type="text" maxlength="${LIMITS.title}" autocomplete="off" autocapitalize="sentences" placeholder="My plan" value="${esc(plan.title)}"></label>
      </div>
      <p class="foot">Sets × reps for each exercise. Tap <b>reps</b> to switch to seconds; leave the number empty for "as many as you can".</p>
      ${plan.weeks.map((w) => `
        <div class="pweek">
          <div class="pline phead">
            <input class="pin pweektitle" data-pf="week" data-w="${w.id}" type="text" maxlength="${LIMITS.title}" autocomplete="off" autocapitalize="words" aria-label="Week name" value="${esc(w.title)}">
            <button type="button" class="pdel" data-act="p-rmweek" data-w="${w.id}">Remove</button>
          </div>
          ${w.days.map(dayHtml).join("")}
          <div class="pline pmore">
            ${w.days.length < LIMITS.days ? `<button type="button" class="padd" data-act="p-addday" data-w="${w.id}">+ Add workout</button>` : ""}
            ${plan.weeks.length < LIMITS.weeks ? `<button type="button" class="padd" data-act="p-copyweek" data-w="${w.id}">Copy this week</button>` : ""}
          </div>
        </div>`).join("")}
      ${plan.weeks.length < LIMITS.weeks ? `<button type="button" class="padd wide" data-act="p-addweek">+ Add week</button>` : ""}
      <button type="button" class="cta" data-act="p-done">Done</button>
    </section>`;
}

/* ---------- typing and tapping ---------- */

// True when the field was one of the builder's.
export function plansInput(el) {
  const f = el.dataset.pf;
  const plan = mine(P.open);
  if (!f || !plan) return Boolean(f);
  if (f === "title") plan.title = el.value.slice(0, LIMITS.title);
  else if (f === "week") { const w = findWeek(plan, el.dataset.w); if (w) w.title = el.value.slice(0, LIMITS.title); }
  else if (f === "day") { const d = findDay(plan, el.dataset.d); if (d) d.title = el.value.slice(0, LIMITS.title); }
  else setItemField(plan, el.dataset.d, Number(el.dataset.i), f, el.value);
  save();
  return true;
}

// Leaving a number field shows what was understood: "0" or "abc" go back to what it was.
export function plansBlur(el) {
  const f = el.dataset.pf;
  if (f !== "sets" && f !== "amount") return;
  const it = findDay(mine(P.open) ?? { weeks: [] }, el.dataset.d)?.items[Number(el.dataset.i)];
  if (it) el.value = f === "sets" ? it.sets : it.amount ?? "";
}

function redraw(focus) {
  ctx.render();
  if (focus) document.querySelector(focus)?.focus();
}

export function plansClick(act, btn) {
  const plan = mine(P.open);
  if (act === "p-open") {
    P.open = btn.dataset.plan;
    P.edit = false;
    ctx.render();
    ctx.toTop();
  } else if (act === "p-back") {
    closePlanPage();
    ctx.render();
    ctx.toTop();
  } else if (act === "p-new") {
    if (store.plans.length >= LIMITS.plans) return;
    const fresh = newPlan();
    store.plans.push(fresh);
    save();
    P.open = fresh.id;
    P.edit = true;
    ctx.render();
    ctx.toTop();
  } else if (act === "p-copy") {
    if (store.plans.length >= LIMITS.plans) { P.note = `You have ${LIMITS.plans} plans, the most the app keeps. Delete one first.`; ctx.render(); return; }
    const file = plan ? null : fromFile(P.open);
    const copy = plan ? copyPlan(plan, { title: `${plan.title.trim() || "My plan"} copy`.slice(0, LIMITS.title) })
      : file ? fromProgramPlan(file, { title: `${planLabel(file.id)} copy` }) : null;
    if (!copy) return;
    store.plans.push(copy);
    save();
    P.open = copy.id;
    P.edit = false;
    P.note = "This copy is yours to change.";
    ctx.render();
    ctx.toTop();
  } else if (act === "p-use") {
    if (!ctx.usePlan(P.open)) return;
    closePlanPage();
    ctx.render();
    ctx.toTop();
  } else if (!plan) {
    // Everything below changes one of his own plans.
  } else if (act === "p-edit") {
    P.edit = true;
    ctx.render();
    ctx.toTop();
  } else if (act === "p-done") {
    P.edit = false;
    // Read it back the way it's stored, so what he sees is what was kept (empty exercises go).
    const tidy = cleanPlans({ plans: [plan] }).plans[0];
    if (tidy) store.plans[store.plans.indexOf(plan)] = tidy;
    save();
    ctx.render();
    ctx.toTop();
  } else if (act === "p-delete") {
    if (!ctx.armed(btn, "Tap again to delete")) return;
    store.plans = store.plans.filter((p) => p !== plan);
    save();
    if (ctx.currentId() === plan.id) ctx.usePlan(null);
    closePlanPage();
    ctx.render();
    ctx.toTop();
  } else if (act === "p-addweek") {
    const w = addWeek(plan);
    save();
    redraw(w && `[data-pf="week"][data-w="${w.id}"]`);
  } else if (act === "p-copyweek") {
    const w = copyWeek(plan, btn.dataset.w);
    save();
    redraw(w && `[data-pf="week"][data-w="${w.id}"]`);
  } else if (act === "p-addday") {
    const d = addDay(plan, btn.dataset.w);
    save();
    redraw(d && `[data-pf="day"][data-d="${d.id}"]`);
  } else if (act === "p-additem") {
    const d = findDay(plan, btn.dataset.d);
    addItem(plan, btn.dataset.d);
    save();
    redraw(d && `[data-pf="name"][data-d="${d.id}"][data-i="${d.items.length - 1}"]`);
  } else if (act === "p-unit") {
    const it = findDay(plan, btn.dataset.d)?.items[Number(btn.dataset.i)];
    if (!it) return;
    setItemField(plan, btn.dataset.d, Number(btn.dataset.i), "unit", it.unit === "sec" ? "reps" : "sec");
    save();
    btn.textContent = it.unit === "sec" ? "sec" : "reps";
    btn.setAttribute("aria-label", `Counted in ${it.unit === "sec" ? "seconds" : "reps"}. Tap to change.`);
  } else if (act === "p-rmitem") {
    // An exercise with nothing typed in it goes at once; a named one takes two taps.
    const it = findDay(plan, btn.dataset.d)?.items[Number(btn.dataset.i)];
    if (it?.name.trim() && !ctx.armed(btn, "Tap again")) return;
    removeItem(plan, btn.dataset.d, Number(btn.dataset.i));
    save();
    redraw();
  } else if (act === "p-rmday") {
    const d = findDay(plan, btn.dataset.d);
    if (d?.items.some((it) => it.name.trim()) && !ctx.armed(btn, "Tap again")) return;
    removeDay(plan, btn.dataset.d);
    save();
    redraw();
  } else if (act === "p-rmweek") {
    const w = findWeek(plan, btn.dataset.w);
    if (w?.days.some((d) => d.items.some((it) => it.name.trim())) && !ctx.armed(btn, "Tap again")) return;
    removeWeek(plan, btn.dataset.w);
    save();
    redraw();
  }
}
