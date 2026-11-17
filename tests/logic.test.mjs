import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseTarget, parsePrescription, parsePlan, sessionsOf, currentIndex, planDone, sessionComplete,
  hit, fmtPrescription, ladderState, stepHistory, parseNum, emptyState, cleanState, setValue, setNote, setTest, keyOf, hasValues,
  weekStart, weeksAgo, weeksAgoLabel, weeklyTotals, exerciseStats, sparkPoints, fmtVal, fmtDate,
  startSession, finishSession, reopenSession, stopSession, deleteSession, tidyLogs, sessionSummary,
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
  assert.match(parsePrescription("3 x 8kg"), /can't read/);
  assert.match(parsePrescription("21 x 5"), /between 1 and 20/);
  assert.match(parsePrescription("5, 20s"), /mixes/);
  assert.match(parsePrescription("3 x ?"), /can't read/);
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
  assert.deepEqual(p.errors, [{ line: 10, msg: 'Pull-ups: can\'t read "?"' }, { line: 9, msg: '"Day 1" in Plan A has no exercises' }]);
});

test("the errors Keli is likely to make are caught with a line number", () => {
  const cases = [
    ["# Plan A\n- Pull-ups: 3 x 8", "under a ### day"],
    ["# Plan A\n### Day 1", "under a ## week"],
    ["## Week 1", "under a # Plan"],
    ["# Planner", 'has to be "# Ladder"'],
    ["# Ladder\n- Pull-ups: ?\n# Plan A\n## W\n### D\n- X: 1 x 1", "a ladder step is"],
    ["# Ladder\n- Pull-ups: 5-8\n# Plan A\n## W\n### D\n- X: 1 x 1", "one number, not a range"],
    ["# Ladder\nPull-ups 10\n# Plan A\n## W\n### D\n- X: 1 x 1", "under # Ladder"],
    ["# Plan A\n## W\n### D\n- X: 1 x 1\n# Plan A\n## W\n### D\n- X: 1 x 1", "Plan A twice"],
    ["# Plan A\n## W\n### D\n- X: 1 x 1\n### D\n- X: 1 x 1", "is in W twice"],
    ["# Plan A\n## W\n### D\n- : 3 x 8", "needs a name"],
    ["# Plan A\n## W\n### D\n#### Warm-up\n- X: 1 x 1", "#, ## and ###"],
    ["# Plan A\n## W", "has no days"],
    ["- X: 1 x 1", "no # Plan"],
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
  startSession(state, s[0], "2026-11-14");
  setValue(state, s[0], "pull-ups", 0, 6, "2026-11-14");
  setValue(state, s[0], "pull-ups", 0, null, "2026-11-14");
  assert.ok(state.logs[s[0].key], "a started session stays while he's in it, even emptied");
  setNote(state, s[0], "elbow sore", "2026-11-14");
  assert.equal(hasValues(state.logs[s[0].key]), false);
  assert.equal(currentIndex(s, state.logs, "2026-11-15"), 0);
});

test("start, save, edit, stop: same flow as Yapp", () => {
  const s = plan();
  const state = emptyState();
  startSession(state, s[1], "2026-11-14");
  assert.deepEqual(state.logs[s[1].key], { date: "2026-11-14", vals: {}, note: "" });
  assert.equal(currentIndex(s, state.logs, "2026-11-14"), 1, "a session started today opens, even empty");
  assert.equal(finishSession(state, s[1]), false, "nothing to save yet");
  setValue(state, s[1], "pull-ups", 0, 5, "2026-11-14");
  assert.equal(finishSession(state, s[1]), true);
  assert.equal(state.logs[s[1].key].done, true);
  reopenSession(state, s[1]);
  assert.equal(state.logs[s[1].key].done, false);
  setValue(state, s[1], "pull-ups", 0, 9, "2026-11-14");
  stopSession(state, s[1]);
  assert.equal(state.logs[s[1].key].vals["pull-ups"][0], 5, "stopping an edit puts the saved numbers back");
  assert.equal(state.logs[s[1].key].done, true);
  assert.equal(state.logs[s[1].key].saved, undefined);
  startSession(state, s[2], "2026-11-14");
  stopSession(state, s[2]);
  assert.equal(state.logs[s[2].key], undefined, "stopping a new session throws it away");
  deleteSession(state, s[1]);
  assert.deepEqual(state.logs, {});
});

test("tidy: an empty start from an earlier day goes, an emptied edit falls back to the save", () => {
  const s = plan();
  const state = emptyState();
  startSession(state, s[0], "2026-11-13");
  startSession(state, s[1], "2026-11-14");
  startSession(state, s[2], "2026-11-14");
  setValue(state, s[2], "pull-ups", 0, 4, "2026-11-14");
  finishSession(state, s[2]);
  reopenSession(state, s[2]);
  setValue(state, s[2], "pull-ups", 0, null, "2026-11-14");
  tidyLogs(state, "2026-11-14");
  assert.equal(state.logs[s[0].key], undefined);
  assert.ok(state.logs[s[1].key], "today's empty start stays");
  assert.equal(state.logs[s[2].key].vals["pull-ups"][0], 4);
  assert.equal(state.logs[s[2].key].done, true);
});

test("saved state keeps done and the copy under edit", () => {
  const s = cleanState({ logs: { a: { date: "2026-11-14", vals: { x: [1] }, note: "", done: true }, b: { date: "2026-11-14", vals: {}, note: "", saved: { date: "2026-11-13", vals: { x: [2] }, note: "n" } } } });
  assert.equal(s.logs.a.done, true);
  assert.deepEqual(s.logs.b.saved, { date: "2026-11-13", vals: { x: [2] }, note: "n" });
  assert.equal(cleanState({ logs: { a: { date: "x", vals: {}, done: "yes" } } }).logs.a.done, undefined);
});

test("saved card: sets typed, records only when an earlier day is beaten", () => {
  const ss = sessionsOf(TWO_DAYS.plans[0]);
  const st = emptyState();
  startSession(st, ss[0], "2026-11-10");
  setValue(st, ss[0], "liegestütze", 0, 6, "2026-11-10");
  setValue(st, ss[0], "halten", 0, 20, "2026-11-10");
  startSession(st, ss[1], "2026-11-12");
  setValue(st, ss[1], "liegestütze", 0, 8, "2026-11-12");
  setValue(st, ss[1], "liegestütze", 1, 7, "2026-11-12");
  assert.deepEqual(sessionSummary(ss, st.logs, ss[0]), { sets: 2, records: [] }, "a first time isn't a record");
  assert.deepEqual(sessionSummary(ss, st.logs, ss[1]), { sets: 2, records: [{ name: "Liegestütze", unit: "reps", best: 8 }] });
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

/* ---------- the Progress tab ---------- */

const TWO_DAYS = parsePlan(`# Plan A: test
## Woche 1
### Tag 1
- Liegestütze: 3 x 6
- Halten: 2 x 20s
- Aufwärmen
### Tag 2
- Liegestütze: 2 x 8
- Liegestütze: 1 x max
`);

test("weeks run Monday to Sunday", () => {
  assert.equal(weekStart("2026-11-16"), "2026-11-16"); // Monday
  assert.equal(weekStart("2026-11-22"), "2026-11-16"); // Sunday
  assert.equal(weeksAgo("2026-11-15", "2026-11-16"), 1);
  assert.equal(weeksAgo("2026-11-16", "2026-11-22"), 0);
  assert.equal(weeksAgo("2026-12-30", "2027-01-04"), 1); // across new year
  assert.deepEqual([0, 1, 3].map(weeksAgoLabel), ["this week", "last week", "3 weeks ago"]);
  assert.equal(fmtVal(20, "sec"), "20 s");
  assert.equal(fmtVal(6, "reps"), "6 reps");
  assert.equal(fmtDate("2026-11-07"), "7 Nov");
  assert.equal(fmtDate("2027-01-14"), "14 Jan");
});

test("weekly totals count trainings with a number in them, and their filled sets", () => {
  const st = emptyState();
  const [d1, d2] = sessionsOf(TWO_DAYS.plans[0]);
  setValue(st, d1, "liegestütze", 0, 6, "2026-11-10");
  setValue(st, d1, "liegestütze", 1, 5, "2026-11-10");
  setNote(st, d2, "nur eine Notiz", "2026-11-17"); // no numbers: not a training
  const totals = weeklyTotals(st.logs, "2026-11-18", 4);
  assert.equal(totals.length, 4);
  assert.deepEqual(totals.map((t) => t.weeksAgo), [3, 2, 1, 0]);
  assert.deepEqual(totals[2], { weeksAgo: 1, sessions: 1, sets: 2 });
  assert.deepEqual(totals[3], { weeksAgo: 0, sessions: 0, sets: 0 });
});

test("exercise cards: one per name and unit, record, this week against the last, newest first", () => {
  const st = emptyState();
  const [d1, d2] = sessionsOf(TWO_DAYS.plans[0]);
  setValue(st, d1, "liegestütze", 0, 7, "2026-11-10");
  setValue(st, d1, "halten", 0, 25, "2026-11-10");
  setValue(st, d2, "liegestütze", 0, 6, "2026-11-17");
  setValue(st, d2, "liegestütze#2", 0, 7, "2026-11-17"); // same name twice in a day: one card
  const stats = exerciseStats(sessionsOf(TWO_DAYS.plans[0]), st.logs, "2026-11-18", 8);
  assert.deepEqual(stats.map((s) => s.name), ["Liegestütze", "Halten"]);
  const pu = stats[0];
  assert.equal(pu.unit, "reps");
  assert.deepEqual(pu.pr, { best: 7, date: "2026-11-10" }); // a tie keeps the first day
  assert.deepEqual(pu.latest, { weeksAgo: 0, best: 7 });
  assert.deepEqual(pu.previous, { weeksAgo: 1, best: 7 });
  assert.equal(pu.trend, "same");
  assert.deepEqual(pu.weekly, [null, null, null, null, null, null, 7, 7]);
  assert.equal(stats[1].unit, "sec");
  assert.equal(stats[1].previous, null);
  assert.equal(stats[1].trend, null);
});

test("exercise cards skip reminders and exercises with nothing typed", () => {
  const st = emptyState();
  const [d1] = sessionsOf(TWO_DAYS.plans[0]);
  setNote(st, d1, "müde", "2026-11-10");
  assert.deepEqual(exerciseStats(sessionsOf(TWO_DAYS.plans[0]), st.logs, "2026-11-18"), []);
});

test("spark points: highest at the top, empty weeks skipped", () => {
  assert.deepEqual(sparkPoints([null, null], 100, 50, 10), []);
  const pts = sparkPoints([4, null, 8], 100, 50, 10);
  assert.deepEqual(pts, [{ i: 0, x: 10, y: 40 }, { i: 2, x: 90, y: 10 }]);
  assert.deepEqual(sparkPoints([5, 5], 100, 50, 10).map((p) => p.y), [25, 25]);
});
