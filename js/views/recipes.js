import { h, mount, loading } from "../ui.js";
import { listRecipes, photoUrl } from "../api.js";

export async function render(root) {
  const recipes = await listRecipes();
  let q = "", onlyFav = false;
  const grid = h("div.grid");
  const search = h("input", { type: "search", placeholder: "Search recipes or tags", "aria-label": "Search recipes", oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } });
  const fav = h("button.btn.small", { "aria-pressed": "false", onclick: () => { onlyFav = !onlyFav; fav.setAttribute("aria-pressed", String(onlyFav)); fav.classList.toggle("primary", onlyFav); draw(); } }, "★ Favourites");

  function draw() {
    const shown = recipes.filter((r) => (!onlyFav || r.is_favourite) && (!q || `${r.title} ${r.tags.join(" ")}`.toLowerCase().includes(q)));
    mount(grid, shown.map(tile));
    if (!shown.length && recipes.length) mount(grid, h("p.empty", {}, "No recipes match."));
  }
  function tile(r) {
    const pic = h("div.pic", {}, "🍲");
    if (r.image_path) photoUrl(r.image_path).then((u) => { if (u) mount(pic, h("img", { src: u, alt: "", loading: "lazy" })); });
    const mins = (r.prep_minutes || 0) + (r.cook_minutes || 0);
    return h("a.tile", { href: `#/recipe/${r.id}` }, pic, h("div.body", {},
      h("div.title", {}, r.is_favourite ? "★ " : "", r.title),
      h("div.meta", {}, [mins ? `${mins} min` : null, `serves ${r.servings}`, r.times_cooked ? `cooked ${r.times_cooked}×` : null].filter(Boolean).join(" · "))));
  }

  mount(root,
    h("div.row.spread", {}, h("h1", {}, "Recipes"),
      h("div.row", {}, recipes.length ? h("a.btn", { href: "#/book" }, "Make a book") : null, h("a.btn", { href: "#/edit/new" }, "Write one"), h("a.btn.primary", { href: "#/import" }, "Import a recipe"))),
    recipes.length ? h("div.row", {}, h("div.grow", {}, search), fav) : null,
    recipes.length ? h("div", { style: "margin-top:1rem" }, grid) : h("div.empty", {},
      h("h2", {}, "Add your first recipe"),
      h("p", {}, "Import one from a web link, a photo of a cookbook page, or pasted text. Or type it in yourself."),
      h("a.btn.primary", { href: "#/import" }, "Import a recipe")));
  if (recipes.length) draw();
}
