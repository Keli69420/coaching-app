import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTier, limitsFor, countPlans, planBlock, limitText, groupBlock, cleanAssignment, assignedPlan, mergePlan, needsUpdate, progressSnapshot, cleanProgress } from "../coach-logic.js";
import { newPlan, copyPlan, cleanPlan, sessionsOfAny, toProgramPlan } from "../plans.js";

const built = (n) => Array.from({ length: n }, (_, i) => ({ id: `b${i}` }));
const saved = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, by: "Sam" }));

test("cleanTier is coach only for exactly 'coach'", () => {
  assert.equal(cleanTier("coach"), "coach");
  for (const j of ["Coach", "free", "", null, undefined, 5, {}, ["coach"]]) assert.equal(cleanTier(j), "free");
});

test("limits per tier", () => {
  assert.deepEqual(limitsFor("free"), { built: 1, saved: 5, total: 6, groups: 1, groupSize: 10, kind: "friends" });
  assert.deepEqual(limitsFor("coach"), { built: 100, saved: 100, total: 100, groups: 10, groupSize: 50, kind: "coaching" });
  assert.deepEqual(limitsFor("junk"), limitsFor("free"));
});

test("countPlans buckets", () => {
  const plans = [{ id: "a" }, { id: "b", by: "Sam" }, { id: "c", src: "x" }, { id: "d", by: "Sam", src: "x" }, { id: "e", asg: "g1" }, { id: "f", asg: "g1", by: "Co" }];
  assert.deepEqual(countPlans(plans), { built: 1, saved: 3, assigned: 2 });
  assert.deepEqual(countPlans(null), { built: 0, saved: 0, assigned: 0 });
  assert.deepEqual(countPlans([null, 3, "x", undefined, []]), { built: 0, saved: 0, assigned: 0 });
  assert.deepEqual(countPlans("nope"), { built: 0, saved: 0, assigned: 0 });
});

test("a duplicate of a saved plan counts as built, as p-copy makes it", () => {
  const original = { ...newPlan(), by: "Sam", src: "123e4567-e89b-12d3-a456-426614174000" };
  const dup = copyPlan(original, { title: "copy" });
  assert.equal(dup.by, undefined);
  assert.equal(dup.src, undefined);
  assert.deepEqual(countPlans([original, dup]), { built: 1, saved: 1, assigned: 0 });
});

test("free planBlock at and just under each limit", () => {
  assert.equal(planBlock("free", [], "built"), null);
  assert.equal(planBlock("free", built(1), "built"), "built");
  assert.equal(planBlock("free", saved(4), "saved"), null);
  assert.equal(planBlock("free", saved(5), "saved"), "saved");
  assert.equal(planBlock("free", saved(5), "built"), null, "saved plans don't use the built slot");
  assert.equal(planBlock("free", built(1), "saved"), null);
  assert.equal(planBlock("free", [...built(1), ...saved(5)], "saved"), "saved");
  assert.equal(planBlock("free", [...built(1), { id: "z", asg: "g" }], "saved"), null, "assigned never counts");
  assert.equal(planBlock(undefined, built(1), "built"), "built");
});

test("coach planBlock at and just under each limit", () => {
  assert.equal(planBlock("coach", built(99), "built"), null);
  assert.equal(planBlock("coach", built(100), "built"), "total");
  assert.equal(planBlock("coach", saved(99), "saved"), null);
  assert.equal(planBlock("coach", saved(100), "saved"), "total");
  assert.equal(planBlock("coach", [...built(60), ...saved(39)], "built"), null);
  assert.equal(planBlock("coach", [...built(60), ...saved(40)], "saved"), "total");
  assert.equal(planBlock("coach", [...built(99), ...Array.from({ length: 50 }, (_, i) => ({ id: `a${i}`, asg: "g" }))], "built"), null);
});

test("groupBlock", () => {
  assert.equal(groupBlock("free", 0), null);
  assert.equal(groupBlock("free", 1), "groups");
  assert.equal(groupBlock("coach", 9), null);
  assert.equal(groupBlock("coach", 10), "groups");
});

