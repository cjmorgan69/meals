import { sb } from "./supabase.js";
import { h, mount, loading, toast } from "./ui.js";
import { state } from "./state.js";

const root = document.getElementById("app");
const ROUTES = {
  recipes: () => import("./views/recipes.js"),
  recipe: () => import("./views/recipe.js"),
  edit: () => import("./views/editor.js"),
  import: () => import("./views/import.js"),
  plan: () => import("./views/planner.js"),
  shopping: () => import("./views/shopping.js"),
  settings: () => import("./views/settings.js"),
};
let shell = null, outlet = null, navLinks = {}, renderToken = 0;

function buildShell() {
  const tabs = [["recipes", "Recipes"], ["plan", "Plan"], ["shopping", "Shopping"], ["settings", "Account"]];
  navLinks = {};
  const nav = h("nav.nav", { "aria-label": "Main" }, tabs.map(([k, label]) => (navLinks[k] = h("a", { href: `#/${k}` }, label))));
  outlet = h("main", { id: "main" });
  shell = h("div.shell", {}, h("header.topbar", {}, h("a.brand", { href: "#/recipes" }, "Recipe Planner"), nav), outlet);
  mount(root, shell);
}

async function route() {
  const token = ++renderToken;
  const user = state.user;
  if (!user) { const m = await import("./views/auth.js"); if (token === renderToken) { shell = null; m.render(root); } return; }
  if (!shell || !root.contains(shell)) buildShell();
  const [path = "recipes", ...rest] = (location.hash.replace(/^#\/?/, "") || "recipes").split("/");
  const name = ROUTES[path] ? path : "recipes";
  const section = { recipe: "recipes", edit: "recipes", import: "recipes" }[name] || name;
  for (const [k, a] of Object.entries(navLinks)) (k === section ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  mount(outlet, loading());
  try {
    const mod = await ROUTES[name]();
    if (token !== renderToken) return;
    await mod.render(outlet, rest);
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    if (token === renderToken) mount(outlet, h("div.empty", {}, h("h2", {}, "That didn't load"), h("p.error", {}, e.message || "Unknown error"), h("button.btn", { onclick: route }, "Try again")));
  }
}

let lastUserId = undefined;
sb.auth.onAuthStateChange((_event, session) => {
  const id = session?.user?.id ?? null;
  state.user = session?.user ?? null;
  if (id !== lastUserId) { lastUserId = id; if (!id) { state.draft = null; } route(); }
});
window.addEventListener("hashchange", route);
// If supabase-js doesn't fire an initial event quickly, fall back to the stored session.
sb.auth.getSession().then(({ data }) => { if (lastUserId === undefined) { state.user = data.session?.user ?? null; lastUserId = state.user?.id ?? null; route(); } });

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
window.addEventListener("unhandledrejection", (e) => { console.error(e.reason); });
export { toast };
