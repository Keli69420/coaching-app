// Who may do what: the free account and the coach account (Keli, 18 Nov).
// Free accounts build 1 plan and keep 5 saved from others; coaches get up to 100 plans in all.
// Pure parts, tested in tests/coach-logic.test.mjs. Plans already on a phone are never removed:
// these limits only ever block adding. A plan a coach assigned (it carries `asg`) never counts.

const FREE = { built: 1, saved: 5, total: 6, groups: 1, groupSize: 10, kind: "friends" };
const COACH = { built: 100, saved: 100, total: 100, groups: 10, groupSize: 50, kind: "coaching" };

export const cleanTier = (t) => (t === "coach" ? "coach" : "free");

export const limitsFor = (tier) => ({ ...(cleanTier(tier) === "coach" ? COACH : FREE) });

// Sorts plans into the ones he built, the ones saved from someone else (`by` or `src`, which a
// duplicate of a saved plan loses: copyPlan drops both), and the ones a coach assigned.
export function countPlans(plans) {
  const n = { built: 0, saved: 0, assigned: 0 };
  for (const p of Array.isArray(plans) ? plans : []) {
    if (!p || typeof p !== "object" || Array.isArray(p)) continue;
    if (p.asg) n.assigned++;
    else if (p.by || p.src) n.saved++;
    else n.built++;
  }
  return n;
}

// null when he may add one more of `kind` ("built" | "saved"), else the reason: "built" | "saved" | "total".
export function planBlock(tier, plans, kind) {
  const lim = limitsFor(tier);
  const n = countPlans(plans);
  if (cleanTier(tier) === "coach" && n.built + n.saved >= lim.total) return "total";
  if (kind === "saved") return n.saved >= lim.saved ? "saved" : null;
  return n.built >= lim.built ? "built" : null;
}

export const groupBlock = (tier, ownedCount) => (Number(ownedCount) >= limitsFor(tier).groups ? "groups" : null);

export function limitText(code, tier) {
  const free = cleanTier(tier) === "free";
  const lim = limitsFor(tier);
  if (code === "built" && free) return `Free accounts build ${lim.built} plan. Coaches can make as many as they like.`;
  if (code === "saved" && free) return `Free accounts keep ${lim.saved} saved plans. Delete one to save another.`;
  if (code === "total") return `You have ${lim.total} plans, the most an account can keep. Delete one first.`;
  if (code === "groups") {
    return free ? `Free accounts can make ${lim.groups} group. Coaches can make up to ${limitsFor("coach").groups}.`
      : `You have ${lim.groups} groups, the most a coach can make.`;
  }
  return "You've reached the limit for your account.";
}
