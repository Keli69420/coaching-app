// Shared plans (Keli, 18 Nov): the marketplace ("Find plans"), a shared plan's page, and the
// Share part of his own plan's page. The pure parts are in market-logic.js; his own plans are
// kept by planpages.js, which lends this file what it needs through registerPlans().
//
// A shared plan is a copy on the server. His plan stays on his phone; "Update shared copy" sends
// it again after he changed it. Nothing here works signed out, and nothing is on the open web.

import { configured, me, rest, rpc, errText } from "./social.js";
import { refusal, timeAgo } from "./share-logic.js";
import { planBlock, limitText } from "./coach-logic.js";
import { cleanAvatar } from "./picture.js";
import { fmtItem } from "./plans.js";
import { startShare } from "./groups.js";
import { planUpload, uploadError, cleanShared, sharedPlan, searchTerm } from "./market-logic.js";

export const marketOn = configured;

const LIST = "id,title,summary,listed,created_at,updated_at,author:profiles(id,name)";
const LIST_MAX = 50;

let ctx = null;
let plans = null; // from planpages.js: all(), get(id), add(plan), patch(id, fields), bySrc(id), open(id, note)
export function initMarket(c) { ctx = c; }
export function registerPlans(p) { plans = p; }

// view: null (closed) | "list" | "plan". from: where a shared plan's page was opened from.
// busy: the id of his plan being sent up right now; errFor: the plan whose Share block shows `error`.
const M = { view: null, from: "list", list: null, q: "", error: "", errFor: "", row: null, plan: null, note: "", seq: 0, busy: "" };
const avatars = new Map();

export const marketOpen = () => M.view != null;
export function closeMarket() { M.view = null; M.row = null; M.plan = null; M.error = ""; M.note = ""; }

const esc = (s) => ctx.esc(s);
const words = (e) => (e?.kind === "bad" ? refusal(e.body) || errText(e) : errText(e)).replace("Groups needs", "This needs").replace("Groups can't", "The server can't");

function redraw() {
  if (marketOpen()) ctx.render();
}

/* ---------- the row under "Your plans", and the Share part of his own plan's page ---------- */

export function findRowHtml() {
  if (!marketOn) return "";
  return `
    <li><button type="button" class="row add" data-act="m-find">
      <span class="gicon plus" aria-hidden="true">${SEARCH}</span>
      <span class="rtext"><b>Find plans</b><small>Plans other members shared</small></span>
    </button></li>`;
}

