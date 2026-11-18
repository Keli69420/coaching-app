import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS, newPlanId, cleanItem, cleanPlan, cleanPlans, newPlan, addWeek, copyWeek, addDay, addItem, removeWeek, removeDay, removeItem,
  setItemField, findDay, copyPlan, fromProgramPlan, checkPlan, planSummary, fmtItem, toProgramPlan, sessionsOfAny,
} from "../plans.js";
import { parsePlan, sessionsOf, emptyState, setValue, exerciseStats, ladderState, sessionComplete, fmtPrescription, currentIndex } from "../logic.js";

// A steady stand-in for Math.random, so ids are the same on every run.
const seeded = () => { let n = 0; return () => ((n = (n * 9301 + 49297) % 233280) / 233280); };

function sample(rand = seeded()) {
  const p = newPlan(rand);
  p.title = "Gym plan";
  const d1 = p.weeks[0].days[0];
  addItem(p, d1.id); setItemField(p, d1.id, 0, "name", "Squat"); setItemField(p, d1.id, 0, "sets", "4"); setItemField(p, d1.id, 0, "amount", "6");
  addItem(p, d1.id); setItemField(p, d1.id, 1, "name", "Plank"); setItemField(p, d1.id, 1, "unit", "sec"); setItemField(p, d1.id, 1, "amount", "30");
  const d2 = addDay(p, p.weeks[0].id, rand);
  addItem(p, d2.id); setItemField(p, d2.id, 0, "name", "Pull-ups"); setItemField(p, d2.id, 0, "amount", "");
  return p;
}

test("a new plan starts with one week and one empty workout, and can't be used yet", () => {
  const p = newPlan(seeded());
  assert.match(p.id, /^u[a-z0-9]{8}$/);
  assert.equal(p.weeks.length, 1);
  assert.equal(p.weeks[0].days.length, 1);
  assert.match(checkPlan(p), /at least one exercise/);
  assert.equal(planSummary(p), "No workouts yet");
  assert.deepEqual(toProgramPlan(p).weeks, []);
});

test("building a plan: exercises as typed, with sensible limits", () => {
  const p = sample();
  const [d1, d2] = p.weeks[0].days;
  assert.deepEqual(d1.items[0], { name: "Squat", sets: 4, amount: 6, unit: "reps", note: "" });
  assert.deepEqual(d1.items[1], { name: "Plank", sets: 3, amount: 30, unit: "sec", note: "" });
  assert.equal(d2.items[0].amount, null, "an empty amount means as many as he can");
  setItemField(p, d1.id, 0, "sets", "99");
  setItemField(p, d1.id, 0, "sets", "abc");
  setItemField(p, d1.id, 0, "amount", "0");
  assert.equal(d1.items[0].sets, 4, "a number that makes no sense leaves what was there");
  assert.equal(d1.items[0].amount, 6);
  setItemField(p, d1.id, 0, "name", "x".repeat(100));
  assert.equal(d1.items[0].name.length, LIMITS.name);
  assert.equal(checkPlan(p), "");
  assert.equal(planSummary(p), "1 week · 2 workouts");
  assert.equal(fmtItem(d1.items[1]), "3 × 30 s");
  assert.equal(fmtItem(d2.items[0]), "3 × max");
});

test("weeks: add, copy with ids of their own, remove; and the plan fills up", () => {
  const rand = seeded();
  const p = sample(rand);
  const w2 = copyWeek(p, p.weeks[0].id, rand);
  assert.equal(w2.title, "Week 2");
  assert.deepEqual(w2.days.map((d) => d.title), ["Workout 1", "Workout 2"]);
  assert.notEqual(w2.days[0].id, p.weeks[0].days[0].id);
  w2.days[0].items[0].amount = 8;
  assert.equal(p.weeks[0].days[0].items[0].amount, 6, "the copy's numbers are its own");
  assert.equal(planSummary(p), "2 weeks · 2 workouts a week");
  addWeek(p, rand);
  assert.equal(planSummary(p), "2 weeks · 2 workouts a week", "an empty week doesn't count");
  removeWeek(p, p.weeks[2].id);
  removeDay(p, w2.days[1].id);
  assert.equal(planSummary(p), "2 weeks · 3 workouts");
  removeItem(p, w2.days[0].id, 1);
  assert.equal(w2.days[0].items.length, 1);
  while (addWeek(p, rand));
  assert.equal(p.weeks.length, LIMITS.weeks);
  const d = p.weeks[0].days[0];
  while (addItem(p, d.id));
  assert.equal(d.items.length, LIMITS.items);
  while (addDay(p, p.weeks[0].id, rand));
  assert.equal(p.weeks[0].days.length, LIMITS.days);
});

test("it works as a plan: the same shape as the coach's file, so workouts log and count", () => {
  const p = sample();
  const prog = toProgramPlan(p);
  assert.equal(prog.own, true);
  const ss = sessionsOfAny(prog);
  assert.deepEqual(ss.map((s) => s.day), ["Workout 1", "Workout 2"]);
  assert.equal(ss[0].key, `${p.id}|${p.weeks[0].days[0].id}`);
  assert.deepEqual(ss[0].items.map(fmtPrescription), ["4 × 6", "3 × 30 s"]);
  assert.equal(fmtPrescription(ss[1].items[0]), "3 × max");
  const st = emptyState();
  for (let j = 0; j < 4; j++) setValue(st, ss[0], "squat", j, 6, "2026-11-18");
  for (let j = 0; j < 3; j++) setValue(st, ss[0], "plank", j, 30, "2026-11-18");
  assert.ok(sessionComplete(ss[0], st.logs[ss[0].key]));
  assert.equal(currentIndex(ss, st.logs, "2026-11-19"), 1);
  setValue(st, ss[1], "pull-ups", 0, 7, "2026-11-19");
  assert.equal(exerciseStats(ss, st.logs, "2026-11-19", 4).length, 3);
  assert.equal(ladderState([{ name: "Pull-ups", target: 5, unit: "reps" }], st.logs, {}).steps[0].best, 7, "the ladder counts his own plan's sets too");
});