test("limitText for each code", () => {
  assert.equal(limitText("built", "free"), "Free accounts build 1 plan. Coaches can make as many as they like.");
  assert.equal(limitText("saved", "free"), "Free accounts keep 5 saved plans. Delete one to save another.");
  assert.equal(limitText("total", "coach"), "You have 100 plans, the most an account can keep. Delete one first.");
  assert.equal(limitText("groups", "free"), "Free accounts can make 1 group. Coaches can make up to 10.");
  assert.equal(limitText("groups", "coach"), "You have 10 groups, the most a coach can make.");
  assert.equal(limitText("built", "coach"), "You've reached the limit for your account.");
  assert.equal(limitText("nonsense", "free"), "You've reached the limit for your account.");
  assert.equal(limitText(undefined), "You've reached the limit for your account.");
});

/* ---------- assigned plans ---------- */

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (name) => ({ name, sets: 3, amount: 8, unit: "reps", note: "" });
const row = (over = {}, planOver = {}) => ({
  id: U(1), group_id: U(2), updated_at: "2026-11-01T00:00:00Z",
  coach: { id: U(3), name: "Coach Cam" },
  plan: { id: U(4), title: "Base block", summary: "2 weeks", updated_at: "2026-11-10T00:00:00Z",
    body: { weeks: [
      { title: "Week 1", days: [{ title: "Push", items: [item("Dip")] }, { title: "Pull", items: [item("Row")] }] },
      { title: "Week 2", days: [{ title: "Push", items: [item("Dip")] }] },
    ] }, ...planOver },
  ...over,
});
const sample = () => assignedPlan(cleanAssignment(row()));

test("cleanAssignment reads a row and rejects malformed ones", () => {
  const a = cleanAssignment(row());
  assert.equal(a.id, U(1));
  assert.equal(a.group, U(2));
  assert.equal(a.at, Date.parse("2026-11-01T00:00:00Z"));
  assert.deepEqual(a.coach, { id: U(3), name: "Coach Cam" });
  assert.equal(a.plan.id, U(4));
  assert.equal(a.plan.title, "Base block");
  assert.equal(a.plan.at, Date.parse("2026-11-10T00:00:00Z"));
  assert.equal(a.plan.body.weeks.length, 2);
  for (const bad of [null, 5, [], {}, row({ id: "x" }), row({ coach: null }), row({ coach: { id: "x", name: "A" } }), row({ plan: null }), row({}, { id: "nope" }), row({}, { body: null })]) {
    assert.equal(cleanAssignment(bad), null);
  }
  assert.equal(cleanAssignment(row({ group_id: "bad" })).group, null);
  assert.equal(cleanAssignment(row({ coach: { id: U(3), name: 7 } })).coach.name, "Coach");
  assert.equal(cleanAssignment(row({}, { title: "  a\n b  ", updated_at: "junk" })).plan.title, "a b");
  assert.equal(cleanAssignment(row({}, { updated_at: "junk" })).plan.at, 0);
});

test("assignedPlan builds a local plan with asg and the coach's name", () => {
  const p = sample();
  assert.equal(p.by, "Coach Cam");
  assert.equal(p.title, "Base block");
  assert.deepEqual(p.asg, { id: U(1), plan: U(4), at: Date.parse("2026-11-10T00:00:00Z"), coach: "Coach Cam" });
  assert.match(p.id, /^u[a-z0-9]{8}$/);
  assert.equal(p.weeks[0].days[1].items[0].name, "Row");
  assert.notEqual(sample().id, p.id, "fresh ids each time");
  assert.deepEqual(countPlans([p]), { built: 0, saved: 0, assigned: 1 });
  assert.deepEqual(cleanPlan(p).asg, p.asg, "survives a round trip through storage");
});