const SEARCH = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>`;

export function shareBlockHtml(plan) {
  if (!marketOn) return "";
  const listed = Boolean(plan.pub && plan.listed);
  const err = M.error && M.busy === "" && M.errFor === plan.id ? `<p class="formerr" role="alert">${esc(M.error)}</p>` : "";
  return `
    <h3 class="pweekname">Share</h3>
    <ul class="card rows">
      <li><button type="button" class="row" data-act="m-share" data-plan="${plan.id}"${M.busy ? " disabled" : ""}>
        <span class="rtext"><b>Share to a group or everyone</b><small>As a post, like a workout</small></span>${ctx.RIGHT}
      </button></li>
      <li><button type="button" class="row" role="switch" aria-checked="${listed}" data-act="m-list" data-plan="${plan.id}"${M.busy ? " disabled" : ""}>
        <span class="rtext"><b>In the marketplace</b><small>${listed ? "Every member can find it" : "Off: only people you share it with see it"}</small></span>
        <span class="pswitch${listed ? " on" : ""}" aria-hidden="true"><i></i></span>
      </button></li>
    </ul>
    ${M.busy === plan.id ? `<p class="foot">Sending…</p>` : ""}
    ${err}
    ${plan.pub && plan.stale ? `
      <p class="foot">You changed this plan after sharing it. People still see the older version.</p>
      <button type="button" class="ghostbtn" data-act="m-update" data-plan="${plan.id}"${M.busy ? " disabled" : ""}>Update shared copy</button>` : ""}
    ${plan.pub && !plan.stale ? `<p class="foot">Shared. If you change the plan, people keep the version from now until you update it.</p>` : ""}`;
}

// Sends his plan up: a new copy the first time, the same copy again after that. Returns its id
// on the server. A copy that was removed there (by him elsewhere, or by Keli) is made anew.
export async function sendUp(plan, extra = {}) {
  const up = planUpload(plan);
  if (up.error) throw Object.assign(new Error(uploadError(up.error)), { said: true });
  if (plan.pub) {
    const rows = await rest(`plans?id=eq.${plan.pub}&select=id,listed`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { ...up.row, ...extra } });
    if (Array.isArray(rows) && rows[0]) {
      plans.patch(plan.id, { listed: rows[0].listed === true, stale: false });
      return plan.pub;
    }
  }
  const rows = await rest("plans?select=id,listed", { method: "POST", headers: { Prefer: "return=representation" }, body: { ...up.row, listed: false, ...extra } });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.id) throw new Error("no row");
  plans.patch(plan.id, { pub: row.id, listed: row.listed === true, stale: false });
  return row.id;
}

// One thing at a time on the Share block; what went wrong is shown under it.
async function shareStep(planId, work) {
  const plan = plans.get(planId);
  if (!plan || M.busy) return;
  if (!me()) { ctx.goGroups(); return; }
  M.busy = planId;
  M.error = "";
  ctx.render();
  try {
    await work(plan);
  } catch (e) {
    M.error = e?.said ? e.message : words(e);
    M.errFor = planId;
  }
  M.busy = "";
  ctx.render();
}

// When he deletes one of his plans, its shared copy (and the posts carrying it) go too.
// Not waited for: with no signal the copy stays, and he can remove it from its page later.
export function planDeleted(plan) {
  if (plan?.pub && me()) rest(`plans?id=eq.${plan.pub}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => {});
}

/* ---------- Find plans ---------- */

function listUrl() {
  const q = searchTerm(M.q);
  return `plans?select=${LIST}&listed=is.true&order=created_at.desc&limit=${LIST_MAX}${q ? `&title=ilike.${encodeURIComponent(`*${q}*`)}` : ""}`;
}

async function loadList() {
  const seq = ++M.seq;
  M.error = "";
  try {
    const rows = await rest(listUrl());
    if (seq !== M.seq) return;
    M.list = (Array.isArray(rows) ? rows : []).map(cleanShared).filter(Boolean);
    fetchAvatars(M.list.map((r) => r.author?.id));
  } catch (e) {
    if (seq !== M.seq) return;
    M.error = words(e);
  }
  redraw();
}

async function fetchAvatars(ids) {
  const want = [...new Set(ids.filter((id) => id && !avatars.has(id)))];
  if (!want.length) return;
  try {
    const rows = await rest(`profiles?select=id,avatar&id=in.(${want.join(",")})`);
    for (const r of Array.isArray(rows) ? rows : []) avatars.set(r.id, cleanAvatar(r.avatar));
    redraw();
  } catch { /* initials are fine */ }
}

function avatarOf(person) {
  if (!person) return "?";
  if (person.id === me()?.id) return ctx.avatarHtml();
  const pic = avatars.get(person.id);
  return pic ? `<img src="${pic}" alt="">` : esc(person.name.charAt(0).toUpperCase());
}

async function openPlan(id, from) {
  const seq = ++M.seq;
  M.view = "plan";
  M.from = from;
  M.row = null;
  M.plan = null;
  M.error = "";
  M.note = "";
  ctx.render();
  ctx.toTop();
  if (!me()) return;
  try {
    const rows = await rest(`plans?select=${LIST},body&id=eq.${id}`);
    if (seq !== M.seq) return;
    const raw = Array.isArray(rows) ? rows[0] : null;
    M.row = raw ? cleanShared(raw) : null;
    M.plan = raw ? sharedPlan(raw) : null;
    if (!M.row) M.error = "This plan isn't shared any more.";
    else if (!M.plan) M.error = "This plan can't be read.";
    else fetchAvatars([M.row.author?.id]);
  } catch (e) {
    if (seq !== M.seq) return;
    M.error = words(e);
  }
  redraw();
}

