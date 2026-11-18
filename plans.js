// His own plans (Keli, 18 Nov): plans made in the app, or copied from the coach's or someone else's.
// Pure parts, tested in tests/plans.test.mjs. The pages are in planpages.js.
//
// A plan here:
//   { id, title, by?, src?, weeks: [{ id, title, days: [{ id, title, items: [item] }] }] }
//   item: { name, sets (1–10), amount (a number, or null for "as many as he can"), unit ("reps"|"sec"), note }
// `by` is who made it when it's a copy of someone's shared plan, `src` that plan's id on the server.
//
// Weeks and workouts have ids of their own, and logs hang on those ids, so renaming one never
// detaches what he logged. Exercises stay keyed by name, like in the coach's file: the ladder
// counts sets by exercise name.

import { keyOf, sessionsOf } from "./logic.js";

export const LIMITS = { plans: 30, weeks: 12, days: 7, items: 15, sets: 10, amount: 999, title: 40, name: 40, note: 80 };

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID = /^[a-z][a-z0-9]{6,12}$/;
const rid = (lead, n, rand) => lead + Array.from({ length: n }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("");
// "u…" for a plan: the coach's plans are "A", "B"…, so the two can never collide.
export const newPlanId = (rand = Math.random) => rid("u", 8, rand);
const newPartId = (lead, rand) => rid(lead, 6, rand);

const text = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const whole = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/* ---------- reading: from this phone's storage, or from the server ---------- */

// One exercise, cut down to what the app can draw. No name: no exercise.
export function cleanItem(raw) {
  if (!isObj(raw)) return null;
  const name = text(raw.name, LIMITS.name);
  if (!name) return null;
  return {
    name,
    sets: whole(raw.sets, 1, LIMITS.sets) ?? 3,
    amount: whole(raw.amount, 1, LIMITS.amount),
    unit: raw.unit === "sec" ? "sec" : "reps",
    note: text(raw.note, LIMITS.note),
  };
}

// A whole plan. `fresh` gives every part a new id: for a copy, or a plan that came from someone else,
// whose ids mean nothing here. Returns null when there's nothing plan-like in it.
export function cleanPlan(raw, { fresh = false, rand = Math.random } = {}) {
  if (!isObj(raw) || !Array.isArray(raw.weeks)) return null;
  const used = new Set();
  const idOf = (given, lead) => {
    let id = !fresh && typeof given === "string" && ID.test(given) && !used.has(given) ? given : null;
    while (!id || used.has(id)) id = newPartId(lead, rand);
    used.add(id);
    return id;
  };
  const plan = {
    id: !fresh && typeof raw.id === "string" && /^u[a-z0-9]{8}$/.test(raw.id) ? raw.id : newPlanId(rand),
    title: text(raw.title, LIMITS.title) || "My plan",
    weeks: raw.weeks.filter(isObj).slice(0, LIMITS.weeks).map((w, i) => ({
      id: idOf(w.id, "w"),
      title: text(w.title, LIMITS.title) || `Week ${i + 1}`,
      days: (Array.isArray(w.days) ? w.days : []).filter(isObj).slice(0, LIMITS.days).map((d, j) => ({
        id: idOf(d.id, "d"),
        title: text(d.title, LIMITS.title) || `Workout ${j + 1}`,
        items: (Array.isArray(d.items) ? d.items : []).map(cleanItem).filter(Boolean).slice(0, LIMITS.items),
      })),
    })),
  };
  const by = text(raw.by, LIMITS.name);
  if (by) plan.by = by;
  if (typeof raw.src === "string" && /^[0-9a-f-]{36}$/i.test(raw.src)) plan.src = raw.src;
  return plan;
}

// Everything under coach.plans. Whatever is unreadable is left out; two plans never share an id.
export function cleanPlans(raw) {
  const out = { v: 1, plans: [] };
  const list = isObj(raw) && Array.isArray(raw.plans) ? raw.plans : [];
  const seen = new Set();
  for (const r of list) {
    const p = cleanPlan(r);
    if (!p || seen.has(p.id) || out.plans.length >= LIMITS.plans) continue;
    seen.add(p.id);
    out.plans.push(p);
  }
  return out;
}

/* ---------- making and changing ---------- */

export function newPlan(rand = Math.random) {
  return {
    id: newPlanId(rand),
    title: "My plan",
    weeks: [{ id: newPartId("w", rand), title: "Week 1", days: [{ id: newPartId("d", rand), title: "Workout 1", items: [] }] }],
  };
}

export const newItem = () => ({ name: "", sets: 3, amount: 8, unit: "reps", note: "" });

export const findWeek = (plan, weekId) => plan.weeks.find((w) => w.id === weekId) ?? null;
export function findDay(plan, dayId) {
  for (const w of plan.weeks) {
    const d = w.days.find((x) => x.id === dayId);
    if (d) return d;
  }
  return null;
}

// Each returns what it added, or null when the plan is full there.
export function addWeek(plan, rand = Math.random) {
  if (plan.weeks.length >= LIMITS.weeks) return null;
  const week = { id: newPartId("w", rand), title: `Week ${plan.weeks.length + 1}`, days: [{ id: newPartId("d", rand), title: "Workout 1", items: [] }] };
  plan.weeks.push(week);
  return week;
}

// The same workouts again, as the next week: how most plans grow ("copy a week, change the numbers").
export function copyWeek(plan, weekId, rand = Math.random) {
  const from = findWeek(plan, weekId);
  if (!from || plan.weeks.length >= LIMITS.weeks) return null;
  const week = {
    id: newPartId("w", rand),
    title: `Week ${plan.weeks.length + 1}`,
    days: from.days.map((d) => ({ id: newPartId("d", rand), title: d.title, items: d.items.map((it) => ({ ...it })) })),
  };
  plan.weeks.push(week);
  return week;
}

export function addDay(plan, weekId, rand = Math.random) {
  const week = findWeek(plan, weekId);
  if (!week || week.days.length >= LIMITS.days) return null;
  const day = { id: newPartId("d", rand), title: `Workout ${week.days.length + 1}`, items: [] };
  week.days.push(day);
  return day;
}

export function addItem(plan, dayId) {
  const day = findDay(plan, dayId);
  if (!day || day.items.length >= LIMITS.items) return null;
  const item = newItem();
  day.items.push(item);
  return item;
}

export function removeWeek(plan, weekId) {
  plan.weeks = plan.weeks.filter((w) => w.id !== weekId);
}
export function removeDay(plan, dayId) {
  for (const w of plan.weeks) w.days = w.days.filter((d) => d.id !== dayId);
}
export function removeItem(plan, dayId, index) {
  findDay(plan, dayId)?.items.splice(index, 1);
}

// One field of one exercise, as typed. Names and notes are kept as typed while he's typing
// (so a space isn't eaten mid-word) and tidied when the plan is read back.
export function setItemField(plan, dayId, index, field, value) {
  const it = findDay(plan, dayId)?.items[index];
  if (!it) return;
  if (field === "name") it.name = String(value).slice(0, LIMITS.name);
  else if (field === "note") it.note = String(value).slice(0, LIMITS.note);
  else if (field === "unit") it.unit = value === "sec" ? "sec" : "reps";
  else if (field === "sets") it.sets = whole(Number(String(value).trim()), 1, LIMITS.sets) ?? it.sets;
  else if (field === "amount") {
    const t = String(value).trim();
    it.amount = t === "" ? null : whole(Number(t), 1, LIMITS.amount) ?? it.amount;
  }
}

// A copy with ids of its own, for "Duplicate" and for a plan saved from someone else.
export function copyPlan(plan, { title, by, src, rand = Math.random } = {}) {
  const copy = cleanPlan({ ...plan, title: title ?? plan.title }, { fresh: true, rand });
  delete copy.by;
  delete copy.src;
  if (by) copy.by = text(by, LIMITS.name);
  if (src) copy.src = src;
  return copy;
}

// The coach's plan (as parsePlan() returns it) as one of his own, so he can change it.
// A range like 5–8 becomes its lower end, and a set-by-set goal like "5, 4, 3" its first number.
export function fromProgramPlan(p, { title, rand = Math.random } = {}) {
  return cleanPlan({
    title: title ?? (p.title ? `Plan ${p.id}: ${p.title}` : `Plan ${p.id}`),
    weeks: p.weeks.map((w) => ({
      title: w.title,
      days: w.days.map((d) => ({
        title: d.title,
        items: d.items.filter((it) => it.sets.length).map((it) => ({
          name: it.name, sets: Math.min(it.sets.length, LIMITS.sets), amount: it.sets[0].min, unit: it.unit, note: it.note,
        })),
      })),
    })),
  }, { fresh: true, rand });
}

/* ---------- reading a plan's shape ---------- */

const usable = (it) => Boolean(text(it.name, LIMITS.name));
const filledDays = (plan) => plan.weeks.flatMap((w) => w.days).filter((d) => d.items.some(usable));

// What's still missing before the plan can be used or shared, or "".
export function checkPlan(plan) {
  if (!filledDays(plan).length) return "Add a workout with at least one exercise.";
  return "";
}

// "4 weeks · 3 workouts a week", "1 week · 2 workouts", "3 weeks · 8 workouts" when they differ.
export function planSummary(plan) {
  const weeks = plan.weeks.map((w) => w.days.filter((d) => d.items.some(usable)).length).filter(Boolean);
  if (!weeks.length) return "No workouts yet";
  const total = weeks.reduce((a, b) => a + b, 0);
  const w = `${weeks.length} ${weeks.length === 1 ? "week" : "weeks"}`;
  if (weeks.length > 1 && weeks.every((n) => n === weeks[0])) return `${w} · ${weeks[0]} ${weeks[0] === 1 ? "workout" : "workouts"} a week`;
  return `${w} · ${total} ${total === 1 ? "workout" : "workouts"}`;
}

// "3 × 8", "3 × 20 s", "3 × max"
export function fmtItem(it) {
  const each = it.amount == null ? (it.unit === "sec" ? "max s" : "max") : it.unit === "sec" ? `${it.amount} s` : `${it.amount}`;
  return `${it.sets} × ${each}`;
}

// The same shape parsePlan() gives for the coach's file, so everything that draws or counts a
// workout works on his own plans unchanged. Empty workouts and weeks are left out; `own` marks it.
export function toProgramPlan(plan) {
  const weeks = [];
  for (const w of plan.weeks) {
    const days = [];
    for (const d of w.days) {
      const seen = {};
      const items = d.items.filter(usable).map((raw) => {
        const it = cleanItem(raw);
        const k = keyOf(it.name);
        seen[k] = (seen[k] || 0) + 1;
        return {
          name: it.name, note: it.note, unit: it.unit,
          sets: Array.from({ length: it.sets }, () => ({ min: it.amount, max: it.amount })),
          key: seen[k] === 1 ? k : `${k}#${seen[k]}`,
        };
      });
      if (items.length) days.push({ id: d.id, title: text(d.title, LIMITS.title) || "Workout", notes: [], items });
    }
    if (days.length) weeks.push({ id: w.id, title: text(w.title, LIMITS.title) || "Week", notes: [], days });
  }
  return { id: plan.id, title: text(plan.title, LIMITS.title) || "My plan", own: true, notes: [], weeks };
}

// A plan's workouts as one list, in order. His own plans are keyed by the workout's id; the
// coach's by week and day title, as always (sessionsOf() in logic.js).
export function sessionsOfAny(plan) {
  if (!plan) return [];
  if (!plan.own) return sessionsOf(plan);
  const out = [];
  for (const w of plan.weeks) for (const d of w.days) {
    out.push({ key: `${plan.id}|${d.id}`, week: w.title, weekId: w.id, day: d.title, weekNotes: [], notes: [], items: d.items });
  }
  return out;
}