test("assignedPlan is null with no workout in it", () => {
  assert.equal(assignedPlan(cleanAssignment(row({}, { body: { weeks: [{ title: "W", days: [{ title: "D", items: [] }] }] } }))), null);
  assert.equal(assignedPlan(cleanAssignment(row({}, { body: {} }))), null);
  assert.equal(assignedPlan(null), null);
});

test("mergePlan keeps plan id and ids by position, so logs stay attached", () => {
  const local = sample();
  const logKey = `${local.id}|${local.weeks[0].days[1].id}`;
  const keysBefore = sessionsOfAny(toProgramPlan(local)).map((s) => s.key);
  const incoming = assignedPlan(cleanAssignment(row({}, {
    updated_at: "2026-11-15T00:00:00Z",
    body: { weeks: [
      { title: "Week 1", days: [{ title: "Push", items: [item("Dip"), item("Pike")] }, { title: "Pull!", items: [item("Row")] }] },
      { title: "Week 2", days: [{ title: "Push", items: [item("Dip")] }] },
    ] },
  })));
  const m = mergePlan(local, incoming);
  assert.equal(m.id, local.id);
  assert.equal(m.weeks[0].days[0].items.length, 2, "incoming content");
  assert.equal(m.weeks[0].days[1].title, "Pull!");
  assert.deepEqual(m.weeks.map((w) => w.id), local.weeks.map((w) => w.id));
  assert.equal(m.weeks[0].days[1].id, local.weeks[0].days[1].id);
  const keysAfter = sessionsOfAny(toProgramPlan(m)).map((s) => s.key);
  assert.deepEqual(keysAfter, keysBefore);
  assert.ok(keysAfter.includes(logKey));
  assert.deepEqual(m.asg, { ...local.asg, at: incoming.asg.at });
  assert.equal(m.asg.at, Date.parse("2026-11-15T00:00:00Z"));
});

test("mergePlan with added and removed weeks and days", () => {
  const local = sample();
  const grown = assignedPlan(cleanAssignment(row({}, { body: { weeks: [
    { title: "W1", days: [{ title: "A", items: [item("Dip")] }, { title: "B", items: [item("Row")] }, { title: "C", items: [item("Squat")] }] },
    { title: "W2", days: [{ title: "A", items: [item("Dip")] }] },
    { title: "W3", days: [{ title: "A", items: [item("Dip")] }] },
  ] } })));
  const g = mergePlan(local, grown);
  assert.equal(g.weeks.length, 3);
  assert.equal(g.weeks[0].days[2].id, grown.weeks[0].days[2].id, "new day gets incoming id");
  assert.equal(g.weeks[2].id, grown.weeks[2].id, "new week gets incoming id");
  assert.equal(g.weeks[0].days[0].id, local.weeks[0].days[0].id);
  assert.equal(g.weeks[1].days[0].id, local.weeks[1].days[0].id);
  const shrunk = assignedPlan(cleanAssignment(row({}, { body: { weeks: [
    { title: "W1", days: [{ title: "A", items: [item("Dip")] }] },
  ] } })));
  const s = mergePlan(local, shrunk);
  assert.equal(s.weeks.length, 1);
  assert.equal(s.weeks[0].days.length, 1);
  assert.equal(s.weeks[0].id, local.weeks[0].id);
  assert.equal(s.weeks[0].days[0].id, local.weeks[0].days[0].id);
});

test("mergePlan doesn't mutate its inputs", () => {
  const local = sample();
  const incoming = assignedPlan(cleanAssignment(row({}, { updated_at: "2026-11-15T00:00:00Z" })));
  const l = structuredClone(local);
  const i = structuredClone(incoming);
  const m = mergePlan(local, incoming);
  assert.deepEqual(local, l);
  assert.deepEqual(incoming, i);
  m.weeks[0].title = "changed";
  m.weeks[0].days[0].items[0].name = "changed";
  assert.deepEqual(incoming, i, "result shares nothing with incoming");
});

