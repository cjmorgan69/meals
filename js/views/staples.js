import { h, mount, busy, toast } from "../ui.js";
import { getStaples, saveRecipe, STAPLES_TAG } from "../api.js";
import { UNITS, formatNumber, parseQuantity } from "../units.js";
import { stripQuantity, ingredientName, composeLine } from "../ingredient-text.js";

const COMMON = ["milk", "bread", "eggs", "butter", "cheese", "yoghurt", "bananas", "apples", "potatoes", "onions", "carrots",
  "tomatoes", "lettuce", "cereal", "rice", "pasta", "coffee", "tea", "toilet paper", "paper towels", "dishwashing liquid", "laundry powder"];

// Household staples: the things you buy every week. Stored as an ordinary recipe (kept out of the recipe book).
export async function render(root) {
  const existing = await getStaples();
  const rows = (existing?.ingredients ?? []).map((i) => ({
    label: stripQuantity(i.raw_text || ""), qtyText: i.quantity != null ? formatNumber(Number(i.quantity)) : "", unit: i.unit || null,
  }));
  const has = (name) => rows.some((r) => r.label.trim().toLowerCase() === name);

  const listBox = h("div"), chipBox = h("div.row.chips"), err = h("p.error", { role: "alert" });

  function drawRows() {
    mount(listBox, rows.length ? rows.map((r, n) => h("div.ed-row", {},
      h("input", { type: "text", inputmode: "decimal", "aria-label": "Quantity", placeholder: "Qty", value: r.qtyText, oninput: (e) => { r.qtyText = e.target.value; } }),
      h("select", { "aria-label": "Unit", onchange: (e) => { r.unit = e.target.value || null; } }, UNITS.map((u) => h("option", { value: u, selected: (r.unit || "") === u }, u || "—"))),
      h("input", { type: "text", "aria-label": "Item", value: r.label, oninput: (e) => { r.label = e.target.value; } }),
      h("button.btn.small.ghost", { type: "button", "aria-label": `Remove ${r.label}`, onclick: () => { rows.splice(n, 1); drawAll(); } }, "✕")))
      : h("p.hint", {}, "Nothing here yet. Tap the suggestions above or type your own."));
  }
  function drawChips() {
    mount(chipBox, COMMON.map((c) => h("button.btn.small" + (has(c) ? ".primary" : ""), { type: "button", "aria-pressed": String(has(c)),
      onclick: () => { if (has(c)) rows.splice(rows.findIndex((r) => r.label.trim().toLowerCase() === c), 1); else rows.push({ label: c, qtyText: "", unit: null }); drawAll(); } }, c)));
  }
  const drawAll = () => { drawRows(); drawChips(); };

  const add = h("input", { type: "text", placeholder: "Add your own, e.g. cat food", "aria-label": "Add an item" });
  const addForm = h("form.row", { style: "margin:.8rem 0", onsubmit: (e) => {
    e.preventDefault(); const v = add.value.trim(); if (!v) return;
    if (!has(v.toLowerCase())) rows.push({ label: v, qtyText: "", unit: null });
    add.value = ""; drawAll();
  } }, h("div.grow", {}, add), h("button.btn", { type: "submit" }, "Add"));

  const save = h("button.btn.primary", { type: "button", onclick: () => {
    err.textContent = "";
    const ingredients = [];
    for (const r of rows) {
      const label = r.label.trim(); if (!label) continue;
      const q = parseQuantity(r.qtyText);
      if (Number.isNaN(q)) { err.textContent = `“${r.qtyText}” isn't a quantity. Use a number like 2, 1/2 or 1.5.`; return; }
      ingredients.push({ raw_text: composeLine(q, r.unit, label), name: ingredientName(label), quantity: q, unit: r.unit, optional: false });
    }
    busy(save, async () => {
      await saveRecipe({ title: "Household staples", description: "", servings: 1, tags: [STAPLES_TAG], source: "manual", ingredients, steps: [] }, existing?.id);
      toast("Saved");
      location.hash = "#/shopping";
    });
  } }, "Save staples");

  mount(root, h("p", {}, h("a", { href: "#/shopping" }, "‹ Shopping")), h("h1", {}, "Household staples"),
    h("div.card", {},
      h("p.hint", {}, "The things you buy every week. They join your shopping list each time, and you can switch them off from the Shopping screen."),
      h("h3", {}, "Tap to add"), chipBox, addForm,
      h("h3", {}, "Your staples"), listBox, err,
      h("div.row.end", { style: "margin-top:1rem" }, h("a.btn", { href: "#/shopping" }, "Cancel"), save)));
  drawAll();
}
