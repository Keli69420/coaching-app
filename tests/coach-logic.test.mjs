import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTier, limitsFor, countPlans, planBlock, limitText, groupBlock } from "../coach-logic.js";
import { newPlan, copyPlan } from "../plans.js";

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