test("needsUpdate", () => {
  const local = sample();
  const a = cleanAssignment(row());
  assert.equal(needsUpdate(local, a), false, "same time");
  assert.equal(needsUpdate(local, cleanAssignment(row({}, { updated_at: "2026-11-11T00:00:00Z" }))), true, "newer");
  assert.equal(needsUpdate(local, cleanAssignment(row({}, { updated_at: "2026-11-01T00:00:00Z" }))), false, "older");
  assert.equal(needsUpdate(local, cleanAssignment(row({ id: U(9) }))), false, "same plan, other assignment row");
  assert.equal(needsUpdate(local, cleanAssignment(row({}, { id: U(5), updated_at: "2026-01-01T00:00:00Z" }))), false, "different plan: offered as new, not an update");
  assert.equal(needsUpdate(local, cleanAssignment(row({}, { id: U(5), updated_at: "2026-12-01T00:00:00Z" }))), false, "different plan, newer");
  assert.equal(needsUpdate({ id: "uabcdefgh" }, a), false, "not an assigned plan");
  assert.equal(needsUpdate(local, null), false);
});

const withIds = (days, over = {}) => row({}, { body: { weeks: [{ id: "wweek001", days }, ], ...over } });
const day = (id, title, name) => ({ id, title, items: [item(name)] });

test("mergePlan matches workouts by source id: one inserted at the start keeps old ids on the old days", () => {
  const local = assignedPlan(cleanAssignment(withIds([day("dpush001", "Push", "Dip"), day("dpull001", "Pull", "Row")])));
  const [pushId, pullId] = local.weeks[0].days.map((d) => d.id);
  const incoming = assignedPlan(cleanAssignment(withIds([day("dnew0001", "New", "Squat"), day("dpush001", "Push", "Dip"), day("dpull001", "Pull", "Row")])));
  const m = mergePlan(local, incoming);
  assert.equal(m.weeks[0].id, local.weeks[0].id);
  assert.equal(m.weeks[0].days[1].id, pushId);
  assert.equal(m.weeks[0].days[2].id, pullId);
  assert.ok(![pushId, pullId].includes(m.weeks[0].days[0].id), "new day gets a new id");
  assert.equal(m.weeks[0].days[0].from, "dnew0001");
});

test("mergePlan: a day the student added (no from) doesn't take a new day's id", () => {
  const local = assignedPlan(cleanAssignment(withIds([day("dpush001", "Push", "Dip")])));
  local.weeks[0].days.unshift({ id: "dmine001", title: "Mine", items: [item("Curl")] });
  const incoming = assignedPlan(cleanAssignment(withIds([day("dnew0001", "New", "Squat"), day("dpush001", "Push", "Dip")])));
  const m = mergePlan(local, incoming);
  assert.notEqual(m.weeks[0].days[0].id, "dmine001");
  assert.equal(m.weeks[0].days[1].id, local.weeks[0].days[1].id);
  assert.equal(new Set(m.weeks[0].days.map((d) => d.id)).size, 2);
});

test("mergePlan never gives one local id to two parts", () => {
  const local = assignedPlan(cleanAssignment(withIds([day("dpush001", "Push", "Dip")])));
  const incoming = assignedPlan(cleanAssignment(withIds([day("dpush001", "Push", "Dip"), day("dpush001", "Push again", "Dip")])));
  const m = mergePlan(local, incoming);
  assert.equal(m.weeks[0].days[0].id, local.weeks[0].days[0].id);
  assert.notEqual(m.weeks[0].days[1].id, m.weeks[0].days[0].id);
});

test("mergePlan with an old body (no ids, no from) still merges by position", () => {
  const local = sample();
  assert.equal(local.weeks[0].from, undefined);
  const incoming = sample();
  const m = mergePlan(local, incoming);
  assert.deepEqual(m.weeks.map((w) => w.id), local.weeks.map((w) => w.id));
  assert.equal(m.weeks[0].days[1].id, local.weeks[0].days[1].id);
});

