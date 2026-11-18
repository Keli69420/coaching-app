// Every call to the Groups server (Supabase) goes through here: signing in, and reading and
// writing groups and posts. Plain fetch, no library. The rules that decide who sees what live on
// the server (supabase/migrations); this file only asks.

import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { authError } from "./share-logic.js";

export const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);
const SESSION_KEY = "pathletics.session"; // the sign-in, on this phone; never the password
const TIMEOUT_MS = 12000;

// A failed call, sorted by what the page should say about it.
//   offline: no answer at all · down: the server is broken or asleep · auth: needs signing in again
//   bad: the server said no (message, when there is one, is already in words)
export class NetError extends Error {
  constructor(kind, message = "", status = 0, body = null) {
    super(message || kind);
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}

export function errText(e) {
  if (e?.kind === "offline") return "No signal. Groups needs the internet; your workouts still save.";
  if (e?.kind === "down") return "Groups can't be reached right now. Your workouts still save.";
  if (e?.kind === "auth") return "Please sign in again.";
  return e?.kind === "bad" && e.message !== "bad" ? e.message : "Something went wrong. Try again.";
}

/* ---------- the sign-in on this phone ---------- */

let session = readSession();

function readSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (s && typeof s.access_token === "string" && typeof s.refresh_token === "string"
      && Number.isFinite(s.expires_at) && typeof s.user?.id === "string") return s;
  } catch { /* unreadable: signed out */ }
  return null;
}

function writeSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* still signed in for this visit */ }
}

const keep = (d) => ({
  access_token: d.access_token,
  refresh_token: d.refresh_token,
  expires_at: Number.isFinite(d.expires_at) ? d.expires_at : Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
  user: { id: String(d.user?.id || ""), email: String(d.user?.email || "") },
});

// Who is signed in on this phone: { id, email }, or null.
export const me = () => session?.user ?? null;
export const forget = () => writeSession(null);

/* ---------- talking to the server ---------- */

async function send(path, { method = "GET", body, token, headers = {} } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, {
      method,
      signal: ctl.signal,
      headers: {
        apikey: SUPABASE_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetError("offline");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: an error page */ }
  if (res.ok) return data;
  if (res.status >= 500) throw new NetError("down", "", res.status, data);
  if (res.status === 401) throw new NetError("auth", "", 401, data);
  throw new NetError("bad", "", res.status, data);
}

// A sign-in lasts an hour; it's renewed just before it runs out. Two calls at once share one renewal.
let renewing = null;
function renew() {
  if (!session) return Promise.reject(new NetError("auth"));
  renewing ??= send("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token } })
    .then((d) => { writeSession(keep(d)); return session.access_token; })
    .catch((e) => {
      if (e.kind === "bad" || e.kind === "auth") { writeSession(null); throw new NetError("auth"); }
      throw e;
    })
    .finally(() => { renewing = null; });
  return renewing;
}

async function token() {
  if (!session) throw new NetError("auth");
  if (session.expires_at * 1000 - 60000 > Date.now()) return session.access_token;
  return renew();
}

async function signedIn(path, opts) {
  try {
    return await send(path, { ...opts, token: await token() });
  } catch (e) {
    if (e.kind !== "auth" || !session) throw e;
    return send(path, { ...opts, token: await renew() }); // the server said the sign-in ran out: once more
  }
}

// Tables: rest("posts?select=…"), rest("posts", { method: "POST", body }).
export const rest = (path, opts = {}) => signedIn(`/rest/v1/${path}`, opts);
// The server's own actions: rpc("join_with_code", { p_code, p_name }).
export const rpc = (fn, args = {}) => signedIn(`/rest/v1/rpc/${fn}`, { method: "POST", body: args });

/* ---------- signing up, in and out ---------- */

const inWords = (e) => (e.kind === "bad" || e.kind === "auth" ? new NetError("bad", authError(e.status, e.body), e.status) : e);

// The invite code goes along so the server can turn away anyone without one.
export async function signUp(email, password, invite) {
  let d;
  try {
    d = await send("/auth/v1/signup", { method: "POST", body: { email, password, data: { invite } } });
  } catch (e) {
    throw inWords(e);
  }
  // No sign-in back means the server still wants emails confirmed (see README, Groups setup).
  if (!d?.access_token) throw new NetError("bad", "This account isn't switched on yet. Ask your coach.");
  writeSession(keep(d));
}

export async function signIn(email, password) {
  try {
    writeSession(keep(await send("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } })));
  } catch (e) {
    throw inWords(e);
  }
}

export function signOut() {
  const t = session?.access_token;
  writeSession(null);
  if (t) send("/auth/v1/logout?scope=local", { method: "POST", token: t }).catch(() => {});
}
