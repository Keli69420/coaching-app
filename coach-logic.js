// Who may do what: the free account and the coach account (Keli, 18 Nov).
// Free accounts build 1 plan and keep 5 saved from others; coaches get up to 100 plans in all.
// Pure parts, tested in tests/coach-logic.test.mjs. Plans already on a phone are never removed:
// these limits only ever block adding. A plan a coach assigned (it carries `asg`) never counts.

import { cleanPlan, checkPlan, LIMITS } from "./plans.js";

const FREE = { built: 1, saved: 5, total: 6, groups: 1, groupSize: 10, kind: "friends" };
const COACH = { built: 100, saved: 100, total: 100, groups: 10, groupSize: 50, kind: "coaching" };

export const cleanTier = (t) => (t === "coach" ? "coach" : "free");

export const limitsFor = (tier) => ({ ...(cleanTier(tier) === "coach" ? COACH : FREE) });

// Sorts plans into the ones he built, the ones saved from someone else (`by` or `src`, which a
// duplicate of a saved plan loses: copyPlan drops both), and the ones a coach assigned.
export function countPlans(plans) {
  const n = { built: 0, saved: 0, assigned: 0 };
  for (const p of Array.isArray(plans) ? plans : []) {
    if (!p || typeof p !== "object" || Array.isArray(p)) continue;
    if (p.asg) n.assigned++;
    else if (p.by || p.src) n.saved++;
    else n.built++;
  }
  return n;
}

// null when he may add one more of `kind` ("built" | "saved"), else the reason: "built" | "saved" | "total".
export function planBlock(tier, plans, kind) {
  const lim = limitsFor(tier);
  const n = countPlans(plans);
  if (cleanTier(tier) === "coach" && n.built + n.saved >= lim.total) return "total";
  if (kind === "saved") return n.saved >= lim.saved ? "saved" : null;
  return n.built >= lim.built ? "built" : null;
}

export const groupBlock = (tier, ownedCount) => (Number(ownedCount) >= limitsFor(tier).groups ? "groups" : null);

export function limitText(code, tier) {
  const free = cleanTier(tier) === "free";
  const lim = limitsFor(tier);
  if (code === "built" && free) return `Free accounts build ${lim.built} plan. Coaches can make as many as they like.`;
  if (code === "saved" && free) return `Free accounts keep ${lim.saved} saved plans. Delete one to save another.`;
  if (code === "total") return `You have ${lim.total} plans, the most an account can keep. Delete one first.`;
  if (code === "groups") {
    return free ? `Free accounts can make ${lim.groups} group. Coaches can make up to ${limitsFor("coach").groups}.`
      : `You have ${lim.groups} groups, the most a coach can make.`;
  }
  return "You've reached the limit for your account.";
}

/* ---------- plans a coach assigns ---------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const line = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

// An assignment row as the student reads it (the plan and the coach embedded), cut down to what the
// app can use: { id, group, at, coach: { id, name }, plan: { id, title, summary, at, body } }.
export function cleanAssignment(raw) {
  if (!isObj(raw) || !UUID.test(raw.id)) return null;
  const c = raw.coach;
  const p = raw.plan;
  if (!isObj(c) || !UUID.test(c.id) || !isObj(p) || !UUID.test(p.id) || !isObj(p.body)) return null;
  const at = Date.parse(raw.updated_at);
  const pat = Date.parse(p.updated_at);
  return {
    id: raw.id,
    group: typeof raw.group_id === "string" && UUID.test(raw.group_id) ? raw.group_id : null,
    at: Number.isFinite(at) ? at : 0,
    coach: { id: c.id, name: line(c.name, LIMITS.name) || "Coach" },
    plan: {
      id: p.id,
      title: line(p.title, 60) || "Plan",
      summary: line(p.summary, 140),
      at: Number.isFinite(pat) ? pat : 0,
      body: p.body,
    },
  };
}

// The assigned plan as a plan of his own: new ids, the coach's name on it, and `asg` to find it again.
// Null when there's no workout in it.
export function assignedPlan(a) {
  if (!a || !isObj(a.plan) || !isObj(a.plan.body) || !isObj(a.coach)) return null;
  const plan = cleanPlan({ title: a.plan.title, weeks: a.plan.body.weeks, by: a.coach.name }, { fresh: true, adopt: true });
  if (!plan || checkPlan(plan)) return null;
  plan.asg = { id: a.id, plan: a.plan.id, at: a.plan.at, coach: a.coach.name };
  return plan;
}

// The coach's changes on top of his copy. The incoming content wins, but the plan id stays, and so do
// the week and workout ids, so logs keyed `${plan.id}|${day.id}` stay attached. Parts are matched by
// `from` (the id they have on the server); by position only for a local part with no `from` (a copy
// made before ids were kept), and never when the list has `from`s, so a workout he added himself
// doesn't take the id of a new one. One local id is never given twice.
function matchParts(localList, incomingList) {
  const used = new Set();
  const legacy = !localList.some((p) => p.from);
  const out = incomingList.map(() => null);
  incomingList.forEach((p, i) => {
    if (!p.from) return;
    const m = localList.find((l) => l.from === p.from && !used.has(l));
    if (m) { used.add(m); out[i] = m; }
  });
  incomingList.forEach((p, i) => {
    if (out[i] || !(legacy || !p.from)) return;
    const m = localList[i];
    if (m && !m.from && !used.has(m)) { used.add(m); out[i] = m; }
  });
  return out;
}

export function mergePlan(local, incoming) {
  const lweeks = Array.isArray(local.weeks) ? local.weeks : [];
  const mw = matchParts(lweeks, incoming.weeks);
  const weeks = incoming.weeks.map((w, i) => {
    const lw = mw[i];
    const ldays = Array.isArray(lw?.days) ? lw.days : [];
    const md = matchParts(ldays, w.days);
    return {
      ...structuredClone({ ...w, days: [] }),
      id: lw?.id ?? w.id,
      days: w.days.map((d, j) => ({ ...structuredClone(d), id: md[j]?.id ?? d.id })),
    };
  });
  const out = { ...structuredClone({ ...incoming, weeks: [] }), id: local.id, weeks };
  if (local.asg) out.asg = { ...(incoming.asg ?? local.asg), id: local.asg.id };
  else delete out.asg;
  return out;
}

// True when the coach has changed the plan since he saved it. A different plan under the same
// assignment is a new plan, not an update (it's offered as incoming instead).
export function needsUpdate(local, a) {
  if (!local?.asg || !a?.plan) return false;
  return local.asg.plan === a.plan.id && a.plan.at > local.asg.at;
}