test("mergePlan migrates a copy saved before ids were kept (no from) by position", () => {
  const local = assignedPlan(cleanAssignment(withIds([day("dpush001", "Push", "Dip"), day("dpull001", "Pull", "Row")])));
  for (const w of local.weeks) { delete w.from; for (const d of w.days) delete d.from; }
  const incoming = assignedPlan(cleanAssignment(withIds([day("dpush001", "Push", "Dip"), day("dpull001", "Pull", "Row")])));
  const m = mergePlan(local, incoming);
  assert.equal(m.weeks[0].id, local.weeks[0].id);
  assert.deepEqual(m.weeks[0].days.map((d) => d.id), local.weeks[0].days.map((d) => d.id));
  assert.equal(m.weeks[0].days[0].from, "dpush001");
});

test("assignedPlan sets from on weeks and days", () => {
  const p = assignedPlan(cleanAssignment(withIds([day("dpush001", "Push", "Dip")])));
  assert.equal(p.weeks[0].from, "wweek001");
  assert.equal(p.weeks[0].days[0].from, "dpush001");
  assert.notEqual(p.weeks[0].id, "wweek001");
});

test("re-assigning a different plan under the same assignment id is not an update; the old plan is untouched", () => {
  const local = sample();
  const snapshot = structuredClone(local);
  const again = cleanAssignment(row({}, { id: U(7), updated_at: "2027-01-01T00:00:00Z" }));
  assert.equal(again.id, local.asg.id);
  assert.equal(needsUpdate(local, again), false);
  const fresh = assignedPlan(again);
  assert.notEqual(fresh.id, local.id, "a new local plan");
  assert.equal(fresh.asg.plan, U(7));
  assert.deepEqual(local, snapshot);
});

test("mergePlan keeps the local assignment id, takes plan and at from incoming", () => {
  const local = sample();
  const incoming = assignedPlan(cleanAssignment(row({ id: U(9) }, { updated_at: "2026-11-15T00:00:00Z" })));
  const m = mergePlan(local, incoming);
  assert.equal(m.asg.id, local.asg.id);
  assert.equal(m.asg.plan, incoming.asg.plan);
  assert.equal(m.asg.at, incoming.asg.at);
});

/* ---------- progress snapshot ---------- */

const mkSession = (key, day, items, extra = {}) => ({ key, day, week: "W1", weekNotes: ["week note"], notes: ["day note SECRET-DAY"], items, ...extra });
const mkItem = (key, name, unit = "reps", n = 3) => ({ key, name, unit, note: "item note SECRET-ITEM", sets: Array.from({ length: n }, () => ({ min: 5, max: 8 })) });

test("progressSnapshot carries numbers and names, never a note", () => {
  const sessions = [
    mkSession("a", "Push", [mkItem("i1", "Push-up"), mkItem("i2", "Plank", "sec", 2), mkItem("i3", "Dip")], { plan: "Plan A" }),
    mkSession("b", "Pull", [mkItem("j1", "Row")]),
  ];
  const logs = {
    a: { date: "2026-11-17", done: true, ms: 3600000, note: "SECRET-LOG felt sick", vals: { i1: [10, null, 12], i2: [30, 40], i3: [null, null, null] }, kg: { i1: [null, null, 10] } },
    b: { date: "2026-11-10", saved: true, vals: { j1: [8, 8, 8] }, kg: { j1: [40, 40, 40] }, note: "SECRET-LOG2" },
  };
  const snap = progressSnapshot(sessions, logs, "2026-11-18");
  const json = JSON.stringify(snap);
  assert.ok(!/SECRET/.test(json) && !json.includes("note") && !json.includes("felt sick"));
  assert.equal(snap.v, 1);
  assert.equal(snap.weeks.length, 8);
  assert.deepEqual(snap.weeks.at(-1), { ago: 0, workouts: 1, sets: 4 });
  assert.deepEqual(snap.weeks.at(-2), { ago: 1, workouts: 1, sets: 3 });
  assert.deepEqual(snap.workouts.map((w) => w.date), ["2026-11-17", "2026-11-10"]);
  const w0 = snap.workouts[0];
  assert.equal(w0.day, "Push");
  assert.equal(w0.plan, "Plan A");
  assert.equal(w0.ms, 3600000);
  assert.deepEqual(w0.items.map((i) => i.name), ["Push-up", "Plank"]);
  assert.deepEqual(w0.items[0].sets, [{ v: 10 }, { v: 12, kg: 10 }]);
  assert.equal(w0.items[1].unit, "sec");
  assert.equal(snap.workouts[1].plan, undefined);
  assert.deepEqual(snap.workouts[1].items[0].sets, [{ v: 8, kg: 40 }, { v: 8, kg: 40 }, { v: 8, kg: 40 }]);
});

