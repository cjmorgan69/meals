// "Use up": rank the user's own recipes by how many of the ingredients they want to use up (pure, testable).
import { stripQuantity } from "./ingredient-text.js";

// Nearly every recipe has these, so matching on them would drown out the useful results.
const STAPLES = new Set(["salt", "pepper", "black pepper", "oil", "olive oil", "vegetable oil", "water"]);
const STOCKISH = /^(stock|broth|bouillon|powder|sauce|paste)$/;

const stem = (w) => {
  w = w.toLowerCase();
  if (w.length <= 3) return w;
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + "y";
  if (/oes$/.test(w)) return w.slice(0, -2);
  if (/(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (/(ss|us|is)$/.test(w)) return w;
  return w.replace(/s$/, "");
};
const words = (text) => String(text || "").toLowerCase().replace(/\(.*?\)/g, " ").split(",")[0].split(/[^a-zà-ɏ]+/).filter(Boolean).map(stem);

/** "chicken, cabbage and cream" -> ["chicken", "cabbage", "cream"] (staples and repeats dropped). */
export function parseWanted(input) {
  const seen = new Set(), out = [];
  for (const part of String(input || "").split(/,|;|\n|\band\b|&/i)) {
    const t = part.trim().replace(/\s+/g, " ");
    const key = t.toLowerCase();
    if (!t || STAPLES.has(key) || seen.has(key)) continue;
    seen.add(key); out.push(t);
  }
  return out.slice(0, 12);
}

/** Does this ingredient line use the wanted ingredient? Every word of the wanted term must be in the line. */
export function lineUses(wanted, line) {
  const w = words(wanted);
  if (!w.length) return false;
  const have = new Set(words(line));
  if (!w.every((x) => have.has(x))) return false;
  const wantsStock = w.some((x) => STOCKISH.test(x));
  return wantsStock || ![...have].some((x) => STOCKISH.test(x)); // "chicken" does not match "chicken stock"
}

/**
 * recipes: [{ id, title, last_planned_on }], lines: Map(recipe id -> [ingredient text]).
 * Returns recipes that use at least one wanted ingredient, most used first, then those not planned lately.
 */
export function rankByUseUp(recipes, lines, wanted, exclude = new Set()) {
  const out = [];
  for (const r of recipes) {
    if (exclude.has(r.id)) continue;
    const ls = lines.get(r.id) || [];
    const used = wanted.filter((w) => ls.some((l) => lineUses(w, l)));
    if (used.length) out.push({ recipe: r, used });
  }
  return out.sort((a, b) => b.used.length - a.used.length
    || String(a.recipe.last_planned_on || "").localeCompare(String(b.recipe.last_planned_on || ""))
    || a.recipe.title.localeCompare(b.recipe.title));
}

/** The text to match for a saved ingredient: its clean name and the label from the line, without the amount. */
export const ingredientTexts = (row) => [row.ingredients?.name, stripQuantity(row.raw_text)].filter(Boolean);
