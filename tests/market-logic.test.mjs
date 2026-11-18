import { test } from "node:test";
import assert from "node:assert/strict";
import { planUpload, uploadError, cleanShared, sharedPlan, searchTerm, BODY_MAX } from "../market-logic.js";
import { newPlan, addItem, addDay, setItemField, cleanPlan, cleanPlans, copyPlan, toProgramPlan, sessionsOfAny, LIMITS } from "../plans.js";
import { cleanPost, refusal } from "../share-logic.js";

const ID = "5396e118-b43e-405d-a9b1-40a9dc01360a";
const ID2 = "177696e8-8be0-47ef-8a5c-8fa3e0192aa7";

function sample() {
  const p = newPlan();
  p.title = "  Gym basics ";
  const d = p.weeks[0].days[0];
  addItem(p, d.id); setItemField(p, d.id, 0, "name", "Squat"); setItemField(p, d.id, 0, "note", "deep");
  addItem(p, d.id); // left without a name
  addDay(p, p.weeks[0].id); // left empty
  return p;
}

test("a plan goes up with what's needed to use it, and nothing from this phone", () => {
  const p = sample();
  p.by = "Ann"; p.src = ID; p.pub = ID2;
  const { row } = planUpload(p);
  assert.deepEqual(row, {
    title: "Gym basics",
    summary: "1 week · 1 workout",
    body: { weeks: [{ title: "Week 1", days: [{ title: "Workout 1", items: [{ name: "Squat", sets: 3, amount: 8, unit: "reps", note: "deep" }] }] }] },
  });
  const text = JSON.stringify(row);
  for (const secret of [p.id, p.weeks[0].id, ID, ID2, "Ann"]) assert.ok(!text.includes(secret), `${secret} went up`);
});

test("an empty plan or a huge one doesn't go up, and says why", () => {
  assert.deepEqual(planUpload(newPlan()), { error: "empty" });
  assert.deepEqual(planUpload(null), { error: "empty" });
  const big = newPlan();
  big.weeks = Array.from({ length: LIMITS.weeks }, (_, w) => ({ id: `w${w}aaaaa`, title: `Week ${w}`, days: Array.from({ length: LIMITS.days }, (_, d) => ({
    id: `d${w}x${d}aaa`, title: "Workout", items: Array.from({ length: LIMITS.items }, (_, i) => ({ name: `Exercise ${i} ${"x".repeat(28)}`, sets: 3, amount: 8, unit: "reps", note: "n".repeat(80) })),
  })) }));
  assert.deepEqual(planUpload(big), { error: "big" });
  assert.match(uploadError("big"), /too big/);
  assert.match(uploadError("empty"), /at least one exercise/);
  assert.ok(BODY_MAX < 60000, "under what the server takes");
});

test("a marketplace row is read field by field", () => {
  const r = cleanShared({ id: ID, title: "  Push\u0007Pull  ", summary: 5, listed: true, created_at: "2026-11-18T10:00:00Z", updated_at: "nope",
    author: { id: ID2, name: " Ann " }, body: { weeks: [] }, sneaky: "<script>" });
  assert.deepEqual(r, { id: ID, title: "Push Pull", summary: "", listed: true, at: Date.parse("2026-11-18T10:00:00Z"), updatedAt: 0, author: { id: ID2, name: "Ann" } });
  assert.equal(cleanShared({ id: "x" }), null);
  assert.equal(cleanShared(null), null);
  assert.equal(cleanShared({ id: ID, author: null }).author, null);
  assert.equal(cleanShared({ id: ID, listed: "yes" }).listed, false);
});

test("someone's plan becomes one of his own, with their name and new ids", () => {
  const { row } = planUpload(sample());
  const mine = sharedPlan({ id: ID, ...row, author: { id: ID2, name: "Ann" }, created_at: "2026-11-18T10:00:00Z" });
  assert.equal(mine.title, "Gym basics");
  assert.equal(mine.by, "Ann");
  assert.equal(mine.src, ID);
  assert.equal(mine.pub, undefined, "a saved copy isn't shared by him");
  assert.match(mine.id, /^u[a-z0-9]{8}$/);
  assert.deepEqual(sessionsOfAny(toProgramPlan(mine)).map((s) => s.day), ["Workout 1"]);
  assert.equal(sharedPlan({ id: ID, title: "x", body: { weeks: [] } }), null, "nothing to do in it");
  assert.equal(sharedPlan({ id: ID, title: "x", body: "weeks" }), null);
  const odd = sharedPlan({ id: ID, title: "<b>x</b>", body: { weeks: [{ title: 7, days: [{ items: [{ name: "Dips", sets: 500, amount: "9", unit: "kg" }, { name: "" }] }] }] } });
  assert.deepEqual(odd.weeks[0].days[0].items, [{ name: "Dips", sets: 3, amount: null, unit: "reps", note: "" }]);
});

test("his own plan remembers its shared copy; a copy of it starts unshared", () => {
  const p = sample();
  Object.assign(p, { pub: ID, listed: true, stale: true });
  const back = cleanPlans(JSON.parse(JSON.stringify({ plans: [p] }))).plans[0];
  assert.equal(back.pub, ID);
  assert.equal(back.listed, true);
  assert.equal(back.stale, true);
  const copy = copyPlan(p, { title: "copy" });
  assert.equal(copy.pub, undefined);
  assert.equal(copy.listed, undefined);
  assert.equal(cleanPlan({ ...p, pub: "nope", listed: true }).listed, undefined, "no shared copy, no flags");
});

test("a search is cut down to words", () => {
  assert.equal(searchTerm("  push   pull "), "push pull");
  assert.equal(searchTerm("a*b,c(d).e%f"), "a b c d e f");
  assert.equal(searchTerm("Kraft-Übung's"), "Kraft-Übung's");
  assert.equal(searchTerm("x".repeat(99)).length, 40);
  assert.equal(searchTerm(null), "");
});

test("a plan in a post: needs its plan, and reads like the other posts", () => {
  const raw = { id: ID, kind: "plan", audience: "group", group_id: ID2, plan_id: ID2, caption: "try this", created_at: "2026-11-18T10:00:00Z",
    snapshot: { title: "Gym basics", summary: "1 week · 1 workout", extra: 1 }, author: { id: ID2, name: "Ann" } };
  const p = cleanPost(raw);
  assert.equal(p.kind, "plan");
  assert.equal(p.planId, ID2);
  assert.deepEqual(p.snap, { title: "Gym basics", summary: "1 week · 1 workout" });
  assert.equal(cleanPost({ ...raw, plan_id: null }), null);
  assert.equal(cleanPost({ ...raw, kind: "activity" }).planId, null);
  assert.match(refusal({ message: "too many plans" }), /30 shared plans/);
  assert.match(refusal({ message: "too many plans today" }), /tomorrow/);
});
