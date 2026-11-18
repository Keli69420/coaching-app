// Groups: the pure parts, tested in tests/share-logic.test.mjs.
// Everything read from the server goes through a clean…() here before it's drawn, so an odd row
// can't break the page. A file of its own for the same reason as picture.js (see there).

export const CAPTION_MAX = 280;
export const NAME_MAX = 40;
export const PASSWORD_MIN = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").slice(0, max) : "");
const int = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e5 ? v : null);
const unit = (u) => (u === "sec" ? "sec" : "reps");
// A record's weight in kg, only when it has one (weight.js has the same limits).
const kgOf = (v) => (typeof v === "number" && Number.isFinite(v) && v !== 0 && v >= -200 && v <= 500 ? { kg: v } : {});
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/* ---------- what a post holds ---------- */

// A shared workout: its name, day, time, number of sets and the PRs it set (with the weight, if any).
// Never the set-by-set numbers, never his notes.
export function activitySnapshot(act, records = []) {
  return cleanSnapshot("activity", {
    title: act?.title, date: act?.date, ms: act?.ms == null ? null : Math.round(act.ms), sets: act?.sets, prs: act?.prs,
    records: (records || []).map((r) => ({ name: r.name, best: r.best, unit: r.unit, kg: r.kg })),
  });
}

// A skill he unlocked on the ladder: its name and his best against the target.
export function skillSnapshot(step) {
  return cleanSnapshot("skill", { skill: step?.name, best: step?.best, target: step?.target, unit: step?.unit });
}

export function cleanSnapshot(kind, s) {
  if (!isObj(s)) return null;
  if (kind === "skill") {
    const skill = str(s.skill, NAME_MAX).trim();
    if (!skill) return null;
    return { skill, best: num(s.best), target: num(s.target), unit: unit(s.unit) };
  }
  // A shared plan: its name and "4 weeks · 3 workouts a week". The plan itself is fetched when opened.
  if (kind === "plan") return { title: str(s.title, 60).trim() || "Plan", summary: str(s.summary, 140).trim() };
  if (kind !== "activity") return null;
  const records = Array.isArray(s.records) ? s.records : [];
  return {
    title: str(s.title, 60).trim() || "Workout",
    date: typeof s.date === "string" && ISO_DAY.test(s.date) ? s.date : null,
    ms: Number.isInteger(s.ms) && s.ms >= 0 && s.ms < 864e5 ? s.ms : null,
    sets: int(s.sets, 999) ?? 0,
    prs: int(s.prs, 999) ?? 0,
    records: records.slice(0, 5).filter(isObj)
      .map((r) => ({ name: str(r.name, NAME_MAX).trim(), best: num(r.best), unit: unit(r.unit), ...kgOf(r.kg) }))
      .filter((r) => r.name && r.best != null),
  };
}

/* ---------- reading what the server sends ---------- */

export function cleanPost(raw) {
  if (!isObj(raw) || !UUID.test(raw.id)) return null;
  const kind = raw.kind === "activity" || raw.kind === "skill" || raw.kind === "plan" ? raw.kind : null;
  const snap = kind && cleanSnapshot(kind, raw.snapshot);
  if (!snap) return null;
  const planId = kind === "plan" && UUID.test(raw.plan_id ?? "") ? raw.plan_id : null;
  if (kind === "plan" && !planId) return null;
  const at = Date.parse(raw.created_at);
  const a = raw.author;
  return {
    id: raw.id,
    kind,
    audience: raw.audience === "everyone" ? "everyone" : "group",
    groupId: UUID.test(raw.group_id ?? "") ? raw.group_id : null,
    planId,
    caption: str(typeof raw.caption === "string" ? raw.caption : "", CAPTION_MAX).replace(/\n{3,}/g, "\n\n").trim(),
    at: Number.isFinite(at) ? at : 0,
    // Empty when the author is someone he can no longer see (they left the group).
    author: isObj(a) && UUID.test(a.id) ? { id: a.id, name: str(a.name, NAME_MAX).trim() || "Member" } : null,
    snap,
  };
}

// A row of group_members with its group: { role, group: { id, name } }.
export function cleanGroup(raw) {
  const g = raw?.group;
  if (!isObj(g) || !UUID.test(g.id)) return null;
  return { id: g.id, name: str(g.name, NAME_MAX).trim() || "Group", owner: raw.role === "owner" };
}

// A row of group_members with its person: { role, user: { id, name } }.
export function cleanMember(raw) {
  const u = raw?.user;
  if (!isObj(u) || !UUID.test(u.id)) return null;
  return { id: u.id, name: str(u.name, NAME_MAX).trim() || "Member", owner: raw.role === "owner" };
}

/* ---------- invite codes ---------- */

// 8 characters with no I, L, O, 0 or 1, the same rule as the server. Dashes, spaces and small
// letters are fine when he types it. Returns "" for anything that can't be a code.
export function cleanCode(s) {
  const c = String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-HJKMNP-Z2-9]{8}$/.test(c) ? c : "";
}

export const fmtCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;

/* ---------- words ---------- */

// "Just now", "5m ago", "3h ago", "2d ago", then the date: "17 Nov".
export function timeAgo(t, now) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// The join form, checked before anything is sent. Returns what to fix, or "".
export function checkJoin({ code, name, email, password }) {
  if (!cleanCode(code)) return "Invite codes are 8 letters and numbers.";
  if (name !== undefined && !String(name).trim()) return "Add your name.";
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return "That email doesn't look right.";
  if (password !== undefined && String(password).length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters for the password.`;
  return "";
}

// What join_with_code() said, in words.
export function joinError(code) {
  return {
    bad_code: "That code doesn't work. Check it, or ask for a new one.",
    too_many_tries: "Too many wrong codes. Try again in an hour.",
    group_full: "That group is full.",
    name: "Add your name.",
    already_in: "You're already in. To join a group, use the code from that group.",
    signed_out: "Sign in first.",
  }[code] || "Something went wrong. Try again.";
}

// What the sign-in server said, in words. Its own messages are never shown as they come.
export function authError(status, body) {
  const code = isObj(body) ? String(body.error_code || body.error || "") : "";
  if (code === "user_already_exists" || code === "email_exists") return "That email already has an account. Sign in instead.";
  if (code === "weak_password") return `Use a longer password: at least ${PASSWORD_MIN} characters.`;
  if (code === "invalid_credentials" || code === "invalid_grant") return "Wrong email or password.";
  if (code === "email_not_confirmed") return "This account isn't switched on yet. Ask your coach.";
  if (code === "email_address_invalid" || code === "validation_failed") return "That email doesn't look right.";
  if (status === 429 || code.includes("rate_limit")) return "Too many tries. Wait a few minutes.";
  if (status === 403) return "That invite code doesn't work. Ask for a new one.";
  return "Couldn't sign in. Try again.";
}

// A refusal from the server's own actions (supabase/migrations), in words. "" when it isn't one.
export function refusal(body) {
  const m = isObj(body) ? String(body.message || "") : "";
  return {
    "too many posts": "You've shared a lot this hour. Try again later.",
    "too many groups": "You have as many groups as your account allows.",
    "too many reports": "You've reported a lot today. Try again tomorrow.",
    "too many plans": "You've shared as many plans as your account allows. Remove one first.",
    "too many plans today": "You've shared a lot of plans today. Try again tomorrow.",
    "group name": `Give the group a name, up to ${NAME_MAX} characters.`,
    "not the owner": "Only the group's owner can do that.",
  }[m] || "";
}
