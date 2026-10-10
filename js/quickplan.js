import { h, mount, modal, toast, busy } from "./ui.js";
import { addPlan } from "./api.js";
import { iso, addDays, dayLabel, dateLabel } from "./dates.js";

/** Small picker: tap a day to add the recipe to the plan. onAdded runs after a successful add. */
export function quickPlan(recipe, onAdded) {
  modal((box, close) => {
    const today = new Date();
    const meal = h("select", { id: "qm", "aria-label": "Meal" }, ["dinner", "lunch", "breakfast", "snack"].map((m) => h("option", { value: m }, m[0].toUpperCase() + m.slice(1))));
    const add = async (date, btn) => busy(btn, async () => {
      await addPlan(recipe.id, iso(date), meal.value);
      toast(`Added to ${dateLabel(date)}`);
      close();
      onAdded?.();
    });
    const label = (d, n) => (n === 0 ? "Today" : n === 1 ? "Tomorrow" : `${dayLabel(d)} ${d.getDate()}`);
    const days = Array.from({ length: 7 }, (_, n) => addDays(today, n));
    const other = h("input", { type: "date", "aria-label": "Another date", value: iso(addDays(today, 7)) });
    const otherBtn = h("button.btn", { onclick: () => other.value && add(new Date(other.value + "T00:00"), otherBtn) }, "Add");
    mount(box,
      h("h2", {}, "Add to plan"),
      h("p.hint", {}, recipe.title),
      h("div.field", {}, h("label", { for: "qm" }, "Meal"), meal),
      h("div.row", {}, days.map((d, n) => h("button.btn.small", { onclick: (e) => add(d, e.currentTarget) }, label(d, n)))),
      h("div.row", { style: "margin-top:1rem" }, h("div.grow", {}, other), otherBtn),
      h("div.row.end", { style: "margin-top:1rem" }, h("button.btn", { onclick: close }, "Cancel")));
  });
}
