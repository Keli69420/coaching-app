// A coach gives a student a plan (Keli, 19 Nov). Two sides, both drawn into pages other files own:
//  - the coach's: in a coaching group, "Assign a plan" on each member, and "Plan: <title>" once done;
//  - the student's: assigned plans waiting at the top of "Your plans", and "Update plan" when the
//    coach has changed the one he's on.
// The pure parts are in coach-logic.js (tested). The server rules are in supabase/migrations.

import { me, rest, rpc, errText } from "./social.js";
import { cleanAssignment, assignedPlan, mergePlan, needsUpdate, cleanProgress } from "./coach-logic.js";
import { fmtSet } from "./weight.js";
import { timeAgo } from "./share-logic.js";
import { checkPlan } from "./plans.js";
import { sendUp } from "./market.js";

// Both groups.js and planpages.js pass what they have; the drawing helpers are the same in each.
let ctx = {};
export function initCoach(c) { ctx = { ...ctx, ...c }; }
const esc = (s) => ctx.esc(s);

let plans = null; // from planpages.js: all(), get(id), add(plan), replace(id, plan)
export function registerCoachPlans(p) { plans = p; }

const redraw = () => ctx.render?.();

/* ---------- the coach's side: members of a coaching group ---------- */

// Which plan each member has: student id → title. picking: the member whose picker is open.
const C = { group: "", by: new Map(), picking: "", busy: "", error: "", seq: 0 };

// Asked when a coaching group he owns opens. Nothing here matters if it fails: rows just show no plan.
export async function coachGroupLoad(groupId) {
  if (!me()) return;
  const n = ++C.seq;
  if (C.group !== groupId) { C.group = groupId; C.by = new Map(); C.picking = ""; C.error = ""; }
  try {
    const rows = await rest(`assignments?select=student,plan:plans(id,title)&group_id=eq.${groupId}`);
    if (n !== C.seq) return;
    C.by = new Map((Array.isArray(rows) ? rows : []).filter((r) => r?.student && r.plan?.title).map((r) => [r.student, String(r.plan.title)]));
    redraw();
  } catch { /* the rows just show no plan */ }
}

// His own built plans that have something in them: not saved ones, not ones a coach gave him.
const assignable = () => (plans?.all() ?? []).filter((p) => !p.by && !p.src && !p.asg && !checkPlan(p));

// For one member's row in groups.js: the line under the name, the button, and the picker below.
export function coachMember(m, group) {
  const on = group.owner && group.kind === "coaching" && (ctx.myTier?.() ?? "free") === "coach" && m.id !== me()?.id && plans;
  if (!on) return null;
  const title = C.by.get(m.id);
  const open = C.picking === m.id;
  const list = assignable();
  const pickRow = (p) => `
    <li class="mrow"><button type="button" class="row" data-act="g-asgpick" data-group="${esc(group.id)}" data-student="${esc(m.id)}" data-plan="${esc(p.id)}"${C.busy ? " disabled" : ""}>
      <span class="rtext"><b>${esc(p.title)}</b></span>
    </button></li>`;
  return {
    sub: title ? `Plan: ${esc(title)}` : "",
    button: `<button type="button" class="gact" data-act="g-asg" data-student="${esc(m.id)}">${open ? "Cancel" : title ? "Change plan" : "Assign a plan"}</button>`,
    below: !open ? "" : `
      <li class="gpick">
        ${list.length ? `<ul class="card rows">${list.map(pickRow).join("")}</ul>`
          : `<p class="empty">You have no plan of your own to assign yet. Build one on the Plan tab.</p>`}
        ${C.busy ? `<p class="foot">Sending…</p>` : ""}
        ${C.error ? `<p class="formerr" role="alert">${esc(C.error)}</p>` : ""}
      </li>`,
  };
}

