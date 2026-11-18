// Shared plans (Keli, 18 Nov): the pure parts, tested in tests/market-logic.test.mjs.
// What a plan looks like when it goes up to the server, and how whatever comes back down is cut to
// what the app can draw, like share-logic.js does for posts. A file of its own (see picture.js).

import { cleanPlan, cleanItem, planSummary, checkPlan, LIMITS } from "./plans.js";

// The server takes a plan's body up to 60000 bytes; a little room is kept for how it stores it.
export const BODY_MAX = 58000;
export const TITLE_MAX = 60;
export const SUMMARY_MAX = 140;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const line = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

// One of his plans as the row that goes up: { title, summary, body }. Only what's needed to draw
// and use it: no ids from this phone, no empty workouts, nothing about where it came from.
// Returns { row } or { error: "empty" | "big" }.
export function planUpload(plan) {
  if (!plan || checkPlan(plan)) return { error: "empty" };
  const weeks = plan.weeks.map((w) => ({
    title: line(w.title, LIMITS.title) || "Week",
    days: w.days.map((d) => ({
      title: line(d.title, LIMITS.title) || "Workout",
      items: d.items.map(cleanItem).filter(Boolean),
    })).filter((d) => d.items.length),
  })).filter((w) => w.days.length);
  const body = { weeks };
  if (bytes(body) > BODY_MAX) return { error: "big" };
  return { row: { title: line(plan.title, LIMITS.title) || "My plan", summary: planSummary(plan).slice(0, SUMMARY_MAX), body } };
}

export const uploadError = (code) => ({
  empty: "Add a workout with at least one exercise first.",
  big: "This plan is too big to share. Shorten some notes, or split it in two.",
}[code] || "Couldn't share this plan.");

// A row of the marketplace list, or the head of a plan's page:
// { id, title, summary, listed, at, updatedAt, author: { id, name } | null }
export function cleanShared(raw) {
  if (!isObj(raw) || !UUID.test(raw.id)) return null;
  const at = Date.parse(raw.created_at);
  const up = Date.parse(raw.updated_at);
  const a = raw.author;
  return {
    id: raw.id,
    title: line(raw.title, TITLE_MAX) || "Plan",
    summary: line(raw.summary, SUMMARY_MAX),
    listed: raw.listed === true,
    at: Number.isFinite(at) ? at : 0,
    updatedAt: Number.isFinite(up) ? up : 0,
    author: isObj(a) && UUID.test(a.id) ? { id: a.id, name: line(a.name, LIMITS.name) || "Member" } : null,
  };
}

// Someone's shared plan as one of his own: new ids, their name on it, and where it came from.
// Null when there's no workout in it he could do.
export function sharedPlan(raw) {
  const head = cleanShared(raw);
  if (!head || !isObj(raw.body)) return null;
  const plan = cleanPlan({ title: head.title, weeks: raw.body.weeks, by: head.author?.name, src: head.id }, { fresh: true });
  if (!plan || checkPlan(plan)) return null;
  return plan;
}

// What he typed in the search box, made safe to put in the address of the request: letters,
// numbers and spaces only (anything else has a meaning there), at most 40 characters.
export const searchTerm = (q) => String(q ?? "").replace(/[^\p{L}\p{N} '-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40);
