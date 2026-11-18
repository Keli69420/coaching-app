import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKg, cleanKg, setsOf, better, bestSet, fmtKg, fmtSet, setKg, lastKg } from "../weight.js";
import {
  LOGIC_V, parsePlan, sessionsOf, emptyState, cleanState, setValue, startSession, finishSession, reopenSession, stopSession,
  exerciseStats, sessionSummary, ladderState, stepHistory, hasValues,
} from "../logic.js";
import { activitySnapshot, cleanSnapshot } from "../share-logic.js";

const PLAN = parsePlan(`
# Ladder
- Pull-ups: 5

# Plan A: test
## Week 1
### Legs
- Squat: 3 x 8
- Plank: 2 x 30s
### Pull
- Pull-ups: 3 x 5
## Week 2
### Legs
- Squat: 3 x 8
### Pull
- Pull-ups: 3 x 5
`);
const [legs1, pull1, legs2, pull2] = sessionsOf(PLAN.plans[0]);

test("the plan used here reads cleanly, and logic.js says which log shape it knows", () => {
  assert.deepEqual(PLAN.errors, []);
  assert.equal(LOGIC_V, 2);
});

test("weights as typed", () => {
  assert.equal(parseKg("60"), 60);
  assert.equal(parseKg("62,5"), 62.5);
  assert.equal(parseKg("62.5"), 62.5);
  assert.equal(parseKg(" 61.25 kg "), 61.25);
  assert.equal(parseKg("+10"), 10);
  assert.equal(parseKg("-20"), -20);
  assert.equal(parseKg("61.3"), 61.25, "rounded to the nearest plate, 0.25");
  assert.equal(parseKg("0"), null, "nothing added is bodyweight");
  assert.equal(parseKg(""), null);
  assert.equal(parseKg("abc"), null);
  assert.equal(parseKg("1e3"), null);
  assert.equal(parseKg("501"), null);
  assert.equal(parseKg("-201"), null);
  assert.equal(parseKg("6 0"), null);
});

test("heavier wins; at the same weight, more reps", () => {
  assert.ok(better({ v: 3, kg: 60 }, { v: 8, kg: 50 }));
  assert.ok(better({ v: 9, kg: 50 }, { v: 8, kg: 50 }));
  assert.ok(!better({ v: 8, kg: 50 }, { v: 8, kg: 50 }), "a tie isn't better");
  assert.ok(better({ v: 1, kg: null }, { v: 10, kg: -20 }), "one clean rep beats ten with a band");
  assert.ok(better({ v: 8, kg: null }, { v: 7, kg: null }), "with no weights it's reps, as before");
  assert.deepEqual(bestSet([{ v: 8, kg: 50 }, { v: 5, kg: 60 }, { v: 6, kg: 60 }]), { v: 6, kg: 60 });
  assert.equal(bestSet([]), null);
});

test("how a set reads", () => {
  assert.equal(fmtSet({ v: 8, kg: 60 }, "reps"), "60 kg × 8");
  assert.equal(fmtSet({ v: 5, kg: 62.5 }, "reps"), "62.5 kg × 5");
  assert.equal(fmtSet({ v: 20, kg: 10 }, "sec"), "10 kg × 20 s");
  assert.equal(fmtSet({ v: 6, kg: -20 }, "reps"), "−20 kg × 6");
  assert.equal(fmtSet({ v: 8, kg: null }, "reps"), "8 reps");
  assert.equal(fmtSet({ v: 20 }, "sec"), "20 s");
  assert.equal(fmtKg(-12.5), "−12.5");
});

test("a weight goes in beside its reps, and never counts as a logged set by itself", () => {
  const st = emptyState();
  setKg(st, legs1, "squat", 0, 60);
  assert.deepEqual(st.logs, {}, "nothing before the workout is started");
  startSession(st, legs1, "2026-11-10", 1000);
  setKg(st, legs1, "squat", 1, 60);
  assert.deepEqual(st.logs[legs1.key].kg, { squat: [null, 60, null] });
  assert.equal(hasValues(st.logs[legs1.key]), false);
  assert.equal(finishSession(st, legs1, 2000), false, "a weight with no reps can't be saved");
  setValue(st, legs1, "squat", 1, 8, "2026-11-10");
  assert.deepEqual(setsOf(st.logs[legs1.key], "squat"), [{ v: 8, kg: 60 }]);
  setKg(st, legs1, "squat", 1, null);
  assert.equal(st.logs[legs1.key].kg, undefined, "the last weight cleared leaves no empty shell");
});

