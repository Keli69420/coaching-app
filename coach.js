// A coach gives a student a plan (Keli, 19 Nov). Two sides, both drawn into pages other files own:
//  - the coach's: in a coaching group, "Assign a plan" on each member, and "Plan: <title>" once done;
//  - the student's: assigned plans waiting at the top of "Your plans", and "Update plan" when the
//    coach has changed the one he's on.
// The pure parts are in coach-logic.js (tested). The server rules are in supabase/migrations.

import { me, rest, rpc, errText } from "./social.js";
import { cleanAssignment, assignedPlan, mergePlan, needsUpdate } from "./coach-logic.js";
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
