import { sb } from "../supabase.js";
import { h, mount, busy, toast, confirmBox } from "../ui.js";
import { getUsage, setDisplayName, exportAll, deleteAccount, currentUser } from "../api.js";

const KINDS = { photo: "Photo imports", url_ai: "Web link imports (AI fallback)", text: "Text imports", video: "Video imports" };

export async function render(root) {
  const [u, user] = await Promise.all([getUsage(), currentUser()]);
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

  mount(root, h("h1", {}, "Account"),
    h("div.stack", {},
      h("div.card", {}, h("p", {}, "Signed in as ", h("strong", {}, user.email), " ", h("span.chip", {}, u.tier)),
        h("div.field", {}, h("label", { for: "nm" }, "Display name"), name), save),
      h("div.card", {}, h("h2", {}, "Imports this month"), meters.length ? meters : h("p.hint", {}, "No AI imports on this plan."),
        h("p.hint", {}, "Web links from most recipe sites don't use your allowance. Allowances reset on the 1st (UTC).")),
      h("div.card", {}, h("h2", {}, "Your data"), h("div.row", {}, exp, h("button.btn", { onclick: () => sb.auth.signOut() }, "Sign out")),
        h("hr", { style: "border:0;border-top:1px solid var(--line);margin:1rem 0" }), del)));
}