test("progressSnapshot skips unsaved workouts and caps strings", () => {
  const long = "x".repeat(100);
  const sessions = [mkSession("a", long, [mkItem("i1", long)], { plan: long }), mkSession("b", "Draft", [mkItem("j1", "Row")])];
  const logs = { a: { date: "2026-11-17", saved: true, vals: { i1: [5] } }, b: { date: "2026-11-18", vals: { j1: [5] } } };
  const snap = progressSnapshot(sessions, logs, "2026-11-18");
  assert.equal(snap.workouts.length, 1);
  assert.equal(snap.workouts[0].day.length, 40);
  assert.equal(snap.workouts[0].plan.length, 40);
  assert.equal(snap.workouts[0].items[0].name.length, 40);
  assert.deepEqual(progressSnapshot([], {}, "2026-11-18").workouts, []);
});

test("progressSnapshot ignores a workout still in progress everywhere", () => {
  const sessions = [mkSession("a", "Push", [mkItem("i1", "Push-up")]), mkSession("b", "Pull", [mkItem("j1", "Row")])];
  const base = { a: { date: "2026-11-17", done: true, vals: { i1: [10, 10] } } };
  const before = progressSnapshot(sessions, base, "2026-11-18");
  const after = progressSnapshot(sessions, { ...base, b: { date: "2026-11-18", vals: { j1: [8, 8, 8] }, kg: { j1: [50, 50, 50] } } }, "2026-11-18");
  assert.deepEqual(after, before);
});

test("progressSnapshot keeps the newest 60 workouts and stays small", () => {
  const sessions = [];
  const logs = {};
  for (let i = 0; i < 80; i++) {
    const items = Array.from({ length: 12 }, (_, k) => mkItem(`i${k}`, `Exercise number ${k} with a long name`, "reps", 6));
    sessions.push(mkSession(`s${i}`, `Day ${i}`, items));
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    logs[`s${i}`] = { date: d, done: true, note: "n".repeat(500), vals: Object.fromEntries(items.map((it) => [it.key, [10, 11, 12, 13, 14, 15]])), kg: Object.fromEntries(items.map((it) => [it.key, [80, 80, 82.5, 82.5, 85, 85]])) };
  }
  const snap = progressSnapshot(sessions, logs, "2026-11-18");
  assert.equal(snap.workouts.length, 60);
  assert.equal(snap.workouts[0].day, "Day 79");
  assert.equal(snap.workouts[59].day, "Day 20");
  for (let i = 1; i < 60; i++) assert.ok(snap.workouts[i - 1].date > snap.workouts[i].date);
  assert.ok(JSON.stringify(snap).length < 200 * 1024);
  assert.ok(!JSON.stringify(snap).includes("nnnn"));
});

test("progressSnapshot records are all-time bests, weighted when weight was used", () => {
  const sessions = [mkSession("a", "A", [mkItem("i1", "Squat"), mkItem("i2", "Push-up")]), mkSession("b", "B", [mkItem("j1", "Squat"), mkItem("j2", "Push-up")])];
  const logs = {
    a: { date: "2025-01-05", saved: true, vals: { i1: [5], i2: [20] }, kg: { i1: [100] } },
    b: { date: "2026-11-17", saved: true, vals: { j1: [8], j2: [25] }, kg: { j1: [80] } },
  };
  const rec = progressSnapshot(sessions, logs, "2026-11-18").records;
  assert.deepEqual(rec.find((r) => r.name === "Squat"), { name: "Squat", unit: "reps", best: 5, kg: 100 });
  assert.deepEqual(rec.find((r) => r.name === "Push-up"), { name: "Push-up", unit: "reps", best: 25 });
});

