// The Groups tab (Keli, 17 Nov): join with an invite code, make groups, and share saved workouts
// and unlocked skills with a group or with every member, like Strava's feed. Who sees what is
// decided by the server's rules (supabase/migrations); this file only draws and asks.
// Server calls are in social.js, the pure parts in share-logic.js (tested).

import { cleanTier, groupBlock, limitText } from "./coach-logic.js";
import { configured, me, rest, rpc, signUp, signIn, signOut, forget, errText, NetError } from "./social.js";
import {
  cleanPost, cleanGroup, cleanMember, cleanCode, fmtCode, timeAgo, checkJoin, joinError, refusal, CAPTION_MAX, NAME_MAX,
} from "./share-logic.js";
import { cleanAvatar } from "./picture.js";
import { initCoach, coachMember, coachGroupLoad, coachGroupClick, setSharing, sendProgress, studentLoad, studentHtml } from "./coach.js";

export const groupsOn = configured;

// What app.js lends this file: its drawing helpers, his name and picture, and the page it's on.
let ctx;
export function initGroups(c) { ctx = c; initCoach(c); }
const esc = (s) => ctx.esc(s);

const POSTS = "id,kind,audience,group_id,plan_id,caption,snapshot,created_at,author:profiles(id,name)";
const FEED_MAX = 30;
export const GROUP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.9-3.4 3.4-5.2 6.5-5.2s5.6 1.8 6.5 5.2"/><path d="M15.5 5.3a3.5 3.5 0 0 1 0 6.4M17.6 14.6c2 .7 3.3 2.4 3.9 4.9"/></svg>`;

// view, signed out: "welcome" | "join" | "signin"
// view, signed in:  "code" (account but no profile yet) | "home" | "group" | "newgroup" | "joingroup"
const fresh = () => ({ view: me() ? "home" : "welcome", error: "", note: "", profile: null, groups: null, feed: null, group: null, share: null, mine: null, student: null, coachNote: "" });
let G = fresh();
const avatars = new Map(); // someone's id → their picture (data URL), "" while asked or when they have none
// Each load gets a number; an answer to an older one is dropped. The list and a group count apart,
// so opening a group doesn't throw away the list that's still coming.
let seqHome = 0;
let seqGroup = 0;

/* ---------- drawing ---------- */

export function groupsHtml() {
  return `<section class="groups" id="gbody">${bodyHtml()}</section>`;
}

function bodyHtml() {
  const v = G.view;
  if (v === "join") return joinHtml();
  if (v === "signin") return signinHtml();
  if (!me()) return welcomeHtml();
  if (v === "code") return codeHtml();
  if (v === "group" && G.group) return groupHtml();
  if (v === "student" && G.student) return studentPageHtml();
  if (v === "newgroup") return newGroupHtml();
  if (v === "joingroup") return joinGroupHtml();
  return homeHtml();
}

const back = (act, label) => `<button type="button" class="back" data-act="${act}">${ctx.LEFT}<span>${esc(label)}</span></button>`;
const head = (title, sub = "") => `<header class="head"><h2 class="title">${esc(title)}</h2>${sub ? `<p class="psub">${esc(sub)}</p>` : ""}</header>`;
const errBox = () => (G.error ? `<div class="card info gwarn"><p>${esc(G.error)}</p><button type="button" class="ghostbtn" data-act="g-retry">Try again</button></div>` : "");
const noteLine = () => (G.note ? `<p class="gnote" role="status">${esc(G.note)}</p>` : "");
const field = (label, attrs) => `<label class="grow"><span>${label}</span><input ${attrs}></label>`;
const CODE_INPUT = `name="code" type="text" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-EFGH"`;
const nameInput = () => `name="name" type="text" maxlength="${NAME_MAX}" autocomplete="nickname" autocapitalize="words" placeholder="First name or nickname" value="${esc(ctx.myName())}"`;
const submit = (label) => `<button type="submit" class="cta">${label}</button><p class="formerr" id="gerr" role="alert"></p>`;

function welcomeHtml() {
  return `
    ${head("Groups")}
    ${noteLine()}
    <div class="card info">
      <p>Share your workouts and the skills you unlock: with a small group of friends, or with every member.</p>
      <p>Pathletics is invite only for now. You need a code from someone who's in.</p>
    </div>
    <button type="button" class="cta" data-act="g-tojoin">I have an invite code</button>
    <button type="button" class="quiet" data-act="g-tosignin">I already have an account</button>`;
}

// Real forms with the usual autocomplete names, so the iPhone offers to save the password.
function joinHtml() {
  return `
    ${back("g-welcome", "Groups")}
    ${head("Join Pathletics")}
    <form class="gform" data-form="join" novalidate>
      <div class="card group">
        ${field("Invite code", CODE_INPUT)}
        ${field("Name", nameInput())}
        ${field("Email", `name="email" type="email" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="you@example.com"`)}
        ${field("Password", `name="password" type="password" autocomplete="new-password" placeholder="8 or more characters"`)}
      </div>
      <p class="foot">Your name and photo show to the people you share with. Your email is only for signing in.</p>
      ${submit("Join")}
    </form>`;
}