test("weights survive saving, a reload, editing, and undoing the edit", () => {
  const st = emptyState();
  startSession(st, legs1, "2026-11-10", 1000);
  setValue(st, legs1, "squat", 0, 8, "2026-11-10");
  setKg(st, legs1, "squat", 0, 60);
  assert.ok(finishSession(st, legs1, 5000));
  const back = cleanState(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(back.logs[legs1.key].kg, { squat: [60, null, null] });
  reopenSession(back, legs1);
  setKg(back, legs1, "squat", 0, 80);
  assert.deepEqual(back.logs[legs1.key].saved.kg, { squat: [60, null, null] }, "the saved copy keeps its own weights");
  stopSession(back, legs1);
  assert.deepEqual(back.logs[legs1.key].kg, { squat: [60, null, null] });
  assert.equal(back.logs[legs1.key].done, true);
});

test("a log from before weights loads exactly as it was; junk weights are dropped", () => {
  const old = { v: 1, plan: "A", logs: { [legs1.key]: { date: "2026-11-10", vals: { squat: [8, 8, 7] }, note: "ok", done: true } }, tests: {} };
  assert.deepEqual(cleanState(old).logs, old.logs);
  assert.deepEqual(cleanKg({ a: [60, "x", 0, 9999, -20], b: "no", c: [null, null] }), { a: [60, null, null, null, -20] });
  assert.deepEqual(cleanKg(null), {});
});

test("records: the heaviest set is the record, and a heavier day is a PR even with fewer reps", () => {
  const st = emptyState();
  setValue(st, legs1, "squat", 0, 8, "2026-11-10");
  setKg({ logs: st.logs }, legs1, "squat", 0, 50);
  setValue(st, legs1, "squat", 1, 10, "2026-11-10");
  setKg({ logs: st.logs }, legs1, "squat", 1, 40);
  setValue(st, legs2, "squat", 0, 5, "2026-11-17");
  setKg({ logs: st.logs }, legs2, "squat", 0, 60);
  const all = sessionsOf(PLAN.plans[0]);
  const [squat] = exerciseStats(all, st.logs, "2026-11-18", 4);
  assert.deepEqual(squat.pr, { best: 5, kg: 60, date: "2026-11-17" });
  assert.deepEqual(squat.latest, { weeksAgo: 0, best: 5, kg: 60 });
  assert.deepEqual(squat.previous, { weeksAgo: 1, best: 8, kg: 50 });
  assert.equal(squat.trend, "up");
  assert.equal(squat.weighted, true);
  assert.deepEqual(squat.weekly, [null, null, 50, 60], "a weighted exercise's line follows the weight");
  assert.deepEqual(sessionSummary(all, st.logs, legs2), { sets: 1, records: [{ name: "Squat", unit: "reps", best: 5, kg: 60 }] });
  assert.deepEqual(sessionSummary(all, st.logs, legs1).records, [], "a first time isn't a record");
});

test("an exercise that never had a weight behaves as before", () => {
  const st = emptyState();
  setValue(st, legs1, "plank", 0, 30, "2026-11-10");
  const [plank] = exerciseStats(sessionsOf(PLAN.plans[0]), st.logs, "2026-11-11", 4);
  assert.deepEqual(plank.pr, { best: 30, date: "2026-11-10" });
  assert.equal(plank.weighted, undefined);
  assert.deepEqual(plank.weekly, [null, null, null, 30]);
});

test("the ladder counts reps, weighted or not, but never a set done with a band", () => {
  const st = emptyState();
  setValue(st, pull1, "pull-ups", 0, 6, "2026-11-10");
  startSession(st, pull1, "2026-11-10");
  setKg(st, pull1, "pull-ups", 0, -20);
  setValue(st, pull1, "pull-ups", 1, 2, "2026-11-10");
  setValue(st, pull2, "pull-ups", 0, 3, "2026-11-17");
  setKg(st, pull2, "pull-ups", 0, 10);
  const l = ladderState(PLAN.ladder, st.logs, {});
  assert.equal(l.steps[0].best, 3, "6 with a band doesn't count; 3 with 10 kg added does");
  assert.deepEqual(stepHistory(l.steps[0], st.logs, {}), [{ date: "2026-11-10", best: 2 }, { date: "2026-11-17", best: 3 }]);
});

test("the kg boxes hint at what he lifted last time", () => {
  const st = emptyState();
  const all = sessionsOf(PLAN.plans[0]);
  assert.deepEqual(lastKg(all, st.logs, "Squat", "reps", legs2.key), []);
  startSession(st, legs1, "2026-11-10");
  setValue(st, legs1, "squat", 0, 8, "2026-11-10");
  setKg(st, legs1, "squat", 0, 50);
  setKg(st, legs1, "squat", 2, 55);
  assert.deepEqual(lastKg(all, st.logs, "squat", "reps", legs2.key), [50, 50, 55], "a gap takes the weight before it");
  assert.deepEqual(lastKg(all, st.logs, "Squat", "reps", legs1.key), [], "never the workout he's in");
  assert.deepEqual(lastKg(all, st.logs, "Squat", "sec", legs2.key), []);
});

test("a shared workout's PR lines carry the weight, and only a sensible one", () => {
  const snap = activitySnapshot({ title: "Legs", date: "2026-11-17", ms: 1000, sets: 3, prs: 1 }, [{ name: "Squat", unit: "reps", best: 5, kg: 60 }, { name: "Plank", unit: "sec", best: 40 }]);
  assert.deepEqual(snap.records, [{ name: "Squat", best: 5, unit: "reps", kg: 60 }, { name: "Plank", best: 40, unit: "sec" }]);
  const odd = cleanSnapshot("activity", { title: "x", records: [{ name: "A", best: 1, kg: "60" }, { name: "B", best: 1, kg: 9999 }, { name: "C", best: 1, kg: 0 }] });
  assert.deepEqual(odd.records.map((r) => "kg" in r), [false, false, false]);
});
