import { h, mount, busy, toast } from "../ui.js";
import { listRecipes, getRecipe } from "../api.js";
import { printRecipes } from "../print.js";

export async function render(root) {
  const recipes = await listRecipes();
  if (!recipes.length) return mount(root, h("div.empty", {}, h("h2", {}, "No recipes yet"), h("p", {}, "Add some recipes, then come back to make a book."), h("a.btn.primary", { href: "#/import" }, "Import a recipe")));
  const picked = new Set(recipes.map((r) => r.id));
  const tags = [...new Set(recipes.flatMap((r) => r.tags))].sort();

  const title = h("input", { type: "text", id: "bt", value: "My recipes", maxlength: 60 });
  const paper = h("select", { id: "bp" }, h("option", { value: "A4" }, "A4"), h("option", { value: "Letter" }, "US Letter"));
  const count = h("span.hint");
  const boxes = new Map();
  const rows = recipes.map((r) => {
    const cb = h("input", { type: "checkbox", checked: true, onchange: (e) => { e.target.checked ? picked.add(r.id) : picked.delete(r.id); upd(); } });
    boxes.set(r.id, cb);
    return h("label", {}, cb, r.title);
  });
  const upd = () => { count.textContent = `${picked.size} of ${recipes.length} selected`; go.disabled = picked.size === 0; };
  const setAll = (ids) => { picked.clear(); ids.forEach((i) => picked.add(i)); boxes.forEach((cb, id) => { cb.checked = picked.has(id); }); upd(); };
  const go = h("button.btn.primary", { onclick: () => busy(go, async () => {
    const full = [];
    for (const r of recipes.filter((x) => picked.has(x.id))) { const f = await getRecipe(r.id); if (f) full.push(f); }
    if (!full.length) { toast("Pick at least one recipe", true); return; }
    await printRecipes(full, { title: title.value.trim() || "My recipes", paper: paper.value });
  }) }, "Make PDF");

  mount(root,
    h("p", {}, h("a", { href: "#/recipes" }, "‹ Recipes")),
    h("h1", {}, "Make a recipe book"),
    h("div.card", {},
      h("div.row", {}, h("div.field.grow", {}, h("label", { for: "bt" }, "Book title"), title), h("div.field", {}, h("label", { for: "bp" }, "Paper"), paper)),
      h("div.row", { style: "margin-bottom:.6rem" },
        h("button.btn.small", { onclick: () => setAll(recipes.map((r) => r.id)) }, "All"),
        h("button.btn.small", { onclick: () => setAll([]) }, "None"),
        h("button.btn.small", { onclick: () => setAll(recipes.filter((r) => r.is_favourite).map((r) => r.id)) }, "★ Favourites"),
        tags.slice(0, 8).map((t) => h("button.btn.small", { onclick: () => setAll(recipes.filter((r) => r.tags.includes(t)).map((r) => r.id)) }, t))),
      h("div.book-pick", {}, rows),
      h("div.row.spread", { style: "margin-top:1rem" }, count, go)),
    h("p.hint", { style: "margin-top:1rem" }, "Your browser's print window opens. Choose “Save as PDF” as the destination. Turn off “Headers and footers” for a cleaner page."));
  upd();
}