function signinHtml() {
  return `
    ${back("g-welcome", "Groups")}
    ${head("Sign in")}
    ${noteLine()}
    <form class="gform" data-form="signin" novalidate>
      <div class="card group">
        ${field("Email", `name="email" type="email" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="you@example.com"`)}
        ${field("Password", `name="password" type="password" autocomplete="current-password" placeholder="Password"`)}
      </div>
      <p class="foot">Forgot your password? Ask your coach to set a new one.</p>
      ${submit("Sign in")}
    </form>`;
}

// Signed in, but the invite didn't go through (say the code ran out in between).
function codeHtml() {
  return `
    ${head("Finish joining", "One more step: your invite code.")}
    ${errBox()}
    <form class="gform" data-form="code" novalidate>
      <div class="card group">${field("Invite code", CODE_INPUT)}${field("Name", nameInput())}</div>
      ${submit("Join")}
    </form>
    <button type="button" class="quiet" data-act="g-signout">Sign out</button>`;
}

function homeHtml() {
  const rows = G.groups == null ? `<li class="gload">Loading…</li>` : G.groups.map((g) => `
    <li><button type="button" class="row" data-act="g-open" data-id="${g.id}">
      <span class="gicon">${GROUP_ICON}</span>
      <span class="rtext"><b>${esc(g.name)}</b><small>${g.owner ? "Yours" : "Member"}</small></span>${ctx.RIGHT}
    </button></li>`).join("");
  return `
    ${head("Groups")}
    ${noteLine()}${errBox()}
    <ul class="card rows gtop">${rows}
      <li><button type="button" class="row add" data-act="g-new"><span class="gicon plus" aria-hidden="true">+</span><span class="rtext"><b>New group</b></span></button></li>
      <li><button type="button" class="row add" data-act="g-joingroup"><span class="gicon plus" aria-hidden="true">#</span><span class="rtext"><b>Join with a code</b></span></button></li>
    </ul>
    <h2 class="sect">Everyone</h2>
    ${feedHtml(G.feed, "Nothing shared with everyone yet.")}`;
}

function groupHtml() {
  const g = G.group;
  const n = g.members?.length;
  return `
    ${back("g-home", "Groups")}
    ${g.kind === "coaching" ? `<p class="eyebrow">Coaching group</p>` : ""}
    ${head(g.name, n ? ctx.count(n, "member", "members") : "")}
    ${noteLine()}${errBox()}
    ${g.owner ? inviteHtml(g) : consentHtml(g)}
    <h2 class="sect">Posts</h2>
    ${feedHtml(g.posts, "Nothing here yet. Share a saved workout, or a skill from Progress.")}
    <h2 class="sect">Members</h2>
    ${g.members == null ? `<p class="empty">Loading…</p>` : `<ul class="card rows">${g.members.map(memberHtml).join("")}</ul>`}
    <button type="button" class="quiet" data-act="g-leave">Leave group</button>`;
}

function inviteHtml(g) {
  if (!g.code) return `<button type="button" class="sharebtn" data-act="g-invite">Invite friends</button>`;
  return `
    <div class="card invite">
      <p class="clabel">Invite code</p>
      <p class="code">${fmtCode(g.code)}</p>
      <p class="hint">Anyone with this code can join this group, and Pathletics, for 7 days.</p>
      <button type="button" class="ghostbtn pinkbtn" data-act="g-sendcode">Send code</button>
    </div>`;
}

function memberHtml(m) {
  const you = m.id === me()?.id;
  const co = coachMember(m, G.group); // a coach's "Assign a plan", in a coaching group he owns
  // A coach sees who shares progress, and opens the ones who do.
  const watch = G.group.owner && G.group.kind === "coaching" && !you && !m.owner;
  const shares = watch && G.group.shares?.has(m.id);
  const sub = [m.owner ? "Owner" : "", watch ? (shares ? "Sharing progress" : "Not sharing") : "", co?.sub || ""].filter(Boolean).join(" · ");
  const text = `<b>${esc(m.name)}${you ? " (you)" : ""}</b>${sub ? `<small>${sub}</small>` : ""}`;
  return `
    <li class="mrow">
      <span class="avatar sm">${avatarOf(m)}</span>
      ${shares ? `<button type="button" class="rtext gname" data-act="g-student" data-id="${m.id}">${text}</button>` : `<span class="rtext">${text}</span>`}
      ${co ? co.button : ""}
      ${G.group.owner && !you ? `<button type="button" class="gact" data-act="g-remove" data-id="${m.id}">Remove</button>` : ""}
    </li>${co?.below || ""}`;
}

/* ---------- sharing progress with a coach ---------- */

