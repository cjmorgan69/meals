import { h, mount, busy, toast } from "../ui.js";
import { listRecipes, getRecipe } from "../api.js";
import { printRecipes, phonePrintNote } from "../print.js";

export async function render(root) {
  const recipes = await listRecipes();
  if (!recipes.length) return mount(root, h("div.empty", {}, h("h2", {}, "No recipes yet"), h("p", {}, "Add some recipes, then come back to make a book."), h("a.btn.primary", { href: "#/import" }, "Import a recipe")));
  const picked = new Set(recipes.map((r) => r.id));
  const tags = [...new Set(recipes.flatMap((r) => r.tags))].sort();

  const title = h("input", { type: "text", id: "bt", value: "My recipes", maxlength: 60 });
  const paper = h("select", { id: "bp" }, h("option", { value: "A4" }, "A4"), h("option", { value: "Letter" }, "US Letter"));
  const count = h("span.hint");
  const boxes = new Map();
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const list = h("div.book-pick");
  const order = () => [...list.children].map((el) => el.dataset.id);
  const rowFor = (r) => {
    const cb = h("input", { type: "checkbox", checked: true, "aria-label": `Include ${r.title}`, onchange: (e) => { e.target.checked ? picked.add(r.id) : picked.delete(r.id); upd(); } });
    boxes.set(r.id, cb);
    const row = h("div.pick-row", { "data-id": r.id },
      h("span.grip", { title: "Drag to reorder", "aria-label": "Drag to reorder", onpointerdown: (e) => startDrag(e, row) }, "⠿"),
      cb, h("span.grow", {}, r.title),
      h("button.btn.small.ghost", { "aria-label": `Move ${r.title} up`, onclick: () => nudge(row, -1) }, "↑"),
      h("button.btn.small.ghost", { "aria-label": `Move ${r.title} down`, onclick: () => nudge(row, 1) }, "↓"));
    return row;
  };
  recipes.forEach((r) => list.append(rowFor(r)));
  function nudge(row, dir) {
    const other = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!other) return;
    dir < 0 ? list.insertBefore(row, other) : list.insertBefore(other, row);
    row.querySelector(`button[aria-label^="Move"]:${dir < 0 ? "first" : "last"}-of-type`)?.focus();
  }
  // Drag a recipe by its handle to put it in a different place in the book (mouse or finger).
  function startDrag(e, row) {
    if (e.button > 0) return;
    e.preventDefault();
    row.classList.add("dragging");
    const move = (ev) => {
      const y = ev.clientY;
      if (y < 70) window.scrollBy(0, -12); else if (y > innerHeight - 70) window.scrollBy(0, 12);
      for (const other of list.children) {
        if (other === row) continue;
        const r = other.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom) {
          if (y < r.top + r.height / 2) { if (other.previousElementSibling !== row) list.insertBefore(row, other); }
          else if (other.nextElementSibling !== row) list.insertBefore(row, other.nextElementSibling);
          break;
        }
      }
    };
    const end = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);
      row.classList.remove("dragging");
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  }
  const upd = () => { count.textContent = `${picked.size} of ${recipes.length} selected`; go.disabled = picked.size === 0; };
  const setAll = (ids) => { picked.clear(); ids.forEach((i) => picked.add(i)); boxes.forEach((cb, id) => { cb.checked = picked.has(id); }); upd(); };
  const go = h("button.btn.primary", { onclick: () => busy(go, async () => {
    const full = [];
    for (const id of order().filter((i) => picked.has(i))) { const f = await getRecipe(id); if (f) full.push(f); }
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
      h("p.hint", {}, "Tick the recipes you want, then drag ⠿ (or use ↑ ↓) to set the order they appear in the book."), list,
      h("div.row.spread", { style: "margin-top:1rem" }, count, go)),
    phonePrintNote(), h("p.hint", { style: "margin-top:1rem" }, "Your browser's print window opens. Choose “Save as PDF” as the destination. Turn off “Headers and footers” for a cleaner page."));
  upd();
}