// True when the tap was one of ours. Errors are shown under the picker, not thrown.
export async function coachGroupClick(act, btn) {
  if (act === "g-asg") {
    const id = btn.dataset.student;
    C.picking = C.picking === id ? "" : id;
    C.error = "";
    redraw();
  } else if (act === "g-asgpick") {
    if (C.busy) return;
    const plan = plans?.get(btn.dataset.plan);
    if (!plan) return;
    const { group, student } = btn.dataset;
    C.busy = plan.id;
    C.error = "";
    redraw();
    try {
      // His copy on the server is what the student reads. Edits he hasn't shared yet (stale) are not
      // published by assigning; only a plan never shared is sent up.
      const planId = plan.pub ? plan.pub : await sendUp(plan);
      await rpc("assign_plan", { p_group: group, p_student: student, p_plan: planId });
      C.by.set(student, plan.title.trim() || "My plan");
      C.picking = "";
    } catch (e) {
      C.error = e?.said ? e.message : errText(e);
    }
    C.busy = "";
    redraw();
  }
}

/* ---------- the student's side: Plan tab ---------- */

// null until asked. rows: his assignments as cleanAssignment() reads them.
const S = { rows: null, asked: 0, warn: "" };
const THROTTLE_MS = 30000;
const RETRY_MS = 30000; // after a failed fetch
let askedFor = ""; // whose assignments these are

// Asked when the Plan tab draws, at most every 30 s. Draws again only if something changed.
export function refreshAssignments(force = false) {
  const u = me();
  if (!u) { S.rows = null; askedFor = ""; return; }
  if (askedFor !== u.id) { S.rows = null; S.asked = 0; askedFor = u.id; }
  if (!force && Date.now() - S.asked < THROTTLE_MS) return;
  S.asked = Date.now();
  const q = `assignments?select=id,group_id,updated_at,coach:profiles!assignments_coach_fkey(id,name),plan:plans(id,title,summary,body,updated_at)&student=eq.${u.id}`;
  rest(q).then((rows) => {
    const next = (Array.isArray(rows) ? rows : []).map(cleanAssignment).filter(Boolean);
    const changed = JSON.stringify(next) !== JSON.stringify(S.rows);
    S.rows = next;
    if (changed) redraw();
    relink();
  }).catch(() => { S.asked = Date.now() - THROTTLE_MS + RETRY_MS; /* no signal: try again in 30 s, not on every draw */ });
}

// On his phone: a plan saved from this server plan. The same assignment row can carry another plan
// later (the coach re-assigns); that one is not on the phone, and the old plan stays with its logs.
const onPhone = (a) => plans?.all().find((p) => p.asg?.plan === a.plan.id && p.asg.id === a.id) ?? null;
const sameServerPlan = (a) => plans?.all().find((p) => p.asg?.plan === a.plan.id) ?? null;

// The coach assigned the same plan again under a new assignment row: point his copy at it.
function relink() {
  for (const a of S.rows ?? []) {
    const p = sameServerPlan(a);
    if (p && p.asg.id !== a.id && !onPhone(a)) plans.patch(p.id, { asg: { ...p.asg, id: a.id } });
  }
}
const rowFor = (planId) => { const p = plans?.get(planId); return p?.asg ? (S.rows ?? []).find((a) => a.id === p.asg.id && a.plan.id === p.asg.plan) ?? null : null; };

// The line under a plan in the list, or "" if the coach hasn't changed it.
export const updateReady = (plan) => Boolean(plan?.asg && rowFor(plan.id) && needsUpdate(plan, rowFor(plan.id)));

// <li> rows for the top of "Your plans": assignments not on his phone yet.
export function incomingHtml() {
  if (!me() || !plans) return "";
  const warn = S.warn;
  S.warn = "";
  const rows = (S.rows ?? []).filter((a) => !onPhone(a) && !sameServerPlan(a)).map((a) => `
    <li class="mrow">
      <span class="rtext"><b>${esc(a.plan.title)}</b><small>From your coach · ${esc(a.coach.name)}</small></span>
      <button type="button" class="gact" data-act="p-asg-dismiss" data-id="${esc(a.id)}">Dismiss</button>
      <button type="button" class="ghostbtn" data-act="p-asg-use" data-id="${esc(a.id)}">Use this plan</button>
    </li>`).join("");
  return (warn ? `<li><p class="formerr" role="alert">${esc(warn)}</p></li>` : "") + rows;
}

