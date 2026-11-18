import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTier, limitsFor, countPlans, planBlock, limitText, groupBlock, cleanAssignment, assignedPlan, mergePlan, needsUpdate } from "../coach-logic.js";
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
