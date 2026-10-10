// Keeps quantities out of ingredient labels, so an amount lives only in the amount boxes.
// Pure functions (no browser needed) so they can be tested with Node.
import { formatQuantity } from "./units.js";

const UNIT_WORDS = "kg|g|mg|ml|l|litres?|liters?|tsps?|teaspoons?|tbsps?|tablespoons?|cups?|oz|ounces?|lbs?|pounds?|cloves?|bunch(?:es)?|cans?|tins?|packets?|packs?|jars?|bottles?|tubs?|pinch(?:es)?|slices?|sprigs?|stalks?|sticks?|heads?|pieces?";
const QTY = "(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?\\s*[½¼¾⅓⅔⅛]|\\d+(?:[.,]\\d+)?|[½¼¾⅓⅔⅛])";
const LEAD_QTY = new RegExp(`^${QTY}(?:\\s*(?:-|–|to)\\s*${QTY})?\\s*`, "i");
const PACK_LEAD = /^(?:tins?|cans?|packets?|packs?|jars?|bottles?|tubs?)\b\.?\s*(?:of\s+)?/i;

/** "2 tbsp olive oil, divided" -> "olive oil, divided". Anything without a leading amount is left alone. */
export function stripQuantity(raw) {
  let s = String(raw ?? "").trim();
  if (!LEAD_QTY.test(s)) return s;
  s = s.replace(LEAD_QTY, "");
  s = s.replace(new RegExp(`^[x×]\\s*${QTY}\\s*`, "i"), "");
  let prev;
  do {
    prev = s;
    s = s.replace(/^\(\s*[^)]*\)\s*/, "").replace(new RegExp(`^(?:${UNIT_WORDS})\\b\\.?\\s*(?:of\\s+)?`, "i"), "");
  } while (s !== prev);
  return s.replace(/^of\s+/i, "").trim();
}

/** The plain ingredient name used for the shopping list: no amount, no pack word, no note. */
export function ingredientName(raw) {
  let s = stripQuantity(raw).toLowerCase();
  s = s.replace(PACK_LEAD, "").replace(/\(.*?\)/g, " ").split(",")[0].replace(/\s+/g, " ").trim();
  return s;
}

/** Rebuilds the full line from the amount boxes and the label: (2, "tbsp", "olive oil") -> "2 tbsp olive oil". */
export function composeLine(quantity, unit, label) {
  const amount = quantity == null || Number.isNaN(quantity) ? "" : formatQuantity(quantity, unit);
  return `${amount} ${String(label ?? "").trim()}`.trim();
}

/** A saved name for display: only touched when it still carries an amount or pack word ("2 tbsp olive oil", "can tomato"). */
export function cleanDisplayName(name) {
  const n = String(name ?? "");
  return LEAD_QTY.test(n) || PACK_LEAD.test(n) ? (ingredientName(n) || n) : n;
}