// On a plan's page: the coach's name, and the update button when he has changed it.
export function assignedBlockHtml(plan) {
  if (!plan?.asg) return "";
  const up = updateReady(plan);
  return up ? `
    <p class="foot">${esc(plan.asg.coach)} changed this plan. Your logs stay.</p>
    <button type="button" class="cta" data-act="p-asg-update" data-plan="${esc(plan.id)}">Update plan</button>`
    : `<p class="foot">From your coach, ${esc(plan.asg.coach)}. To share a version of your own, duplicate it first.</p>`;
}

// For planpages.js: the room to add (the hard cap is its own), and what happened is shown in the list.
export async function coachClick(act, btn) {
  const a = (S.rows ?? []).find((r) => r.id === btn.dataset.id);
  if (act === "p-asg-use") {
    if (!a || !plans) return;
    const plan = assignedPlan(a);
    if (!plan) { S.warn = "This plan has no workouts in it yet."; redraw(); return; }
    if (!plans.add(plan)) { S.warn = "You have 100 plans, the most the app keeps. Delete one first."; redraw(); return; }
    if (!ctx.usePlan?.(plan.id)) S.warn = "This plan can't be used yet.";
    redraw();
    ctx.toTop?.();
  } else if (act === "p-asg-dismiss") {
    if (!a || !ctx.armed?.(btn, "Tap again to dismiss")) return;
    btn.disabled = true;
    try {
      await rest(`assignments?id=eq.${a.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      S.rows = S.rows.filter((r) => r.id !== a.id);
    } catch (e) {
      btn.disabled = false;
      S.warn = errText(e);
    }
    redraw();
  } else if (act === "p-asg-update") {
    const local = plans?.get(btn.dataset.plan);
    const row = local && rowFor(local.id);
    const incoming = row && assignedPlan(row);
    if (!incoming) return;
    plans.replace(local.id, mergePlan(local, incoming)); // same id, so it stays current if it was
    redraw();
  }
}

/* ---------- the student's progress, shared with his coach ---------- */

// Whether he shares with any coach is kept on this phone, so the app can send on open before Groups loads.
const SHARE_KEY = "pathletics.sharing";
const SENT_KEY = "pathletics.progressSent";
const OPEN_GAP_MS = 10 * 60 * 1000;
const SEND_DELAY_MS = 5000;
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* not remembered */ } };

let sharingOn = read(SHARE_KEY) === "1";
let sendTimer = null;
let lastJson = ""; // what the server has, so a change that isn't one sends nothing
let sending = false;
let dirty = false; // a send was asked for while one was running

export const isSharing = () => sharingOn;
export function setSharing(on) {
  sharingOn = Boolean(on);
  write(SHARE_KEY, sharingOn ? "1" : null);
  if (!sharingOn) { clearTimeout(sendTimer); sendTimer = null; lastJson = ""; dirty = false; }
}

// Sends his progress now. Failures are silent: the next change or app open tries again.
export async function sendProgress(force = false) {
  const u = me();
  if (!u || !sharingOn) return;
  if (sending) { dirty = true; return; }
  const snap = ctx.snapshot?.();
  if (!snap) return;
  const json = JSON.stringify(snap);
  if (!force && json === lastJson) return;
  sending = true;
  try {
    await rpc("save_progress", { p_body: snap }); // the server saves it only while he still shares
    lastJson = json;
    write(SENT_KEY, String(Date.now()));
  } catch { /* try again next time */ }
  sending = false;
  if (dirty) { dirty = false; if (sharingOn && me()) await sendProgress(); }
}

// After a workout is saved, finished or deleted: sent once he has stopped for 5 s.
export function progressChanged() {
  if (!sharingOn || !me()) return;
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => sendProgress(), SEND_DELAY_MS);
}

// When the app opens: at most once every 10 minutes.
export function progressOnOpen() {
  if (!sharingOn || !me()) return;
  if (Date.now() - (Number(read(SENT_KEY)) || 0) < OPEN_GAP_MS) return;
  sendProgress();
}

/* ---------- the coach's side: one student's page ---------- */

// snap: null while asked, false when nothing is shared, else what cleanProgress() gave.
const St = { id: "", snap: null, at: 0, error: "", seq: 0 };

export async function studentLoad(id) {
  const n = ++St.seq;
  Object.assign(St, { id, snap: null, at: 0, error: "" });
  try {
    const rows = await rest(`progress?select=body,updated_at&user_id=eq.${encodeURIComponent(id)}`);
    if (n !== St.seq) return;
    const snap = Array.isArray(rows) && rows[0] ? cleanProgress(rows[0].body) : null;
    St.snap = snap || false;
    St.at = Date.parse(rows?.[0]?.updated_at) || 0;
  } catch (e) {
    if (n !== St.seq) return;
    St.snap = false;
    St.error = e?.said ? e.message : errText(e);
  }
  redraw();
}

const dayText = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
const agoText = (ago) => (ago === 0 ? "This week" : `${ago}w ago`);

// The body of the student's page (groups.js draws the back button and the heading).
// "1 set", "3 sets".
const plural = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;

export function studentHtml() {
  if (St.snap == null) return `<p class="empty">Loading…</p>`;
  if (!St.snap) return `<p class="empty">${esc(St.error || "Nothing shared yet.")}</p>`;
  const { weeks, workouts, records } = St.snap;
  const list = [...weeks].sort((a, b) => b.ago - a.ago);
  const top = Math.max(1, ...list.map((w) => w.sets));
  const week = (w) => `
    <li class="mrow wkrow">
      <span class="wklab">${agoText(w.ago)}</span>
      <span class="wktrack" aria-hidden="true"><i style="width:${Math.round((w.sets / top) * 100)}%"></i></span>
      <span class="wknum">${plural(w.workouts, "workout")} · ${plural(w.sets, "set")}</span>
    </li>`;
  const sets = (w) => w.items.reduce((n, it) => n + it.sets.length, 0);
  const workout = (w) => `
    <li><details class="wkout">
      <summary><span class="rtext"><b>${esc(w.day)}</b><small>${esc(dayText(w.date))} · ${plural(sets(w), "set")}</small></span></summary>
      <ul class="wkitems">${w.items.map((it) => `<li><b>${esc(it.name)}</b><small>${it.sets.map((x) => esc(fmtSet(x, it.unit))).join(" · ")}</small></li>`).join("")}</ul>
    </details></li>`;
  const rec = (r) => `<li class="mrow"><span class="rtext"><b>${esc(r.name)}</b></span><span class="val">${esc(fmtSet({ v: r.best, kg: r.kg }, r.unit))}</span></li>`;
  return `
    ${St.at ? `<p class="foot">Updated ${esc(timeAgo(St.at, Date.now()))}</p>` : ""}
    <h2 class="sect">Last ${list.length} weeks</h2>
    ${list.length ? `<ul class="card rows">${list.map(week).join("")}</ul>` : `<p class="empty">No weeks yet.</p>`}
    <h2 class="sect">Workouts</h2>
    ${workouts.length ? `<ul class="card rows">${workouts.map(workout).join("")}</ul>` : `<p class="empty">No saved workouts yet.</p>`}
    <h2 class="sect">Records</h2>
    ${records.length ? `<ul class="card rows">${records.map(rec).join("")}</ul>` : `<p class="empty">No records yet.</p>`}`;
}
