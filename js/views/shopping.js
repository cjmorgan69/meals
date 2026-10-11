import { h, mount, busy, toast, confirmBox } from "../ui.js";
import { getList, listItems, generateList, setChecked, addManualItem, removeItem, clearChecked, clearAllItems, recipeTitles, getStaples, applyStaples } from "../api.js";
import { categoryLabel, categoryIcon, CATEGORIES, formatQuantity } from "../units.js";
import { fmtShop } from "../shopamount.js";
import { cleanDisplayName } from "../ingredient-text.js";
import { iso, addDays, parseISO, dateLabel } from "../dates.js";

const getPref = () => { try { return localStorage.getItem("shopView") === "meal" ? "meal" : "aisle"; } catch { return "aisle"; } };
const setPref = (v) => { try { localStorage.setItem("shopView", v); } catch { /* ignore */ } };

const getStaplesPref = () => { try { return localStorage.getItem("useStaples") !== "off"; } catch { return true; } };
const setStaplesPref = (v) => { try { localStorage.setItem("useStaples", v ? "on" : "off"); } catch { /* ignore */ } };

export async function render(root, [fromArg, toArg]) {
  const list = await getList();
  let staples = await getStaples().catch(() => null);
  let useStaples = getStaplesPref();
  let items = await listItems(list.id);
  let view = getPref();
  let titles = await recipeTitles([...new Set(items.flatMap((i) => i.source_recipe_ids || []))]);
  let msg = "";

  const today = new Date();
  // Date range: from the link, else the range last used for this list, else the next 7 days.
  let from = fromArg || list.date_from || iso(today);
  let to = toArg || list.date_to || iso(addDays(today, 6));
  if (to < from) to = from;
  history.replaceState(null, "", "#/shopping");

  // ---- build-from-plan panel ----
  const fromIn = h("input", { type: "date", id: "df", value: from, "aria-label": "From" });
  const toIn = h("input", { type: "date", id: "dt", value: to, "aria-label": "To" });
  const err = h("p.error", { role: "alert" });
  const preset = (label, days) => h("button.btn.small", { type: "button", onclick: () => { fromIn.value = iso(today); toIn.value = iso(addDays(today, days - 1)); } }, label);
  const build = h("button.btn.primary", { type: "submit" }, "Build list");
  const panel = h("form.card", { onsubmit: (e) => {
    e.preventDefault(); err.textContent = "";
    if (!fromIn.value || !toIn.value) { err.textContent = "Pick a start and end date."; return; }
    if (toIn.value < fromIn.value) { err.textContent = "The end date is before the start date."; return; }
    busy(build, async () => {
      const n = await generateList(list.id, fromIn.value, toIn.value);
      if (useStaples && staples) await applyStaples(list.id, staples, true); // a rebuild clears them, so put them back
      from = fromIn.value; to = toIn.value;
      items = await listItems(list.id);
      titles = await recipeTitles([...new Set(items.flatMap((i) => i.source_recipe_ids || []))]);
      msg = n ? `Built from your plan for ${dateLabel(parseISO(from))} – ${dateLabel(parseISO(to))}: ${n} item${n === 1 ? "" : "s"}.`
        : `Nothing planned between ${dateLabel(parseISO(from))} and ${dateLabel(parseISO(to))}. Add meals in the Plan tab first.`;
      drawAll();
    }, { onError: (x) => { err.textContent = x.message; } });
  } },
    h("h2", {}, "Build from your plan"),
    h("div.row", {}, h("div.field", {}, h("label", { for: "df" }, "From"), fromIn), h("div.field", {}, h("label", { for: "dt" }, "To"), toIn)),
    h("div.row", { style: "margin-bottom:.8rem" }, preset("Today", 1), preset("Next 3 days", 3), preset("Next 7 days", 7), preset("Next 14 days", 14)),
    h("p.hint", {}, "Rebuilding replaces the list built from your plan. Items you added yourself stay."),
    err, build);

  // ---- list ----
  const msgBox = h("p.hint"), listBox = h("div"), toolbar = h("div.row.spread");

  const sortItems = (arr) => [...arr].sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name));

  function itemRow(i, showMeals) {
    const cb = h("input", { type: "checkbox", id: `i${i.id}-${showMeals ? "m" : "a"}`, checked: i.checked, onchange: async (e) => {
      const v = e.target.checked, prev = i.checked;
      i.checked = v; drawList(); // ticked items drop to the bottom straight away
      try { await setChecked(i.id, v); } catch (x) { i.checked = prev; drawList(); toast(x.message, true); }
    } });
    const others = showMeals ? [] : (i.source_recipe_ids || []).map((id) => titles.get(id)).filter(Boolean);
    const shown = cleanDisplayName(i.name); // old items may carry the amount in the name
    return h("div.shop-item" + (i.checked ? ".done" : ""), {}, cb,
      h("label.nm", { for: cb.id }, shown, others.length > 1 ? h("span.hint", { style: "display:block;font-size:.8rem" }, others.join(", ")) : null),
      h("span.q", {}, fmtShop(shown, i.quantity, i.unit)),
      i.is_manual ? h("button.btn.small.ghost", { "aria-label": `Remove ${i.name}`, onclick: async () => { try { await removeItem(i.id); items = items.filter((x) => x.id !== i.id); drawList(); } catch (x) { toast(x.message, true); } } }, "✕") : null);
  }

  function drawList() {
    const open = items.filter((i) => !i.checked).length;
    mount(toolbar,
      h("div.tabs", { role: "tablist", style: "margin:0;border:0" },
        h("button", { role: "tab", "aria-selected": String(view === "aisle"), onclick: () => { view = "aisle"; setPref(view); drawList(); } }, "By aisle"),
        h("button", { role: "tab", "aria-selected": String(view === "meal"), onclick: () => { view = "meal"; setPref(view); drawList(); } }, "By meal")),
      h("div.row", {}, h("span.hint", {}, items.length ? `${open} to get` : ""),
        items.some((i) => i.checked) ? h("button.btn.small", { onclick: async () => { try { await clearChecked(list.id); items = items.filter((i) => !i.checked); drawList(); } catch (x) { toast(x.message, true); } } }, "Clear ticked") : null,
        items.length ? h("button.btn.small", { onclick: async () => {
          if (!(await confirmBox("Clear the whole list?", "Every item comes off the list, ticked or not. Your meal plan is not changed.", "Clear list"))) return;
          try { await clearAllItems(list.id); items = []; msg = "List cleared."; msgBox.textContent = msg; drawList(); } catch (x) { toast(x.message, true); }
        } }, "Clear list") : null));

    if (!items.length) {
      mount(listBox, h("div.empty", {}, h("h2", {}, "Nothing to buy yet"), h("p", {}, "Choose your dates above and build the list from your plan, or add items by hand.")));
      return;
    }
    if (view === "aisle") {
      // Everything still to buy, aisle by aisle; everything ticked sinks to one block at the very bottom.
      const todo = CATEGORIES.map(([k]) => [k, sortItems(items.filter((i) => i.category === k && !i.checked))]).filter(([, a]) => a.length);
      const got = CATEGORIES.flatMap(([k]) => sortItems(items.filter((i) => i.category === k && i.checked)));
      mount(listBox,
        todo.map(([k, arr]) => h("section", {}, h("h3.cat-h", {}, h("span.cat-ic", { "aria-hidden": "true" }, categoryIcon(k)), categoryLabel(k)), arr.map((i) => itemRow(i, false)))),
        got.length ? h("section.got", {}, h("h3.cat-h", {}, h("span.cat-ic", { "aria-hidden": "true" }, "✅"), `In the trolley (${got.length})`), got.map((i) => itemRow(i, false))) : null);
    } else {
      const groups = new Map(); // recipe id (or "other") -> items
      for (const i of items) {
        const ids = (i.source_recipe_ids || []).filter((id) => titles.has(id));
        for (const id of ids.length ? ids : ["other"]) {
          if (!groups.has(id)) groups.set(id, []);
          groups.get(id).push(i);
        }
      }
      const order = [...groups.keys()].sort((a, b) => (a === "other") - (b === "other") || (titles.get(a) || "").localeCompare(titles.get(b) || ""));
      mount(listBox, h("p.hint", {}, "An item needed by more than one meal appears under each, with the combined amount. Ticking it ticks it everywhere."),
        order.map((id) => h("section", {}, h("h3.cat-h", {}, h("span.cat-ic", { "aria-hidden": "true" }, id === "other" ? "✍️" : "🍽️"), id === "other" ? "Added by hand" : titles.get(id)), sortItems(groups.get(id)).map((i) => itemRow(i, true)))));
    }
  }

  const add = h("input", { type: "text", placeholder: "Add an item, e.g. dishwashing liquid", "aria-label": "New item" });
  const addForm = h("form.row", { style: "margin:.8rem 0", onsubmit: async (e) => {
    e.preventDefault();
    if (!add.value.trim()) return;
    try { await addManualItem(list.id, add.value); items = await listItems(list.id); add.value = ""; drawList(); } catch (x) { toast(x.message, true); }
  } }, h("div.grow", {}, add), h("button.btn.primary", { type: "submit" }, "Add"));

  // ---- household staples ----
  const staplesBox = h("div.card");
  async function setStaples(on) {
    useStaples = on; setStaplesPref(on);
    try {
      await applyStaples(list.id, staples, on);
      items = await listItems(list.id);
      titles = await recipeTitles([...new Set(items.flatMap((i) => i.source_recipe_ids || []))]);
    } catch (x) { toast(x.message, true); }
    drawAll();
  }
  function drawStaples() {
    if (!staples) {
      mount(staplesBox, h("div.row.spread", {}, h("div", {}, h("strong", {}, "Household staples"),
        h("p.hint", { style: "margin:.2rem 0 0" }, "Things you buy every week, like milk, bread and toilet paper. Set them up once and they join the list each time.")),
        h("a.btn", { href: "#/staples" }, "Set up")));
      return;
    }
    const cb = h("input", { type: "checkbox", id: "stp", checked: useStaples, onchange: (e) => setStaples(e.target.checked) });
    const n = staples.ingredients.filter((i) => !i.optional).length;
    mount(staplesBox, h("div.row.spread", {},
      h("div.row", { style: "gap:.5rem;flex-wrap:nowrap" }, cb, h("label", { for: "stp" }, h("strong", {}, "Include household staples"), h("span.hint", { style: "display:block" }, `${n} item${n === 1 ? "" : "s"}`))),
      h("a.btn.small", { href: `#/edit/${staples.id}` }, "Edit staples")));
  }

  function drawAll() { msgBox.textContent = msg; drawStaples(); drawList(); }

  mount(root, h("h1", {}, "Shopping"), panel, staplesBox, msgBox, h("div", { style: "margin-top:1rem" }, toolbar), addForm, listBox);
  drawAll();
}