const ASKED_KEY = "pathletics.progressAsked";
const askedIds = () => { try { const l = JSON.parse(localStorage.getItem(ASKED_KEY)); return Array.isArray(l) ? l : []; } catch { return []; } };
const markAsked = (id) => { try { localStorage.setItem(ASKED_KEY, JSON.stringify([...new Set([...askedIds(), id])].slice(-100))); } catch { /* asked again next time */ } };
const INCLUDES = "Your saved workouts with sets and weights, your PRs and weekly totals. Never your notes.";

// The card on a coaching group's page, until he has answered for that group on this phone.
function consentHtml(g) {
  if (g.kind !== "coaching" || g.owner || g.myShare !== false || askedIds().includes(g.id)) return "";
  const coach = g.members?.find((m) => m.owner)?.name || "your coach";
  return `
    <div class="card info consent">
      <p><b>Let ${esc(coach)} see your workouts and PRs?</b></p>
      <p>${INCLUDES}</p>
      <div class="consentbtns">
        <button type="button" class="ghostbtn plain" data-act="g-shareno" data-id="${g.id}">Not now</button>
        <button type="button" class="ghostbtn" data-act="g-shareyes" data-id="${g.id}">Share with my coach</button>
      </div>
    </div>`;
}

// His coaching groups as the server has them (as a member, not the owner), and whether he shares in each.
// `flags` are his own sharing flags from the server (my_progress_sharing), by group id.
const sharingFlags = (rows) => new Map((Array.isArray(rows) ? rows : []).map((r) => [r?.group_id, r?.share_progress === true]));
function setMine(rows, flags) {
  G.mine = (rows || []).flatMap((r) => {
    const g = cleanGroup(r);
    return g && !g.owner && r.group?.kind === "coaching" ? [{ id: g.id, name: g.name, on: flags.get(g.id) === true }] : [];
  });
  syncSharing();
}
const syncSharing = () => { if (G.mine) setSharing(G.mine.some((x) => x.on)); };
function setMineOn(id, on) {
  const x = G.mine?.find((y) => y.id === id);
  if (x) x.on = on;
  if (G.group?.id === id) G.group.myShare = on;
  syncSharing();
}

let mineAsked = 0;
function fetchMine() {
  const u = me();
  if (!u || Date.now() - mineAsked < 10000) return;
  mineAsked = Date.now();
  Promise.all([rest(`group_members?select=role,group:groups(id,name,kind)&user_id=eq.${u.id}`), rpc("my_progress_sharing")])
    .then(([rows, flags]) => { setMine(rows, sharingFlags(flags)); ctx.render?.(); })
    .catch(() => {});
}

// Settings → Data & privacy: the "Coaches" section. Empty when he has no coach.
export function coachesHtml() {
  if (!me()) return "";
  if (G.mine == null) { setTimeout(fetchMine, 0); return ""; }
  if (!G.mine.length) return "";
  return `
    <h2 class="sect">Coaches</h2>
    <ul class="card rows">${G.mine.map((x) => `
      <li><button type="button" class="row" role="switch" aria-checked="${x.on}" data-act="g-sharetoggle" data-id="${x.id}">
        <span class="rtext"><b>${esc(x.name)}</b><small>Share my progress</small></span>
        <span class="pswitch${x.on ? " on" : ""}" aria-hidden="true"><i></i></span>
      </button></li>`).join("")}
    </ul>
    <p class="foot">${INCLUDES}</p>
    ${G.coachNote ? `<p class="gnote" role="status">${esc(G.coachNote)}</p>` : ""}`;
}

function studentPageHtml() {
  return `
    ${back("g-studentback", G.group?.name || "Group")}
    ${head(G.student.name, "Shared progress")}
    ${studentHtml()}`;
}

async function setShare(group, on) {
  await rpc("set_progress_sharing", { p_group: group, p_on: on });
  setMineOn(group, on);
  if (on) sendProgress(true);
}

function newGroupHtml() {
  return `
    ${back("g-home", "Groups")}
    ${head("New group")}
    <form class="gform" data-form="newgroup" novalidate>
      <div class="card group">${field("Name", `name="name" type="text" maxlength="${NAME_MAX}" autocomplete="off" autocapitalize="words" placeholder="Bar crew"`)}</div>
      <p class="foot">You get a code to invite your friends.</p>
      ${submit("Make group")}
    </form>`;
}

function joinGroupHtml() {
  return `
    ${back("g-home", "Groups")}
    ${head("Join a group")}
    <form class="gform" data-form="joingroup" novalidate>
      <div class="card group">${field("Invite code", CODE_INPUT)}</div>
      <p class="foot">Ask someone in the group for its code.</p>
      ${submit("Join group")}
    </form>`;
}

function feedHtml(list, empty) {
  if (list == null) return `<p class="empty">${G.error ? "" : "Loading…"}</p>`;
  if (!list.length) return `<p class="empty">${esc(empty)}</p>`;
  return `<ul class="acts">${list.map((p) => postHtml(p)).join("")}</ul>`;
}

