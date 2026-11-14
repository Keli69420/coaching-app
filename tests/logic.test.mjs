import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseTarget, parsePrescription, parsePlan, sessionsOf, currentIndex, planDone, sessionComplete,
  hit, fmtPrescription, ladderState, stepHistory, parseNum, emptyState, cleanState, setValue, setNote, setTest, keyOf, hasValues,
} from "../logic.js";

const DEMO = readFileSync(new URL("./fixtures/demo.md", import.meta.url), "utf8");

test("targets", () => {
  assert.deepEqual(parseTarget("8"), { min: 8, max: 8, unit: "reps" });
  assert.deepEqual(parseTarget("5-8"), { min: 5, max: 8, unit: "reps" });
  assert.deepEqual(parseTarget("5 – 8 reps"), { min: 5, max: 8, unit: "reps" });
  assert.deepEqual(parseTarget("20s"), { min: 20, max: 20, unit: "sec" });
  assert.deepEqual(parseTarget("20 sec"), { min: 20, max: 20, unit: "sec" });
  assert.deepEqual(parseTarget("max"), { min: null, max: null, unit: "reps" });
  assert.deepEqual(parseTarget("Max s"), { min: null, max: null, unit: "sec" });
  assert.deepEqual(parseTarget("30 Sek"), { min: 30, max: 30, unit: "sec" });
  assert.deepEqual(parseTarget("max Sekunden"), { min: null, max: null, unit: "sec" });
  assert.deepEqual(parseTarget("8-10 Wdh"), { min: 8, max: 10, unit: "reps" });
  for (const bad of ["", "0", "8kg", "8-5", "?", "abc", "max kg", "3x8"]) assert.equal(parseTarget(bad), null, bad);
});

test("prescriptions", () => {
  assert.deepEqual(parsePrescription("3 x 8"), { unit: "reps", sets: [{ min: 8, max: 8 }, { min: 8, max: 8 }, { min: 8, max: 8 }] });
  assert.deepEqual(parsePrescription("2×20s").sets.length, 2);
  assert.equal(parsePrescription("2×20s").unit, "sec");
  assert.equal(parsePrescription("3X max").sets[0].min, null);
  assert.deepEqual(parsePrescription("5, 4, 3").sets.map((s) => s.min), [5, 4, 3]);
  assert.deepEqual(parsePrescription("20s / 15s").sets.map((s) => s.min), [20, 15]);
  assert.match(parsePrescription("3 x 8kg"), /nicht lesen/);
  assert.match(parsePrescription("21 x 5"), /zwischen 1 und 20/);
  assert.match(parsePrescription("5, 20s"), /mischt/);
  assert.match(parsePrescription("3 x ?"), /nicht lesen/);
});

test("the demo file reads without errors", () => {
  const p = parsePlan(DEMO);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.ladder.map((s) => [s.name, s.target, s.unit]), [["Pull-ups", 10, "reps"], ["Chest-to-bar", 5, "reps"], ["Muscle-up", 1, "reps"]]);
  assert.deepEqual(p.plans.map((x) => [x.id, x.title]), [["A", "demo level one"], ["B", "demo level two"], ["C", ""]]);
  const a = p.plans[0];
  assert.deepEqual(a.notes, ["Demo plan note."]);
  assert.deepEqual(a.weeks[0].notes, ["Demo week note."]);
  const d1 = a.weeks[0].days[0];
  assert.deepEqual(d1.notes, ["Demo day note."]);
  assert.deepEqual(d1.items.map((it) => [it.name, it.unit, it.sets.length, it.note]), [
    ["Demo reminder", null, 0, ""], ["Pull-ups", "reps", 3, "demo note"], ["Demo hold", "sec", 3, ""], ["Demo range", "reps", 2, ""],
  ]);
  assert.equal(p.warnings.length, 1, "the reminder is flagged once");
  assert.deepEqual(a.weeks[1].days[0].items.map((it) => it.key), ["pull-ups", "pull-ups#2"]);
});

test("comments and front matter keep line numbers right", () => {
  const p = parsePlan("---\na: 1\n---\n%%\nx\n%%\n# Plan A\n## Week 1\n### Day 1\n- Pull-ups: 3 x ?\n");
  assert.deepEqual(p.errors, [{ line: 10, msg: 'Pull-ups: kann "?" nicht lesen' }, { line: 9, msg: '"Day 1" in Plan A hat keine Übungen' }]);
});