test("cleanProgress keeps good data and drops junk", () => {
  const good = progressSnapshot([mkSession("a", "Push", [mkItem("i1", "Push-up")])], { a: { date: "2026-11-17", done: true, vals: { i1: [10] }, kg: { i1: [5] } } }, "2026-11-18");
  assert.deepEqual(cleanProgress(JSON.parse(JSON.stringify(good))), good);
  for (const j of [null, undefined, 5, "x", [], {}, { v: 2 }]) assert.equal(cleanProgress(j), null);
  const dirty = {
    v: 1, evil: "x", note: "no",
    weeks: [{ ago: 0, workouts: 1, sets: 2, note: "x" }, { ago: "a", workouts: 1, sets: 1 }, null, { ago: 1, workouts: NaN, sets: 1 }],
    workouts: [
      { date: "bad", day: "x", items: [{ name: "a", unit: "reps", sets: [{ v: 1 }] }] },
      { date: "2026-11-17", day: "D", note: "secret", items: [{ name: "Row", unit: "reps", note: "s", sets: [{ v: 8, kg: 20, x: 1 }, { v: "8" }, { v: Infinity }, null] }, { name: "", unit: "reps", sets: [{ v: 1 }] }, { name: "Bad unit", unit: "km", sets: [{ v: 1 }] }, { name: "Empty", unit: "reps", sets: [] }] },
      { date: "2026-11-16", day: "Empty", items: [] },
      7,
    ],
    records: [{ name: "Row", unit: "reps", best: 8, kg: 20, extra: 1 }, { name: "Row", unit: "reps", best: "x" }, { name: "Z", unit: "sec", best: -1 }, "no"],
  };
  const c = cleanProgress(dirty);
  assert.deepEqual(c.weeks, [{ ago: 0, workouts: 1, sets: 2 }]);
  assert.deepEqual(c.workouts, [{ date: "2026-11-17", day: "D", items: [{ name: "Row", unit: "reps", sets: [{ v: 8, kg: 20 }] }] }]);
  assert.deepEqual(c.records, [{ name: "Row", unit: "reps", best: 8, kg: 20 }]);
  assert.deepEqual(Object.keys(c).sort(), ["records", "v", "weeks", "workouts"]);
  const huge = { v: 1, workouts: Array.from({ length: 500 }, () => ({ date: "2026-11-17", day: "D", items: [{ name: "R", unit: "reps", sets: [{ v: 1 }] }] })) };
  assert.equal(cleanProgress(huge).workouts.length, 60);
});

test("progressSnapshot stays under the server's 200 KB even at every cap", () => {
  const sessions = [];
  const logs = {};
  for (let d = 0; d < 60; d++) {
    const items = Array.from({ length: 25 }, (_, i) => mkItem(`k${i}`, `Exercise number ${i} with a long name xx`, "reps", 12));
    sessions.push(mkSession(`s${d}`, `Workout ${d}`, items, { plan: "A plan with a long title here" }));
    const vals = {};
    const kg = {};
    for (let i = 0; i < 25; i++) { vals[`k${i}`] = Array(12).fill(10); kg[`k${i}`] = Array(12).fill(102.5); }
    logs[`s${d}`] = { date: new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10), vals, kg, done: true, ms: 3600000 };
  }
  const snap = progressSnapshot(sessions, logs, "2026-03-15");
  assert.ok(new TextEncoder().encode(JSON.stringify(snap)).length <= 200000);
  assert.ok(snap.workouts.length > 0 && snap.workouts.length < 60);
  assert.equal(snap.workouts[0].date, "2026-03-01"); // the newest are the ones kept
});