const back = (act, label) => `<button type="button" class="back" data-act="${act}">${ctx.LEFT}<span>${esc(label)}</span></button>`;
const signedOutHtml = () => `
  <div class="card info gshare"><p>Plans are shared between members. You need an account: ask a member for an invite code.</p></div>
  <button type="button" class="cta" data-act="m-gogroups">Go to Groups</button>`;

export function marketHtml() {
  if (M.view === "plan") return planHtml();
  const rows = (M.list || []).map((r) => `
    <li><button type="button" class="row" data-act="m-open" data-id="${r.id}">
      <span class="avatar sm">${avatarOf(r.author)}</span>
      <span class="rtext"><b>${esc(r.title)}</b><small>${esc(r.summary)}${r.author ? ` · ${esc(r.author.name)}` : ""}</small></span>
      ${ctx.RIGHT}
    </button></li>`).join("");
  let body;
  if (!me()) body = signedOutHtml();
  else {
    body = `
      <form class="pform" data-form="m-search" role="search">
        <input class="pin psearch" name="q" type="search" maxlength="40" autocomplete="off" enterkeyhint="search" placeholder="Search by name" aria-label="Search plans by name" value="${esc(M.q)}">
      </form>
      ${M.error ? `<p class="gwarn" role="alert">${esc(M.error)}</p>` : ""}
      ${M.list == null ? (M.error ? "" : `<p class="empty">Loading…</p>`)
        : M.list.length ? `<ul class="card rows mlist">${rows}</ul>${M.list.length >= LIST_MAX ? `<p class="foot">Showing the newest ${LIST_MAX}. Search to find others.</p>` : ""}`
        : `<p class="empty">${searchTerm(M.q) ? "No plan with that name." : "Nobody has shared a plan yet. Yours can be the first: open one of your plans and turn on In the marketplace."}</p>`}`;
  }
  return `
    <section class="planpage market">
      ${back("m-close", "Plan")}
      <header class="head"><h2 class="title">Find plans</h2><p class="psum">Plans members put in the marketplace.</p></header>
      ${body}
    </section>`;
}

function planHtml() {
  const from = M.from === "groups" ? "Groups" : "Find plans";
  if (!me()) return `<section class="planpage market">${back("m-back", from)}<header class="head"><h2 class="title">Plan</h2></header>${signedOutHtml()}</section>`;
  if (!M.row || !M.plan) {
    return `
      <section class="planpage market">
        ${back("m-back", from)}
        ${M.error ? `<p class="gwarn" role="alert">${esc(M.error)}</p>` : `<p class="empty">Loading…</p>`}
      </section>`;
  }
  const r = M.row;
  const mine = r.author?.id === me().id;
  const saved = plans.bySrc(r.id);
  return `
    <section class="planpage market">
      ${back("m-back", from)}
      <header class="head">
        <p class="eyebrow">${r.author ? `By ${esc(r.author.name)}` : "Shared plan"} · ${esc(timeAgo(r.updatedAt || r.at, Date.now()))}</p>
        <h2 class="title">${esc(r.title)}</h2>
        <p class="psum">${esc(r.summary)}</p>
      </header>
      ${M.error ? `<p class="gwarn" role="alert">${esc(M.error)}</p>` : ""}
      ${mine ? `<p class="gnote">This is the shared copy of your plan.</p>`
        : saved ? `<button type="button" class="cta" data-act="m-mine" data-plan="${saved.id}">Open my copy</button><p class="foot">You saved this plan already.</p>`
        : `<button type="button" class="cta" data-act="m-save">Save to my plans</button><p class="foot">You get your own copy, which you can use and change. It stays on your phone.</p>`}
      ${M.plan.weeks.map((w) => `
        <h3 class="pweekname">${esc(w.title)}</h3>
        ${w.days.map((d) => `
          <p class="pdayname">${esc(d.title)}</p>
          <ul class="card list">${d.items.map((it) => `<li><span class="lname">${esc(it.name)}</span><span class="rx">${esc(fmtItem(it))}</span></li>`).join("")}</ul>`).join("")}`).join("")}
      ${mine ? `<button type="button" class="quiet danger" data-act="m-remove">Remove shared copy</button>`
        : `<button type="button" class="quiet" data-act="m-report">Report this plan</button>`}
    </section>`;
}

