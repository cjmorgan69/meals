import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuantity, formatQuantity, formatNumber } from "../js/units.js";
import { guessCategory } from "../js/categories.js";
import { iso, startOfWeek, addDays } from "../js/dates.js";
import { stripQuantity, ingredientName, composeLine, cleanDisplayName } from "../js/ingredient-text.js";
import { shopAmount, fmtShop } from "../js/shopamount.js";
import { summariseUsage } from "../js/usage.js";
import { scoreRecipe, suggest, regulars } from "../js/weather.js";

test("parseQuantity", () => {
  assert.equal(parseQuantity(""), null);
  assert.equal(parseQuantity("2"), 2);
  assert.equal(parseQuantity("1 1/2"), 1.5);
  assert.equal(parseQuantity("½"), 0.5);
  assert.equal(parseQuantity("2,5"), 2.5);
  assert.ok(Number.isNaN(parseQuantity("two")));
  assert.ok(Number.isNaN(parseQuantity("1/0")));
});
test("formatQuantity", () => {
  assert.equal(formatQuantity(1500, "g"), "1.5 kg".replace("1.5", formatNumber(1.5)));
  assert.equal(formatQuantity(250, "ml"), "250 ml");
  assert.equal(formatQuantity(2, "each"), "2");
  assert.equal(formatQuantity(0.5, "cup"), "½ cup");
  assert.equal(formatQuantity(null, "g"), "");
});
test("guessCategory", () => {
  assert.equal(guessCategory("chicken thighs"), "meat_seafood");
  assert.equal(guessCategory("Greek yoghurt"), "dairy_eggs");
  assert.equal(guessCategory("dishwashing sponge"), "household");
  assert.equal(guessCategory("xyzzy"), "other");
});
test("week starts Monday", () => {
  assert.equal(iso(startOfWeek(new Date(2026, 9, 10))), "2026-10-05"); // Sat 10 Oct 2026
  assert.equal(iso(addDays(new Date(2026, 0, 31), 1)), "2026-02-01");
});

test("usage counts plan days and folds in old cook logs without double counting", () => {
  const u = summariseUsage(
    [{ recipe_id: "a", planned_date: "2026-09-01" }, { recipe_id: "a", planned_date: "2026-09-08" }, { recipe_id: "b", planned_date: "2026-09-02" }],
    [{ recipe_id: "a", cooked_on: "2026-09-08" }, { recipe_id: "a", cooked_on: "2026-08-01" }]);
  assert.deepEqual(u.get("a"), { times_planned: 3, last_planned_on: "2026-09-08" });
  assert.deepEqual(u.get("b"), { times_planned: 1, last_planned_on: "2026-09-02" });
  assert.equal(u.get("c"), undefined);
});
test("regulars: most planned first, needs two or more, skips excluded", () => {
  const r = [
    { id: "a", times_planned: 5, last_planned_on: "2026-09-01" }, { id: "b", times_planned: 5, last_planned_on: "2026-10-01" },
    { id: "c", times_planned: 1, last_planned_on: "2026-10-05" }, { id: "d", times_planned: 0, last_planned_on: null }, { id: "e", times_planned: 3, last_planned_on: "2026-10-02" }];
  assert.deepEqual(regulars(r).map((x) => x.id), ["b", "a", "e"]);
  assert.deepEqual(regulars(r, 5, new Set(["b"])).map((x) => x.id), ["a", "e"]);
});
test("suggestions favour meals not planned for a long time", () => {
  const today = new Date(2026, 9, 10);
  const recent = { title: "Recent", tags: [], last_planned_on: "2026-10-07" };
  const old = { title: "Old", tags: [], last_planned_on: "2026-06-01" };
  const never = { title: "Never", tags: [], last_planned_on: null };
  assert.ok(scoreRecipe(old, "mild", today) > scoreRecipe(recent, "mild", today));
  assert.ok(scoreRecipe(never, "mild", today) > scoreRecipe(recent, "mild", today));
  assert.equal(suggest([recent, old, never], "mild", 1)[0] !== recent, true);
});

test("amounts are kept out of ingredient labels", () => {
  assert.equal(stripQuantity("2 tbsp olive oil, divided"), "olive oil, divided");
  assert.equal(stripQuantity("400g can chopped tomatoes"), "chopped tomatoes");
  assert.equal(stripQuantity("2 x 400g tins chopped tomatoes"), "chopped tomatoes");
  assert.equal(stripQuantity("1 can (400g) tomatoes"), "tomatoes");
  assert.equal(stripQuantity("½ tsp cumin"), "cumin");
  assert.equal(stripQuantity("ground beef"), "ground beef"); // no amount, so nothing is stripped
  assert.equal(ingredientName("3 cloves garlic, crushed"), "garlic");
  assert.equal(composeLine(2, "tbsp", "olive oil"), "2 tbsp olive oil");
  assert.equal(composeLine(3, "each", "onions"), "3 onions");
  assert.equal(composeLine(null, null, "salt, to taste"), "salt, to taste");
  assert.equal(cleanDisplayName("2 tbsp olive oil"), "olive oil");
  assert.equal(cleanDisplayName("can tomato"), "tomato");
  assert.equal(cleanDisplayName("Dishwashing Liquid"), "Dishwashing Liquid");
});
test("dry ingredients are not shown in millilitres on the shopping list", () => {
  assert.equal(fmtShop("plain flour", 250, "ml"), "150 g");
  assert.equal(fmtShop("rice", 250, "ml"), "200 g");
  assert.equal(fmtShop("ground cumin", 5, "ml"), "1 tsp");
  assert.equal(fmtShop("salt", 30, "ml"), "1 ½ tbsp");
  assert.equal(fmtShop("milk", 250, "ml"), "250 ml");           // liquids are untouched
  assert.equal(fmtShop("butter beans", 250, "ml"), "250 ml");   // not butter
  assert.equal(fmtShop("onion", 2, "each"), "2");
  assert.deepEqual(shopAmount("flour", null, null), { quantity: null, unit: null });
});