// His own picture as he set it on this phone; anyone else's as the server has it, else an initial.
function avatarOf(person) {
  if (!person) return ctx.PERSON;
  if (person.id === me()?.id) return ctx.avatarHtml();
  const pic = avatars.get(person.id);
  return pic ? `<img src="${pic}" alt="">` : esc(person.name.charAt(0).toUpperCase());
}

// A post looks like one of his own activity cards, with who shared it and when.
function postHtml(p, preview = false) {
  const s = p.snap;
  const stat = (label, value, hue) => `<span class="${hue}"><small>${label}</small><b class="num">${esc(value)}</b></span>`;
  let body;
  if (p.kind === "skill") {
    const u = s.unit === "sec" ? " s" : "";
    body = `
      <span class="skilltag">${ctx.TICK}Skill unlocked</span>
      <span class="acttitle">${esc(s.skill)}</span>
      ${s.best != null ? `<span class="actstats">${stat("Best", `${s.best}${u}`, "lime")}${s.target != null ? stat("Goal", `${s.target}${u}`, "pink") : ""}</span>` : ""}`;
  } else if (p.kind === "plan") {
    // A shared plan: its name and size; the plan itself opens on its own page (market.js).
    body = `
      <span class="skilltag plantag">Plan</span>
      <span class="acttitle">${esc(s.title)}</span>
      ${s.summary ? `<span class="psum">${esc(s.summary)}</span>` : ""}
      ${preview ? "" : `<button type="button" class="ghostbtn" data-act="m-view" data-plan="${p.planId}">View plan</button>`}`;
  } else {
    body = `
      <span class="acttitle">${esc(s.title)}</span>
      <span class="actstats">${s.ms != null ? stat("Time", ctx.fmtDuration(s.ms), "sky") : ""}${stat("Sets", s.sets, "lime")}${stat("PRs", s.prs, "gold")}</span>
      ${s.records.length ? `<ul class="prs">${s.records.map((r) => `<li>${ctx.MEDAL}<span class="prname">${esc(r.name)}</span><span class="prval">${ctx.recHtml ? ctx.recHtml(r) : ctx.numHtml(r.best, r.unit)}</span></li>`).join("")}</ul>` : ""}`;
  }
  let action = "";
  if (!preview) {
    const mine = p.author?.id === me()?.id;
    const owner = G.view === "group" && G.group?.owner;
    action = mine ? `<button type="button" class="gact" data-act="g-delpost" data-id="${p.id}" data-confirm="Tap again to delete">Delete</button>`
      : owner ? `<button type="button" class="gact" data-act="g-delpost" data-id="${p.id}" data-confirm="Tap again to remove">Remove</button>`
      : `<button type="button" class="gact" data-act="g-report" data-id="${p.id}">Report</button>`;
  }
  return `
    <li><div class="card act post">
      <span class="actwho">
        <span class="avatar sm">${avatarOf(p.author)}</span>
        <span class="actmeta"><b>${esc(p.author?.name || "Former member")}</b><small>${esc(preview ? "Now" : timeAgo(p.at, Date.now()))}</small></span>
        ${action}
      </span>
      ${body}
      ${p.caption ? `<p class="caption">${esc(p.caption)}</p>` : ""}
    </div></li>`;
}

/* ---------- sharing a workout or a skill ---------- */

export const sharing = () => Boolean(G.share);
export const stopShare = () => { G.share = null; };

// Always opens on a group, never on Everyone: Everyone is a tap of its own each time.
// `extra` goes into the post as it is: the plan's id when a plan is shared.
export function startShare(kind, snap, extra = {}) {
  G.share = { kind, snap, extra, audience: null, caption: "", sending: false };
  if (me()) {
    if (G.groups?.length) G.share.audience = G.groups[0].id;
    load();
  }
}

export function shareHtml() {
  const sh = G.share;
  const preview = postHtml({ kind: sh.kind, snap: sh.snap, author: { id: me()?.id ?? "", name: ctx.myName() || "You" }, caption: "" }, true);
  const rest = !me()
    ? `<div class="card info gshare"><p>Sign in to Groups to share.</p></div><button type="button" class="cta" data-act="g-gogroups">Go to Groups</button>`
    : `
      <h2 class="sect">Share with</h2>
      <div id="gaud">${audienceHtml()}</div>
      <textarea class="card note" id="gcaption" rows="2" maxlength="${CAPTION_MAX}" placeholder="Say something (optional)" aria-label="Caption">${esc(sh.caption)}</textarea>
      <button type="button" class="cta" data-act="g-post"${sh.audience ? "" : " disabled"}>Share</button>
      <p class="formerr" id="gerr" role="alert"></p>`;
  return `
    <section class="share">
      ${back("g-unshare", "Back")}
      ${head("Share")}
      <ul class="acts">${preview}</ul>
      ${rest}
    </section>`;
}

