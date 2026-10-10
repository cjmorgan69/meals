export const CATEGORIES = [
  ["produce", "Fruit & veg"], ["meat_seafood", "Meat & seafood"], ["dairy_eggs", "Dairy & eggs"], ["bakery", "Bakery"],
  ["pantry", "Pantry"], ["frozen", "Frozen"], ["drinks", "Drinks"], ["household", "Household"], ["other", "Other"],
];
export const CATEGORY_ICON = { produce: "🥦", meat_seafood: "🥩", dairy_eggs: "🧀", bakery: "🥖", pantry: "🥫", frozen: "🧊", drinks: "🥤", household: "🧽", other: "🛒" };
export const categoryIcon = (c) => CATEGORY_ICON[c] || "🛒";
export const categoryLabel = (c) => (CATEGORIES.find((x) => x[0] === c) || [, "Other"])[1];
export const UNITS = ["", "g", "kg", "ml", "l", "tsp", "tbsp", "cup", "each", "clove", "bunch", "can", "pinch"];

const FR = [[0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"]];
export function formatNumber(n) {
  if (n == null || Number.isNaN(n)) return "";
  const whole = Math.floor(n + 1e-9), frac = n - whole;
  if (frac < 0.03) return String(whole);
  for (const [v, s] of FR) if (Math.abs(frac - v) < 0.03) return (whole ? whole + " " : "") + s;
  return String(Math.round(n * 100) / 100);
}
export function formatQuantity(q, unit) {
  if (q == null) return "";
  let n = Number(q), u = unit || "";
  if (u === "g" && n >= 1000) { n /= 1000; u = "kg"; }
  else if (u === "ml" && n >= 1000) { n /= 1000; u = "l"; }
  const num = u === "g" || u === "ml" ? String(Math.round(n)) : formatNumber(n);
  return u && u !== "each" ? `${num} ${u}` : num;
}
const UNI = { "⅛": 0.125, "¼": 0.25, "⅓": 1 / 3, "½": 0.5, "⅔": 2 / 3, "¾": 0.75 };
/** "1 1/2", "½", "2.5" -> number. Empty -> null. Invalid -> NaN. */
export function parseQuantity(s) {
  s = String(s ?? "").trim();
  if (!s) return null;
  let total = 0;
  for (const part of s.split(/\s+/)) {
    if (UNI[part] != null) total += UNI[part];
    else if (/^\d+\/\d+$/.test(part)) { const [a, b] = part.split("/").map(Number); if (!b) return NaN; total += a / b; }
    else if (/^\d+([.,]\d+)?$/.test(part)) total += Number(part.replace(",", "."));
    else return NaN;
  }
  return total;
}
export const fmtDuration = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