test("renaming a week or workout keeps what he logged; the same exercise twice gets two slots", () => {
  const p = sample();
  const before = sessionsOfAny(toProgramPlan(p)).map((s) => s.key);
  p.weeks[0].title = "Base week";
  p.weeks[0].days[0].title = "Legs";
  const d1 = p.weeks[0].days[0];
  addItem(p, d1.id); setItemField(p, d1.id, 2, "name", "squat");
  const after = sessionsOfAny(toProgramPlan(p));
  assert.deepEqual(after.map((s) => s.key), before);
  assert.equal(after[0].day, "Legs");
  assert.deepEqual(after[0].items.map((it) => it.key), ["squat", "plank", "squat#2"]);
});

test("the coach's plans still key by week and day title", () => {
  const file = parsePlan("# Plan A: x\n## Week 1\n### Legs\n- Squat: 3 x 8\n");
  assert.deepEqual(sessionsOfAny(file.plans[0]), sessionsOf(file.plans[0]));
  assert.deepEqual(sessionsOfAny(null), []);
});

test("the coach's plan can be copied into one of his own", () => {
  const file = parsePlan("# Plan A: under 6 pull-ups\n## Week 1\n### Pull\n- Pull-ups: 5 x 1 | from straight arms\n- Rows: 3 x 8-12\n- Hang: 2 x max s\n- Ladder: 5, 4, 3\n- Stretch after\n");
  const p = fromProgramPlan(file.plans[0], { rand: seeded() });
  assert.equal(p.title, "Plan A: under 6 pull-ups");
  assert.deepEqual(p.weeks[0].days[0].items, [
    { name: "Pull-ups", sets: 5, amount: 1, unit: "reps", note: "from straight arms" },
    { name: "Rows", sets: 3, amount: 8, unit: "reps", note: "" },
    { name: "Hang", sets: 2, amount: null, unit: "sec", note: "" },
    { name: "Ladder", sets: 3, amount: 5, unit: "reps", note: "" },
  ], "a reminder with no sets is left out");
});

test("a copy has ids of its own and remembers who made it", () => {
  const p = sample();
  const c = copyPlan(p, { by: "  Ann  ", src: "5396e118-b43e-405d-a9b1-40a9dc01360a" });
  assert.notEqual(c.id, p.id);
  assert.notEqual(c.weeks[0].id, p.weeks[0].id);
  assert.equal(c.by, "Ann");
  assert.equal(c.src, "5396e118-b43e-405d-a9b1-40a9dc01360a");
  assert.deepEqual(c.weeks[0].days[0].items, p.weeks[0].days[0].items);
  const plain = copyPlan(c, { title: "Gym plan copy" });
  assert.equal(plain.by, undefined, "his own duplicate is his");
  assert.equal(plain.title, "Gym plan copy");
});

test("what's saved is read defensively", () => {
  const p = sample();
  const round = cleanPlans(JSON.parse(JSON.stringify({ v: 1, plans: [p] })));
  assert.deepEqual(round.plans[0], p, "a good plan comes back as it was");
  assert.deepEqual(cleanPlans(null), { v: 1, plans: [] });
  assert.deepEqual(cleanPlans({ plans: "x" }).plans, []);
  const odd = cleanPlan({ id: "A", title: "  <b>Hi</b>\u0007  ", weeks: [
    { id: "wsame01", title: "", days: [{ id: "dsame01", title: 5, items: [{ name: "  Dips  ", sets: 99, amount: -3, unit: "kg", note: 7 }, { name: "" }, "x", null] }, "x"] },
    { id: "wsame01", days: "no" }, 7,
  ] });
  assert.match(odd.id, /^u[a-z0-9]{8}$/, "an id that isn't one of ours is replaced");
  assert.equal(odd.title, "<b>Hi</b>", "text is kept as text; the page escapes it when drawing");
  assert.equal(odd.weeks.length, 2);
  assert.equal(odd.weeks[0].title, "Week 1");
  assert.notEqual(odd.weeks[0].id, odd.weeks[1].id, "two parts never share an id");
  assert.deepEqual(odd.weeks[0].days[0], { id: "dsame01", title: "Workout 1", items: [{ name: "Dips", sets: 3, amount: null, unit: "reps", note: "" }] });
  assert.equal(cleanPlan({ title: "x" }), null);
  assert.equal(cleanPlan("x"), null);
  assert.equal(cleanItem({ name: "   " }), null);
  const many = cleanPlans({ plans: Array.from({ length: 40 }, () => sample(Math.random)) });
  assert.equal(many.plans.length, LIMITS.plans);
  const twins = cleanPlans({ plans: [p, p] });
  assert.equal(twins.plans.length, 1);
  assert.match(newPlanId(seeded()), /^u[a-z0-9]{8}$/);
  assert.equal(findDay(p, "nope"), null);
});