function audienceHtml() {
  const sh = G.share;
  if (G.error) return `<p class="empty">${esc(G.error)}</p>`;
  if (G.view === "code") return `<p class="empty">Finish joining in Groups first.</p>`;
  if (G.groups == null) return `<p class="empty">Loading your groups…</p>`;
  const opt = (value, label, sub) => {
    const on = sh.audience === value;
    return `
      <li><button type="button" class="row" role="radio" aria-checked="${on}" data-act="g-aud" data-aud="${value}">
        <span class="st ${on ? "done" : "later"}">${on ? ctx.TICK : ""}</span>
        <span class="rtext"><b>${esc(label)}</b><small>${esc(sub)}</small></span>
      </button></li>`;
  };
  return `
    <ul class="card rows" role="radiogroup" aria-label="Share with">
      ${G.groups.map((g) => opt(g.id, g.name, "Your group")).join("")}
      ${opt("everyone", "Everyone", "Every Pathletics member")}
    </ul>
    ${G.groups.length ? "" : `<p class="foot">You're not in a group yet. Make one under Groups, or pick Everyone.</p>`}`;
}

/* ---------- Settings → Account ---------- */

export const accountValue = () => (me() ? "Signed in" : "Not signed in");

// Asking to become a coach is remembered on this phone, so the button stays "Requested".
const REQ_KEY = "pathletics.coachRequested";
const requested = () => { try { return localStorage.getItem(REQ_KEY) === "1"; } catch { return false; } };

// While he's waiting, opening Account asks the server whether he's been approved (at most every 10 s).
let tierAsked = 0;
function checkTier() {
  const u = me();
  if (!u || Date.now() - tierAsked < 10000) return;
  tierAsked = Date.now();
  rest(`profiles?select=tier&id=eq.${u.id}`).then(([p]) => { if (p) ctx.setTier?.(cleanTier(p.tier)); }).catch(() => {});
}

function coachHtml() {
  if ((ctx.myTier?.() ?? "free") === "coach") return `<div class="card group"><div class="grow"><span>Coach</span></div></div>`;
  const asked = requested();
  if (asked) setTimeout(checkTier, 0);
  return `
    <div class="card group"><div class="grow"><span>Coach</span><span class="val">${asked ? "Requested" : "Free"}</span></div></div>
    <p class="foot">Coaches build unlimited plans and run coaching groups of up to 50.</p>
    ${asked ? "" : `<button type="button" class="sharebtn" data-act="g-coach">Register as coach</button>`}`;
}

export function accountHtml() {
  const u = me();
  if (!u) return `<div class="card info"><p>You're not signed in to Groups. Your workouts don't need an account.</p></div>
    <button type="button" class="cta" data-act="g-gogroups">Go to Groups</button>`;
  return `
    <div class="card group"><div class="grow"><span>Email</span><span class="val">${esc(u.email)}</span></div></div>
    ${coachHtml()}
    <button type="button" class="sharebtn" data-act="g-signout">Sign out</button>
    <button type="button" class="quiet danger" data-act="g-deleteacct">Delete account</button>
    <p class="foot">Deleting your account deletes your posts and takes you out of every group. Your workouts on this phone stay.</p>`;
}

/* ---------- loading ---------- */

// Only Groups' own part of the page is redrawn, so nothing else jumps or loses the keyboard.
function redraw() {
  if (G.share) {
    const aud = document.getElementById("gaud");
    if (aud) aud.innerHTML = audienceHtml();
    const btn = document.querySelector('[data-act="g-post"]');
    if (btn && !G.share.sending) btn.disabled = !G.share.audience;
    return;
  }
  const el = ctx.page() === "groups" && document.getElementById("gbody");
  if (el) el.innerHTML = bodyHtml();
}

function failed(e) {
  if (e?.kind === "auth") {
    forget();
    setSharing(false);
    ctx.setTier?.("free");
    G = { ...fresh(), view: "signin", note: "Please sign in again." };
  } else {
    G.error = errText(e);
  }
  redraw();
}

// Opening the tab: his groups and the Everyone feed, or the open group again.
export function enterGroups() {
  G.note = "";
  G.error = "";
  if (!me()) {
    if (G.view !== "join" && G.view !== "signin") G.view = "welcome";
    redraw();
    return;
  }
  if (G.view === "group" && G.group) { openGroup(G.group); return; }
  if (G.view !== "code") G.view = "home";
  load();
}

