// Reads a plan file the way the app will, and says what it found.
//   node tools/check_plan.mjs plans/muscle-up.md
// Exits with an error if the app couldn't use it, so run it before every push.
import { readFileSync } from "node:fs";
import { parsePlan, sessionsOf, fmtPrescription } from "../logic.js";

const file = process.argv[2] || new URL("../plans/muscle-up.md", import.meta.url).pathname;
const p = parsePlan(readFileSync(file, "utf8"));

console.log(`Ladder: ${p.ladder.map((s) => `${s.name} ${s.target}${s.unit === "sec" ? " s" : ""}`).join(" → ") || "none"}`);
for (const plan of p.plans) {
  const list = sessionsOf(plan);
  console.log(`\nPlan ${plan.id}${plan.title ? `: ${plan.title}` : ""} — ${plan.weeks.length} week${plan.weeks.length === 1 ? "" : "s"}, ${list.length} session${list.length === 1 ? "" : "s"}`);
  for (const s of list) {
    console.log(`  ${s.week} · ${s.day}`);
    for (const it of s.items) console.log(`    ${it.name}${it.sets.length ? `  ${fmtPrescription(it)}` : "  (reminder)"}${it.note ? `  | ${it.note}` : ""}`);
  }
}
const named = new Set(p.ladder.map((s) => s.name.toLowerCase()));
const used = new Set(p.plans.flatMap((pl) => sessionsOf(pl).flatMap((s) => s.items.map((it) => it.name.toLowerCase()))));
for (const n of named) if (!used.has(n)) p.warnings.push({ line: 0, msg: `no session has an exercise called exactly "${n}", so only tests move that step` });

for (const w of p.warnings) console.log(`\nnote${w.line ? ` line ${w.line}` : ""}: ${w.msg}`);
if (p.errors.length) {
  console.error(`\n${p.errors.length} problem${p.errors.length === 1 ? "" : "s"}:`);
  for (const e of p.errors) console.error(`  ${e.line ? `line ${e.line}: ` : ""}${e.msg}`);
  process.exit(1);
}
console.log("\nOK: the app can read this.");