/* ---------- typing and tapping ---------- */

export function marketSubmit(form) {
  if (form.dataset.form !== "m-search") return;
  M.q = String(new FormData(form).get("q") || "");
  M.list = null;
  ctx.render();
  loadList();
}

export async function marketClick(act, btn) {
  if (act === "m-find") {
    M.view = "list";
    M.list = null;
    M.q = "";
    M.error = "";
    ctx.goPlan();
    ctx.toTop();
    if (me()) loadList();
  } else if (act === "m-close") {
    closeMarket();
    ctx.render();
    ctx.toTop();
  } else if (act === "m-gogroups") {
    closeMarket();
    ctx.goGroups();
  } else if (act === "m-open") {
    openPlan(btn.dataset.id, "list");
  } else if (act === "m-view") {
    // From a post in a feed.
    openPlan(btn.dataset.plan, "groups");
  } else if (act === "m-back") {
    if (M.from === "groups") { closeMarket(); ctx.render(); ctx.toTop(); return; }
    M.view = "list";
    M.row = null;
    M.plan = null;
    M.error = "";
    ctx.render();
    ctx.toTop();
    if (me() && M.list == null) loadList();
  } else if (act === "m-save") {
    if (!M.plan) return;
    const tier = (ctx.myTier?.() ?? "free");
    const code = planBlock(tier, plans.all(), "saved");
    if (code) { M.error = limitText(code, tier); ctx.render(); return; }
    if (!plans.add(M.plan)) { M.error = "You have 100 plans, the most an account can keep. Delete one first."; ctx.render(); return; }
    const id = M.plan.id;
    closeMarket();
    ctx.goPlan();
    plans.open(id, "Saved to your plans. Tap Use this plan to switch to it.");
  } else if (act === "m-mine") {
    closeMarket();
    ctx.goPlan();
    plans.open(btn.dataset.plan, "");
  } else if (act === "m-report") {
    if (!M.row || !ctx.armed(btn, "Tap again to report")) return;
    btn.disabled = true;
    try {
      await rpc("report_plan", { p_plan: M.row.id, p_reason: "" });
      btn.textContent = "Reported. Thanks.";
    } catch (e) {
      btn.disabled = false;
      M.error = words(e);
      ctx.render();
    }
  } else if (act === "m-remove") {
    if (!M.row || !ctx.armed(btn, "Tap again: its posts go too")) return;
    btn.disabled = true;
    try {
      await rest(`plans?id=eq.${M.row.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      const own = plans.byPub(M.row.id);
      if (own) plans.patch(own.id, { pub: null, listed: false, stale: false });
      M.list = null;
      M.view = M.from === "groups" ? null : "list";
      M.row = null;
      M.plan = null;
      ctx.render();
      ctx.toTop();
      if (M.view === "list") loadList();
    } catch (e) {
      btn.disabled = false;
      M.error = words(e);
      ctx.render();
    }
  } else if (act === "m-share") {
    await shareStep(btn.dataset.plan, async (plan) => {
      const id = await sendUp(plan);
      const up = planUpload(plans.get(plan.id));
      startShare("plan", { title: up.row.title, summary: up.row.summary }, { plan_id: id });
      ctx.toTop();
    });
  } else if (act === "m-list") {
    await shareStep(btn.dataset.plan, (plan) => sendUp(plan, { listed: !(plan.pub && plan.listed) }));
  } else if (act === "m-update") {
    await shareStep(btn.dataset.plan, (plan) => sendUp(plan));
  }
}
