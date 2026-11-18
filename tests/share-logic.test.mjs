import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activitySnapshot, skillSnapshot, cleanSnapshot, cleanPost, cleanGroup, cleanMember,
  cleanCode, fmtCode, timeAgo, checkJoin, joinError, authError,
} from "../share-logic.js";

const ID = "5396e118-b43e-405d-a9b1-40a9dc01360a";
const ID2 = "177696e8-8be0-47ef-8a5c-8fa3e0192aa7";

test("a shared workout holds its summary, never the sets or notes", () => {
  const act = { key: "w1d1", title: "Evening Pull day", date: "2026-11-17", t0: 1, ms: 1834567.4, sets: 12, prs: 1,
    vals: { pullups: [5, 6] }, note: "felt rough" };
  const snap = activitySnapshot(act, [{ name: "Pull-ups", best: 8, unit: "reps", extra: 1 }]);
  assert.deepEqual(snap, { title: "Evening Pull day", date: "2026-11-17", ms: 1834567, sets: 12, prs: 1,
    records: [{ name: "Pull-ups", best: 8, unit: "reps" }] });
  assert.ok(!JSON.stringify(snap).includes("rough"));
  assert.equal(activitySnapshot({ title: "", sets: 3 }).title, "Workout");
  assert.equal(activitySnapshot({ title: "x", ms: null }).ms, null);
});

test("a shared skill holds its name and the best against the target", () => {
  assert.deepEqual(skillSnapshot({ name: "Muscle-up", best: 1, target: 1, unit: "reps", key: "muscle-up" }),
    { skill: "Muscle-up", best: 1, target: 1, unit: "reps" });
  assert.deepEqual(skillSnapshot({ name: "L-sit", best: 20, target: 15, unit: "sec" }).unit, "sec");
  assert.equal(skillSnapshot({ name: "" }), null);
});

test("odd snapshots from the server are cut down to what can be drawn", () => {
  assert.equal(cleanSnapshot("activity", null), null);
  assert.equal(cleanSnapshot("activity", [1]), null);
  assert.equal(cleanSnapshot("video", { title: "x" }), null);
  const s = cleanSnapshot("activity", { title: "A".repeat(100) + "\u0007", date: "17 Nov", ms: -5, sets: 1e6, prs: "3",
    records: [{ name: "Dips", best: 9, unit: "weird" }, { name: "", best: 3 }, { name: "Rows", best: Infinity }, "x", 4, 5, 6, 7] });
  assert.equal(s.title.length, 60);
  assert.equal(s.date, null);
  assert.equal(s.ms, null);
  assert.equal(s.sets, 0);
  assert.equal(s.prs, 0);
  assert.deepEqual(s.records, [{ name: "Dips", best: 9, unit: "reps" }]);
});

test("a post from the server is read field by field", () => {
  const p = cleanPost({ id: ID, kind: "activity", audience: "group", group_id: ID2, caption: "hi\n\n\n\nthere  ",
    created_at: "2026-11-17T15:34:04.166236+00:00", snapshot: { title: "Pull day", sets: 4 },
    author: { id: ID2, name: "  Ann  " }, sneaky: "<script>" });
  assert.equal(p.id, ID);
  assert.equal(p.groupId, ID2);
  assert.equal(p.caption, "hi\n\nthere");
  assert.equal(p.author.name, "Ann");
  assert.equal(p.at, Date.parse("2026-11-17T15:34:04.166Z"));
  assert.ok(!("sneaky" in p));
  assert.equal(cleanPost({ ...p, id: "nope" }), null);
  assert.equal(cleanPost({ id: ID, kind: "activity", snapshot: "x" }), null);
  const q = cleanPost({ id: ID, kind: "skill", audience: "everyone", snapshot: { skill: "Muscle-up" }, author: null, caption: 5 });
  assert.equal(q.author, null);
  assert.equal(q.audience, "everyone");
  assert.equal(q.caption, "");
  assert.equal(q.at, 0);
});

