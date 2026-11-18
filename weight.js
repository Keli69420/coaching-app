// Weight on a set (Keli, 18 Nov): every set can carry a weight in kg next to its reps or seconds.
// Pure parts, tested in tests/weight.test.mjs. A file of its own for the same reason as picture.js.
//
// Where it lives: each log has `kg: { itemKey: [number|null, …] }` beside `vals`, same positions.
// No kg (or none typed) means bodyweight. A minus weight is help: a band taking 20 kg off.

export const KG_MIN = -200;
export const KG_MAX = 500;

const okKg = (n) => Number.isFinite(n) && n !== 0 && n >= KG_MIN && n <= KG_MAX;

// "60", "62,5", "62.5", "+10", "-20", "60 kg" → a number rounded to 0.25, or null.
// Zero is bodyweight, so it's null too.
export function parseKg(text) {
  const m = String(text ?? "").trim().replace(/\s*kg$/i, "").replace(",", ".").match(/^([+-]?)(\d{1,3}(?:\.\d{1,2})?)$/);
  if (!m) return null;
  const n = Math.round(Number(m[2]) * 4) / 4 * (m[1] === "-" ? -1 : 1);
  return okKg(n) ? n : null;
}

// What was saved, read defensively: only arrays of sensible numbers survive.
export function cleanKg(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, arr] of Object.entries(raw)) {
    if (!Array.isArray(arr)) continue;
    const clean = arr.map((v) => (okKg(v) ? v : null));
    if (clean.some((v) => v != null)) out[k] = clean;
  }
  return out;
}

// The sets of one exercise in one log that have a number typed: [{ v, kg }].
export function setsOf(log, itemKey) {
  const vals = log?.vals?.[itemKey] || [];
  const kgs = log?.kg?.[itemKey] || [];
  const out = [];
  vals.forEach((v, j) => { if (v != null) out.push({ v, kg: kgs[j] ?? null }); });
  return out;
}

// Does set a beat set b? Heavier wins; at the same weight, more reps (or seconds) wins.
export const better = (a, b) => {
  const ka = a.kg || 0;
  const kb = b.kg || 0;
  return ka > kb || (ka === kb && a.v > b.v);
};

export const bestSet = (sets) => sets.reduce((top, s) => (top && !better(s, top) ? top : s), null);

// "60", "62.5", "−20"
export const fmtKg = (kg) => `${kg < 0 ? "−" : ""}${String(Math.abs(kg))}`;

// "60 kg × 8", "10 kg × 20 s", "8 reps", "20 s"
export function fmtSet(set, unit) {
  const reps = unit === "sec" ? `${set.v} s` : `${set.v}`;
  if (set.kg) return `${fmtKg(set.kg)} kg × ${reps}`;
  return unit === "sec" ? reps : `${reps} reps`;
}

// Writes one weight into a session's log, beside setValue() in logic.js. A weight alone
// doesn't date the session or count as a logged set: the number of reps does that.
export function setKg(state, session, itemKey, setIndex, kg) {
  const log = state.logs[session.key];
  if (!log) return state;
  const all = log.kg || (log.kg = {});
  const item = session.items.find((it) => it.key === itemKey);
  const arr = all[itemKey] || (all[itemKey] = []);
  const size = Math.max(arr.length, item ? item.sets.length : setIndex + 1);
  while (arr.length < size) arr.push(null);
  arr[setIndex] = kg;
  if (!arr.some((v) => v != null)) delete all[itemKey];
  if (!Object.keys(all).length) delete log.kg;
  return state;
}

// The weights he used the last time he did this exercise (by name and unit), set by set, from the
// newest earlier workout that has any. Shown greyed in the kg boxes so he knows what to load.
export function lastKg(sessions, logs, name, unit, exceptKey) {
  const key = String(name).trim().toLowerCase().replace(/\s+/g, " ");
  let found = null;
  for (const s of sessions) {
    if (s.key === exceptKey) continue;
    const log = logs?.[s.key];
    if (!log?.date || !log.kg) continue;
    for (const it of s.items) {
      if (it.unit !== unit || String(it.name).trim().toLowerCase().replace(/\s+/g, " ") !== key) continue;
      const arr = log.kg[it.key];
      if (!arr || !arr.some((v) => v != null)) continue;
      if (!found || log.date > found.date) found = { date: log.date, arr };
    }
  }
  if (!found) return [];
  // A set he gave no weight last time takes the one before it, so every box has a hint.
  let prev = found.arr.find((v) => v != null);
  return found.arr.map((v) => (prev = v ?? prev));
}