test("the errors Keli is likely to make are caught with a line number", () => {
  const cases = [
    ["# Plan A\n- Pull-ups: 3 x 8", "unter einem ### Tag"],
    ["# Plan A\n### Day 1", "unter einer ## Woche"],
    ["## Week 1", "unter einem # Plan"],
    ["# Planner", 'muss "# Ladder"'],
    ["# Ladder\n- Pull-ups: ?\n# Plan A\n## W\n### D\n- X: 1 x 1", "Stufe der Leiter heisst"],
    ["# Ladder\n- Pull-ups: 5-8\n# Plan A\n## W\n### D\n- X: 1 x 1", "eine Zahl, keinen Bereich"],
    ["# Ladder\nPull-ups 10\n# Plan A\n## W\n### D\n- X: 1 x 1", "unter # Ladder"],
    ["# Plan A\n## W\n### D\n- X: 1 x 1\n# Plan A\n## W\n### D\n- X: 1 x 1", "zweimal Plan A"],
    ["# Plan A\n## W\n### D\n- X: 1 x 1\n### D\n- X: 1 x 1", "kommt in W zweimal vor"],
    ["# Plan A\n## W\n### D\n- : 3 x 8", "braucht einen Namen"],
    ["# Plan A\n## W\n### D\n#### Warm-up\n- X: 1 x 1", "#, ## und ###"],
    ["# Plan A\n## W", "keine Tage"],
    ["- X: 1 x 1", "kein # Plan"],
  ];
  for (const [text, want] of cases) {
    const { errors } = parsePlan(text);
    assert.ok(errors.some((e) => e.msg.includes(want)), `${JSON.stringify(text)} → ${JSON.stringify(errors)}`);
  }
});

test("sessions run in order and keep a stable key", () => {
  const p = parsePlan(DEMO);
  const s = sessionsOf(p.plans[0]);
  assert.deepEqual(s.map((x) => x.key), ["A|week 1|day 1", "A|week 1|day 2", "A|week 2|day 1"]);
  assert.deepEqual(sessionsOf(null), []);
});

const plan = () => sessionsOf(parsePlan(DEMO).plans[0]);
const log = (date, vals = { "pull-ups": [5] }) => ({ date, vals, note: "" });

test("opens on the first session with nothing logged", () => {
  assert.equal(currentIndex(plan(), {}, "2026-11-14"), 0);
});

test("opens on today's session while he is in it, the next one after that day", () => {
  const s = plan();
  const logs = { [s[0].key]: log("2026-11-14") };
  assert.equal(currentIndex(s, logs, "2026-11-14"), 0);
  assert.equal(currentIndex(s, logs, "2026-11-15"), 1);
});

test("a skipped day doesn't pin the app to it", () => {
  const s = plan();
  const logs = { [s[0].key]: log("2026-11-14"), [s[2].key]: log("2026-11-16") };
  assert.equal(currentIndex(s, logs, "2026-11-18"), 2, "after the last one it stays on the last");
  assert.equal(planDone(s, logs, "2026-11-18"), true);
  assert.equal(planDone(s, logs, "2026-11-16"), false, "not done on the day he does the last session");
});

test("fixing an old session today doesn't make it today's", () => {
  const s = plan();
  const state = emptyState();
  setValue(state, s[0], "pull-ups", 0, 6, "2026-11-14");
  setValue(state, s[0], "pull-ups", 1, 5, "2026-11-15");
  assert.equal(state.logs[s[0].key].date, "2026-11-14");
  assert.deepEqual(state.logs[s[0].key].vals["pull-ups"], [6, 5, null]);
  assert.equal(currentIndex(s, state.logs, "2026-11-15"), 1);
});

test("a session with only blank fields or a note doesn't count as done", () => {
  const s = plan();
  const state = emptyState();
  setValue(state, s[0], "pull-ups", 0, 6, "2026-11-14");
  setValue(state, s[0], "pull-ups", 0, null, "2026-11-14");
  assert.equal(state.logs[s[0].key], undefined, "emptied log is removed");
  setNote(state, s[0], "elbow sore", "2026-11-14");
  assert.equal(hasValues(state.logs[s[0].key]), false);
  assert.equal(currentIndex(s, state.logs, "2026-11-15"), 0);
  setNote(state, s[0], "", "2026-11-14");
  assert.equal(state.logs[s[0].key], undefined);
});

test("complete means every field filled; reminders don't count", () => {
  const s = plan()[0];
  const full = { date: "x", vals: { "pull-ups": [5, 4, 3], "demo hold": [20, 20, 15], "demo range": [5, 6] }, note: "" };
  assert.equal(sessionComplete(s, full), true);
  full.vals["demo range"] = [5, null];
  assert.equal(sessionComplete(s, full), false);
  assert.equal(sessionComplete(s, undefined), false);
});