async function load() {
  const n = ++seqHome;
  G.error = "";
  try {
    const uid = me().id;
    const [prof] = await rest(`profiles?select=id,name,avatar,tier&id=eq.${uid}`);
    if (n !== seqHome) return;
    if (!prof) {
      G.profile = null;
      G.view = "code";
      redraw();
      return;
    }
    G.profile = { id: prof.id, name: prof.name };
    adoptProfile(prof);
    ctx.setTier?.(cleanTier(prof.tier));
    const [mem, flags, feed] = await Promise.all([
      rest(`group_members?select=role,group:groups(id,name,kind)&user_id=eq.${uid}&order=joined_at.desc`),
      rpc("my_progress_sharing"),
      rest(`posts?select=${POSTS}&audience=eq.everyone&order=created_at.desc&limit=${FEED_MAX}`),
    ]);
    if (n !== seqHome) return;
    G.groups = (mem || []).map((r) => {
      const g = cleanGroup(r);
      if (g) g.kind = r.group?.kind === "coaching" ? "coaching" : "friends";
      return g;
    }).filter(Boolean);
    setMine(mem, sharingFlags(flags));
    G.feed = (feed || []).map(cleanPost).filter(Boolean);
    if (G.view === "code") G.view = "home";
    if (G.share && !G.share.audience && G.groups.length) G.share.audience = G.groups[0].id;
    redraw();
    fetchAvatars(G.feed.map((p) => p.author?.id));
  } catch (e) {
    if (n === seqHome) failed(e);
  }
}

async function openGroup(g) {
  if (!g) return;
  G.view = "group";
  G.group = { id: g.id, name: g.name, kind: g.kind || "friends", owner: g.owner, posts: null, members: null, code: G.group?.id === g.id ? G.group.code : null };
  redraw();
  ctx.toTop();
  const n = ++seqGroup;
  try {
    const [posts, mem, info, flags] = await Promise.all([
      rest(`posts?select=${POSTS}&group_id=eq.${g.id}&order=created_at.desc&limit=${FEED_MAX}`),
      rest(`group_members?select=role,user:profiles(id,name)&group_id=eq.${g.id}&order=joined_at`),
      rest(`groups?select=id,name,kind&id=eq.${g.id}`), // its name, also when he came in by a code
      rpc("my_progress_sharing"), // his own flag; the server never shows him anyone else's
    ]);
    if (n !== seqGroup || G.group?.id !== g.id) return;
    const members = (mem || []).map(cleanMember).filter(Boolean);
    if (!members.some((m) => m.id === me()?.id)) { // removed, or the group is gone
      G.view = "home";
      G.group = null;
      G.note = "You're not in that group any more.";
      load();
      return;
    }
    const owner = members.some((m) => m.id === me().id && m.owner);
    const coaching = info?.[0]?.kind === "coaching";
    // Only the coach who owns a coaching group is told who shares (anyone else gets nothing).
    const sharers = owner && coaching ? await rpc("group_progress_sharing", { p_group: g.id }) : [];
    if (n !== seqGroup || G.group?.id !== g.id) return;
    Object.assign(G.group, {
      name: cleanGroup({ group: info?.[0] })?.name || G.group.name,
      kind: info?.[0]?.kind === "coaching" ? "coaching" : "friends",
      posts: (posts || []).map(cleanPost).filter(Boolean),
      members,
      owner,
      shares: new Set((Array.isArray(sharers) ? sharers : []).map((r) => r?.user_id)),
      myShare: sharingFlags(flags).get(g.id) === true,
    });
    setMineOn(g.id, G.group.myShare);
    redraw();
    fetchAvatars([...G.group.posts.map((p) => p.author?.id), ...members.map((m) => m.id)]);
    if (G.group.owner && G.group.kind === "coaching") coachGroupLoad(g.id);
  } catch (e) {
    if (n === seqGroup) failed(e);
  }
}

// Other people's pictures, once each while the app is open.
async function fetchAvatars(ids) {
  const want = [...new Set(ids.filter((id) => id && id !== me()?.id && !avatars.has(id)))];
  if (!want.length) return;
  want.forEach((id) => avatars.set(id, ""));
  try {
    const rows = await rest(`profiles?select=id,avatar&id=in.(${want.join(",")})`);
    for (const r of rows || []) if (want.includes(r.id)) avatars.set(r.id, cleanAvatar(r.avatar));
    if (rows?.some((r) => r.avatar)) redraw();
  } catch {
    want.forEach((id) => avatars.delete(id));
  }
}

/* ---------- his name and picture on the server ---------- */

// Right after signing in, the account's own name and photo win: the phone takes them (keeping its
// photo only if the account has none). After that the phone is where he changes them, so a change
// made before Groups loaded goes up the next time it does.
let fromServer = false;
function adoptProfile(prof) {
  const remote = cleanAvatar(prof.avatar);
  if (fromServer || !ctx.myName()) ctx.setName(prof.name);
  if (remote && (fromServer || !ctx.myAvatar())) ctx.setAvatar(remote);
  fromServer = false;
  const name = ctx.myName() || prof.name;
  const local = ctx.myAvatar();
  if (name !== prof.name || (local && local !== remote)) push({ name, avatar: local || remote || null });
}

let pushTimer = null;
export function profileChanged() {
  if (!G.profile || !me()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push({ name: ctx.myName() || G.profile.name, avatar: ctx.myAvatar() || null }), 1500);
}

