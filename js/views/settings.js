import { sb } from "../supabase.js";
import { h, mount, busy, toast, confirmBox } from "../ui.js";
import { getUsage, setDisplayName, exportAll, deleteAccount, currentUser, getHousehold, createHousehold, joinHousehold, leaveHousehold, newJoinCode } from "../api.js";

const KINDS = { photo: "Photo imports", url_ai: "Web link imports (AI fallback)", text: "Text imports", video: "Video imports" };

export async function render(root) {
  const [u, user] = await Promise.all([getUsage(), currentUser()]);
  let hh = null, hhError = false;
  try { hh = await getHousehold(); } catch { hhError = true; }
  const again = () => render(root);
  const name = h("input", { type: "text", id: "nm", value: u.name, placeholder: "Your name" });
  const save = h("button.btn", { onclick: () => busy(save, async () => { await setDisplayName(name.value.trim()); toast("Saved"); }) }, "Save");
  const meters = u.limits.filter((l) => l.monthly_limit > 0).map((l) => {
    const used = u.used[l.kind] || 0;
    return h("div", { style: "margin:.6rem 0" }, h("div.row.spread", {}, h("span", {}, KINDS[l.kind] || l.kind), h("span.hint", {}, `${used} of ${l.monthly_limit} used`)),
      h("div.meter", { role: "progressbar", "aria-valuemin": 0, "aria-valuemax": l.monthly_limit, "aria-valuenow": used }, h("i", { style: `width:${Math.min(100, (used / l.monthly_limit) * 100)}%` })));
  });
  const exp = h("button.btn", { onclick: () => busy(exp, async () => {
    const data = await exportAll();
    const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })), download: "recipe-planner-export.json" });
    document.body.append(a); a.click(); a.remove();
  }) }, "Download my data");
  const del = h("button.btn.danger", { onclick: async () => {
    if (!(await confirmBox("Delete your account?", "This permanently deletes your recipes, plans, shopping lists and photos. It can't be undone.", "Delete everything"))) return;
    await busy(del, () => deleteAccount());
  } }, "Delete my account");

  const family = hhError
    ? h("p.hint", {}, "Family sharing isn't set up yet.")
    : hh ? householdCard(hh, again) : joinCard(again);

  mount(root, h("h1", {}, "Account"),
    h("div.stack", {},
      h("div.card", {}, h("p", {}, "Signed in as ", h("strong", {}, user.email), " ", h("span.chip", {}, u.tier)),
        h("div.field", {}, h("label", { for: "nm" }, "Display name"), name), save),
      h("div.card", {}, h("h2", {}, "Family"), family),
      h("div.card", {}, h("h2", {}, "Imports this month"), meters.length ? meters : h("p.hint", {}, "No AI imports on this plan."),
        h("p.hint", {}, "Web links from most recipe sites don't use your allowance. Allowances reset on the 1st (UTC).")),
      h("div.card", {}, h("h2", {}, "Your data"), h("div.row", {}, exp, h("button.btn", { onclick: () => sb.auth.signOut() }, "Sign out")),
        h("hr", { style: "border:0;border-top:1px solid var(--line);margin:1rem 0" }), del)));
}

function householdCard(hh, again) {
  const code = h("p", { style: "font-size:1.6rem;letter-spacing:.2em;font-weight:700;margin:.3rem 0" }, hh.join_code);
  const fresh = h("button.btn.small", { onclick: () => busy(fresh, async () => { await newJoinCode(); toast("New code made"); again(); }) }, "Make a new code");
  const leave = h("button.btn.danger.small", { onclick: async () => {
    if (!(await confirmBox("Leave this household?", "You keep the recipes you added, but you'll stop seeing the others' recipes, plan and shopping list.", "Leave"))) return;
    await busy(leave, async () => { await leaveHousehold(); again(); });
  } }, "Leave household");
  return h("div", {},
    h("p", {}, h("strong", {}, hh.name), " shares recipes, the meal plan and the shopping list."),
    h("ul", { style: "margin:.5rem 0 1rem 1.2rem" }, hh.members.map((m) => h("li", {}, m.name, m.me ? " (you)" : ""))),
    h("p.hint", {}, "To add someone: they sign up, open Account, and enter this code."), code,
    h("div.row", {}, fresh, leave));
}

function joinCard(again) {
  const name = h("input", { type: "text", placeholder: "e.g. The Morgans", "aria-label": "Household name" });
  const make = h("button.btn", { onclick: () => busy(make, async () => { await createHousehold(name.value.trim()); toast("Household created"); again(); }) }, "Create household");
  const code = h("input", { type: "text", placeholder: "Code from a family member", autocapitalize: "characters", "aria-label": "Join code" });
  const join = h("button.btn", { onclick: () => busy(join, async () => {
    if (!code.value.trim()) throw new Error("Enter the code first.");
    await joinHousehold(code.value); toast("Joined"); again();
  }) }, "Join");
  return h("div.stack", {},
    h("p.hint", {}, "Share your recipes, meal plan and shopping list with family. Everyone keeps their own login. Anything you've already added is shared when you create or join."),
    h("div.field", {}, h("label", {}, "Start a household"), name), make,
    h("hr", { style: "border:0;border-top:1px solid var(--line);margin:.5rem 0" }),
    h("div.field", {}, h("label", {}, "Or join one"), code), join);
}