test("groups and members", () => {
  assert.deepEqual(cleanGroup({ role: "owner", group: { id: ID, name: " Bar crew " } }), { id: ID, name: "Bar crew", owner: true, admin: false });
  assert.deepEqual(cleanGroup({ role: "member", group: { id: ID, name: "" } }), { id: ID, name: "Group", owner: false, admin: false });
  assert.equal(cleanGroup({ role: "owner", group: null }), null);
  assert.deepEqual(cleanMember({ role: "member", user: { id: ID2, name: "Ben" } }), { id: ID2, name: "Ben", owner: false, admin: false });
  assert.deepEqual(cleanMember({ role: "admin", user: { id: ID2, name: "Ben" } }), { id: ID2, name: "Ben", owner: false, admin: true });
  assert.equal(cleanGroup({ role: "admin", group: { id: ID, name: "X" } }).admin, true);
  assert.equal(cleanMember({ user: { id: 1 } }), null);
});

test("invite codes, typed any way", () => {
  assert.equal(cleanCode("rh2u-zkkb"), "RH2UZKKB");
  assert.equal(cleanCode(" RH2U ZKKB "), "RH2UZKKB");
  assert.equal(cleanCode("RH2UZKK"), "");
  assert.equal(cleanCode("RH2UZKKBX"), "");
  assert.equal(cleanCode("RH2UZKK1"), ""); // 1 is never in a code
  assert.equal(cleanCode("OH2UZKKB"), ""); // nor O
  assert.equal(cleanCode(null), "");
  assert.equal(fmtCode("RH2UZKKB"), "RH2U-ZKKB");
});

test("how long ago", () => {
  const now = Date.UTC(2026, 10, 17, 12);
  assert.equal(timeAgo(now - 5000, now), "Just now");
  assert.equal(timeAgo(now + 5000, now), "Just now"); // a phone clock a little behind
  assert.equal(timeAgo(now - 5 * 60e3, now), "5m ago");
  assert.equal(timeAgo(now - 3 * 3600e3, now), "3h ago");
  assert.equal(timeAgo(now - 2 * 86400e3, now), "2d ago");
  const old = now - 30 * 86400e3;
  assert.match(timeAgo(old, now), /^\d{1,2} (Oct|Nov)$/);
});

test("the join form says what to fix first", () => {
  const ok = { code: "RH2U-ZKKB", name: "Ann", email: "a@b.ch", password: "12345678" };
  assert.equal(checkJoin(ok), "");
  assert.match(checkJoin({ ...ok, code: "123" }), /8 letters/);
  assert.match(checkJoin({ ...ok, name: "  " }), /name/);
  assert.match(checkJoin({ ...ok, email: "a@b" }), /email/);
  assert.match(checkJoin({ ...ok, password: "1234567" }), /8 characters/);
  assert.equal(checkJoin({ code: "RH2UZKKB" }), ""); // a code alone, for someone signed in
});

test("server answers in words", () => {
  assert.match(joinError("bad_code"), /doesn't work/);
  assert.match(joinError("whatever"), /went wrong/);
  assert.match(authError(422, { error_code: "user_already_exists" }), /Sign in instead/);
  assert.match(authError(400, { error_code: "invalid_credentials" }), /Wrong email/);
  assert.match(authError(400, { error: "invalid_grant" }), /Wrong email/);
  assert.match(authError(403, { msg: "<b>anything</b>" }), /invite code/);
  assert.match(authError(429, null), /Too many/);
  assert.match(authError(500, "x"), /Try again/);
});

test("the server's refusals in words", async () => {
  const { refusal } = await import("../share-logic.js");
  assert.match(refusal({ code: "P0001", message: "too many posts" }), /this hour/);
  assert.match(refusal({ message: "group name" }), /40 characters/);
  assert.equal(refusal({ message: "<b>other</b>" }), "");
  assert.equal(refusal(null), "");
});