async function push(p) {
  try {
    await rest(`profiles?id=eq.${me().id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: p });
    if (G.profile) G.profile.name = p.name;
  } catch { /* tried again the next time he changes it or opens Groups */ }
}

/* ---------- forms ---------- */

// The server's 'too many groups' gets the same sentence as the check before it, for his tier.
const words = (e) => (e?.kind === "bad"
  ? (e.body?.message === "too many groups" ? limitText("groups", (ctx.myTier?.() ?? "free")) : refusal(e.body) || errText(e))
  : errText(e));

export async function groupsSubmit(form) {
  const f = Object.fromEntries(new FormData(form));
  const say = (t) => { const el = form.querySelector("#gerr"); if (el) el.textContent = t; };
  const btn = form.querySelector('button[type="submit"]');
  if (btn.disabled) return;
  const which = form.dataset.form;
  const problem = which === "join" ? checkJoin(f)
    : which === "code" ? checkJoin({ code: f.code, name: f.name })
    : which === "joingroup" ? checkJoin({ code: f.code })
    : which === "signin" ? (String(f.email).trim() && f.password ? "" : "Fill in your email and password.")
    : which === "newgroup" ? (String(f.name).trim() ? "" : "Give the group a name.") : "";
  if (problem) { say(problem); return; }
  say("");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "One moment…";
  const done = () => { btn.disabled = false; btn.textContent = label; };
  try {
    if (which === "join") {
      await signUp(String(f.email).trim(), f.password, cleanCode(f.code));
      G = { ...fresh(), view: "code" }; // signed in from here on, even if the next step fails
      await finishJoin(f.code, f.name);
    } else if (which === "code") {
      await finishJoin(f.code, f.name);
    } else if (which === "signin") {
      await signIn(String(f.email).trim(), f.password);
      fromServer = true;
      G = fresh();
      ctx.render();
      load();
    } else if (which === "newgroup") {
      const name = String(f.name).trim();
      const owned = (G.groups || []).filter((g) => g.owner).length;
      if (groupBlock((ctx.myTier?.() ?? "free"), owned)) { say(limitText("groups", (ctx.myTier?.() ?? "free"))); done(); return; }
      const id = await rpc("create_group", { p_name: name });
      G.note = "Group made. Invite your friends with its code.";
      await openGroup({ id, name, owner: true });
      load();
    } else if (which === "joingroup") {
      const r = await rpc("join_with_code", { p_code: cleanCode(f.code) });
      if (r?.error) throw new NetError("bad", joinError(r.error));
      if (!r?.group) throw new NetError("bad", joinError("already_in"));
      G.note = "You're in.";
      await openGroup({ id: r.group, name: "", owner: false });
      load(); // its name comes with the list of his groups
    }
  } catch (e) {
    done();
    if (which === "join" && me()) { // the account was made; only the invite step failed
      G.error = words(e);
      ctx.render();
      return;
    }
    say(words(e));
  }
}

async function finishJoin(code, name) {
  const r = await rpc("join_with_code", { p_code: cleanCode(code), p_name: String(name).trim() });
  if (r?.error) throw new NetError("bad", joinError(r.error));
  ctx.setName(String(name).trim()); // the form starts with his name on this phone; a changed one wins
  G = { ...fresh(), note: r?.group ? "Welcome! You're in the group." : "Welcome to Groups!" };
  ctx.render();
  if (r?.group) openGroup({ id: r.group, name: "", owner: false });
  load();
}

/* ---------- typing and buttons ---------- */

export function groupsInput(el) {
  if (el.id === "gcaption" && G.share) G.share.caption = el.value.slice(0, CAPTION_MAX);
}

export async function groupsClick(act, btn) {
  const id = btn.dataset.id;
  const to = (view) => { G.view = view; G.note = ""; G.error = ""; ctx.render(); ctx.toTop(); };
  if (act === "g-tojoin") return to("join");
  if (act === "g-tosignin") return to("signin");
  if (act === "g-welcome") return to("welcome");
  if (act === "g-new") return to("newgroup");
  if (act === "g-joingroup") return to("joingroup");
  if (act === "g-home") { to("home"); G.group = null; load(); return; }
  if (act === "g-open") { G.note = ""; openGroup(G.groups.find((g) => g.id === id)); return; }
  if (act === "g-retry") { G.error = ""; if (G.view === "group" && G.group) openGroup(G.group); else load(); return; }
  if (act === "g-asg" || act === "g-asgpick") { coachGroupClick(act, btn); return; }
  if (act === "g-student") {
    const m = G.group?.members?.find((x) => x.id === id);
    if (!m) return;
    G.student = { id: m.id, name: m.name };
    G.view = "student";
    ctx.render();
    ctx.toTop();
    studentLoad(m.id);
    return;
  }
  if (act === "g-studentback") { G.view = "group"; G.student = null; ctx.render(); ctx.toTop(); return; }
  if (act === "g-sharetoggle") {
    const x = G.mine?.find((y) => y.id === id);
    if (!x || btn.disabled) return;
    const on = !x.on;
    btn.disabled = true;
    try {
      await setShare(id, on);
      G.coachNote = on ? "Your coach can now see your progress." : "Your coach can no longer see your progress.";
    } catch (e) {
      if (e?.kind === "auth") { failed(e); return; }
      G.coachNote = words(e);
    }
    ctx.render?.();
    return;
  }
  if (act === "g-shareno") { markAsked(id); redraw(); return; }
  if (act === "g-unshare") { G.share = null; ctx.render(); ctx.toTop(); return; }
  if (act === "g-gogroups") { G.share = null; ctx.goGroups(); return; }
  if (act === "g-aud") { G.share.audience = btn.dataset.aud; redraw(); return; }
  if (act === "g-signout") {
    signOut();
    setSharing(false);
    ctx.setTier?.("free");
    G = fresh();
    ctx.render();
    return;
  }
  try {
    if (act === "g-shareyes") {
      btn.disabled = true;
      await setShare(id, true);
      markAsked(id);
      redraw();
    } else if (act === "g-invite") {
      btn.disabled = true;
      const code = cleanCode(await rpc("group_invite", { p_group: G.group.id }));
      if (code) G.group.code = code;
      redraw();
    } else if (act === "g-sendcode") {
      const text = `Join "${G.group.name}" on Pathletics: ${location.origin}${location.pathname}\nOpen Groups, tap "I have an invite code" and type: ${fmtCode(G.group.code)}`;
      if (navigator.share) await navigator.share({ text }).catch(() => {});
      else { await navigator.clipboard?.writeText(text); btn.textContent = "Copied"; }
    } else if (act === "g-delpost") {
      if (!ctx.armed(btn, btn.dataset.confirm)) return;
      await rest(`posts?id=eq.${id}`, { method: "DELETE" });
      const drop = (list) => list && list.filter((p) => p.id !== id);
      G.feed = drop(G.feed);
      if (G.group) G.group.posts = drop(G.group.posts);
      redraw();
    } else if (act === "g-report") {
      if (!ctx.armed(btn, "Tap again to report")) return;
      await rpc("report_post", { p_post: id, p_reason: "" });
      G.note = "Reported. Thanks for telling us.";
      redraw();
    } else if (act === "g-remove") {
      if (!ctx.armed(btn, "Tap again")) return;
      await rest(`group_members?group_id=eq.${G.group.id}&user_id=eq.${id}`, { method: "DELETE" });
      openGroup(G.group);
    } else if (act === "g-leave") {
      if (!ctx.armed(btn, "Tap again to leave")) return;
      const name = G.group.name;
      await rest(`group_members?group_id=eq.${G.group.id}&user_id=eq.${me().id}`, { method: "DELETE" });
      G.group = null;
      to("home");
      G.note = `You left ${name}.`;
      load();
    } else if (act === "g-coach") {
      btn.disabled = true;
      const r = await rpc("request_coach");
      if (r === "coach") ctx.setTier?.("coach");
      else {
        try { localStorage.setItem(REQ_KEY, "1"); } catch { /* shown as requested until reload */ }
        btn.textContent = "Requested";
      }
    } else if (act === "g-deleteacct") {
      if (!ctx.armed(btn, "Tap again to delete your account")) return;
      btn.disabled = true;
      await rpc("delete_my_account");
      forget();
      setSharing(false);
      ctx.setTier?.("free");
      G = { ...fresh(), note: "Your account and posts are deleted." };
      ctx.render();
    } else if (act === "g-post") {
      await post(btn);
    }
  } catch (e) {
    btn.disabled = false;
    if (G.share) {
      const el = document.getElementById("gerr");
      if (el) el.textContent = words(e);
      return;
    }
    if (e?.kind === "auth") { failed(e); return; }
    G.error = words(e);
    ctx.page() === "groups" ? redraw() : ctx.render();
  }
}

async function post(btn) {
  const sh = G.share;
  if (!sh?.audience || sh.sending) return;
  sh.sending = true;
  btn.disabled = true;
  btn.textContent = "Sharing…";
  const everyone = sh.audience === "everyone";
  try {
    await rest("posts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: { ...sh.extra, kind: sh.kind, audience: everyone ? "everyone" : "group", group_id: everyone ? null : sh.audience, snapshot: sh.snap, caption: sh.caption.trim() },
    });
  } catch (e) {
    sh.sending = false;
    btn.textContent = "Share";
    throw e;
  }
  // Shared: show it where it went, like Strava after you save.
  const g = !everyone && G.groups?.find((x) => x.id === sh.audience);
  G.share = null;
  G.note = `Shared with ${g ? g.name : "everyone"}.`;
  ctx.goGroups(true);
  if (g) openGroup(g);
  else { G.view = "home"; load(); }
}
