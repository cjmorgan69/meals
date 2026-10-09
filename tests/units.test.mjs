import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuantity, formatQuantity, formatNumber } from "../js/units.js";
import { guessCategory } from "../js/categories.js";
import { iso, startOfWeek, addDays } from "../js/dates.js";

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