test("hit: at least the bottom of the range, anything for max", () => {
  assert.equal(hit({ min: 8, max: 8 }, 8), true);
  assert.equal(hit({ min: 8, max: 8 }, 7), false);
  assert.equal(hit({ min: 5, max: 8 }, 5), true);
  assert.equal(hit({ min: null, max: null }, 1), true);
  assert.equal(hit({ min: null, max: null }, null), false);
});

test("prescriptions print the way a coach writes them", () => {
  const d = parsePlan(DEMO).plans[0].weeks;
  assert.deepEqual(d[0].days[0].items.map(fmtPrescription), ["", "3 × max", "3 × 20 s", "2 × 5–8"]);
  assert.deepEqual(d[0].days[1].items.map(fmtPrescription), ["5, 4, 3", "20 s, 15 s"]);
});

test("ladder: best of tests and logged sets with the step's exact name", () => {
  const { ladder } = parsePlan(DEMO);
  const logs = {
    "A|week 1|day 1": { date: "2026-11-14", vals: { "pull-ups": [6, 7, 5], "demo hold": [99] }, note: "" },
    "A|week 2|day 1": { date: "2026-11-20", vals: { "pull-ups#2": [7] }, note: "" },
    "B|week 1|day 1": { date: "2026-11-21", vals: { "chest-to-bar": [2] }, note: "" },
  };
  const tests = { "pull-ups": { "2026-11-13": 6 }, "chest-to-bar": { "2026-11-13": 3 } };
  const l = ladderState(ladder, logs, tests);
  assert.deepEqual(l.steps.map((s) => [s.best, s.date, s.done]), [[7, "2026-11-14", false], [3, "2026-11-13", false], [null, null, false]]);
  assert.equal(l.steps[0].share, 0.7);
  assert.equal(l.current, 0);
  assert.equal(l.finished, false);
  const done = ladderState(ladder, logs, { "pull-ups": { a: 10 }, "chest-to-bar": { a: 5 }, "muscle-up": { a: 1 } });
  assert.equal(done.finished, true);
  assert.equal(done.current, -1);
  assert.equal(ladderState(ladder, {}, {}).steps[0].share, 0);
});

test("tests: one per step per day, blank removes it", () => {
  const s = emptyState();
  setTest(s, "pull-ups", 7, "2026-11-14");
  setTest(s, "pull-ups", 8, "2026-11-14");
  assert.deepEqual(s.tests, { "pull-ups": { "2026-11-14": 8 } });
  setTest(s, "pull-ups", null, "2026-11-14");
  assert.deepEqual(s.tests, {});
});

test("numbers: whole numbers only", () => {
  assert.equal(parseNum("8"), 8);
  assert.equal(parseNum(" 12 "), 12);
  for (const bad of ["", "8.5", "8,5", "-1", "x", "12345"]) assert.equal(parseNum(bad), null, bad);
});

test("saved state is read defensively", () => {
  assert.deepEqual(cleanState(null), emptyState());
  assert.deepEqual(cleanState({ plan: 3, logs: { a: null, b: { date: 1, vals: { x: [1, "2", null] } } }, tests: { t: { d: "x", e: 4 } } }), {
    v: 1, plan: null, logs: { b: { date: null, vals: { x: [1, null, null] }, note: "" } }, tests: { t: { e: 4 } },
  });
});

test("names match without caring about capitals or spaces", () => {
  assert.equal(keyOf("  Chest-to-Bar "), "chest-to-bar");
  assert.equal(keyOf("Muscle  up"), "muscle up");
});

test("trend: one point per day, best of tests and sets, oldest first", () => {
  const step = { name: "Pull-ups", target: 10, unit: "reps" };
  const logs = {
    a: { date: "2026-11-21", vals: { "pull-ups": [6, 8], "chest-to-bar": [9] }, note: "" },
    b: { date: "2026-11-14", vals: { "pull-ups#2": [5] }, note: "" },
    c: { date: null, vals: { "pull-ups": [12] }, note: "" },
  };
  const tests = { "pull-ups": { "2026-11-14": 7, "2026-11-21": 7 } };
  assert.deepEqual(stepHistory(step, logs, tests), [{ date: "2026-11-14", best: 7 }, { date: "2026-11-21", best: 8 }]);
  assert.deepEqual(stepHistory(step, {}, {}), []);
});

test("max in seconds says so", () => {
  const it = parsePlan("# Plan A\n## W\n### D\n- Dead hang: 2 x max s\n").plans[0].weeks[0].days[0].items[0];
  assert.equal(fmtPrescription(it), "2 × max s");
});
