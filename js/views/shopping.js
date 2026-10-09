import { h, mount, busy, toast } from "../ui.js";
import { getList, listItems, generateList, setChecked, addManualItem, removeItem, clearChecked } from "../api.js";
import { categoryLabel, CATEGORIES, formatQuantity } from "../units.js";
import { iso, addDays, startOfWeek, parseISO, dateLabel } from "../dates.js";

export async function render(root, [from, to]) {
  const list = await getList();
  let msg = "";
  if (from && to) {
    try { const n = await generateList(list.id, from, to); msg = `Built from your plan for ${dateLabel(parseISO(from))} – ${dateLabel(parseISO(to))}: ${n} item${n === 1 ? "" : "s"}.`; }
    catch (e) { toast(e.message, true); }
    history.replaceState(null, "", "#/shopping");
  }
  const items = await listItems(list.id);
  const redraw = () => render(root, []);

  const groups = CATEGORIES.map(([k]) => [k, items.filter((i) => i.category === k)]).filter(([, a]) => a.length);
  const body = groups.map(([k, arr]) => h("section", {}, h("h3.cat-h", {}, categoryLabel(k)),
    arr.sort((a, b) => a.checked - b.checked || a.name.localeCompare(b.name)).map((i) => {
      const cb = h("input", { type: "checkbox", id: `i${i.id}`, checked: i.checked, onchange: async (e) => { row.classList.toggle("done", e.target.checked); try { await setChecked(i.id, e.target.checked); } catch (x) { toast(x.message, true); } } });
      const row = h("div.shop-item" + (i.checked ? ".done" : ""), {}, cb,
        h("label.nm", { for: `i${i.id}` }, i.name), h("span.q", {}, formatQuantity(i.quantity, i.unit)),
        i.is_manual ? h("button.btn.small.ghost", { "aria-label": `Remove ${i.name}`, onclick: async () => { await removeItem(i.id); redraw(); } }, "✕") : null);
      return row;
    })));

  const add = h("input", { type: "text", placeholder: "Add an item, e.g. dishwashing liquid", "aria-label": "New item" });
  const wk = startOfWeek(new Date());
  mount(root,
    h("div.row.spread", {}, h("h1", {}, "Shopping"), h("div.row", {},
      h("a.btn.small", { href: `#/shopping/${iso(wk)}/${iso(addDays(wk, 6))}` }, "Rebuild from this week"),
      items.some((i) => i.checked) ? h("button.btn.small", { onclick: async () => { await clearChecked(list.id); redraw(); } }, "Clear ticked") : null)),
    msg ? h("p.hint", {}, msg) : null,
    h("form.row", { style: "margin:.8rem 0", onsubmit: async (e) => { e.preventDefault(); if (!add.value.trim()) return; try { await addManualItem(list.id, add.value); redraw(); } catch (x) { toast(x.message, true); } } },
      h("div.grow", {}, add), h("button.btn.primary", { type: "submit" }, "Add")),
    items.length ? body : h("div.empty", {}, h("h2", {}, "Nothing to buy yet"), h("p", {}, "Plan some dinners, then build the list from your week. Pantry staples and optional ingredients are skipped."), h("a.btn.primary", { href: "#/plan" }, "Go to the plan")));
}
