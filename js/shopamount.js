// Shopping amounts. The list adds everything up in grams (mass) or millilitres (volume), which turns
// "1 cup flour" into "250 ml flour" and "1 tsp cumin" into "5 ml cumin". This converts dry things back
// to something you can buy or measure: grams for flour, sugar, rice and the like, spoons for spices.
import { formatQuantity } from "./units.js";

const SPICE = /(cumin|paprika|turmeric|cinnamon|oregano|thyme|rosemary|cayenne|nutmeg|garam masala|curry powder|chilli flakes|chilli powder|baking powder|bicarb(?:onate)?(?: of soda)?|baking soda|mustard powder|seasoning|mixed spice|five spice|salt|pepper|peppercorns|yeast|sesame seeds|poppy seeds|ground \w+|dried \w+)$/;

// grams per millilitre (a metric cup is 250 ml)
const DENSITY = [
  [/flour$/, 0.6], [/(cornflour|cornstarch|custard powder)$/, 0.55], [/(icing|powdered) sugar$/, 0.5],
  [/(brown|raw|demerara|muscovado|coconut) sugar$/, 0.9], [/sugar$/, 0.85],
  [/(^|\s)(basmati|jasmine|arborio|brown|white|long[- ]grain|sushi)? ?rice$/, 0.8], [/(oats|porridge oats)$/, 0.36],
  [/(breadcrumbs|panko)$/, 0.4], [/cocoa( powder)?$/, 0.4], [/(almond meal|ground almonds)$/, 0.4],
  [/(almonds|walnuts|cashews|pecans|peanuts|hazelnuts|pistachios|pine nuts)$/, 0.55], [/(desiccated|shredded) coconut$/, 0.35],
  [/(grated|shredded) .*cheese$|(parmesan|cheddar|mozzarella)$/, 0.4], [/(?<!peanut |almond |nut |cashew )butter$/, 0.95],
  [/(lentils|chickpeas|split peas)$/, 0.8], [/quinoa$/, 0.7], [/couscous$/, 0.7], [/(polenta|semolina|cornmeal)$/, 0.7],
  [/(sultanas|raisins|currants|dried cranberries)$/, 0.6], [/chocolate (chips|chunks)$/, 0.65],
];

/** { quantity, unit } as it should be shown on the shopping list. Only volume amounts of dry things change. */
export function shopAmount(name, quantity, unit) {
  if (quantity == null || (unit !== "ml" && unit !== "l")) return { quantity, unit };
  const ml = unit === "l" ? Number(quantity) * 1000 : Number(quantity);
  const n = String(name || "").toLowerCase().trim();
  if (SPICE.test(n)) {
    if (ml >= 250) return { quantity: ml / 250, unit: "cup" };
    if (ml >= 15) return { quantity: ml / 20, unit: "tbsp" };
    return { quantity: ml / 5, unit: "tsp" };
  }
  for (const [re, d] of DENSITY) if (re.test(n)) { const g = ml * d; return { quantity: g >= 50 ? Math.round(g / 5) * 5 : g, unit: "g" }; }
  return { quantity, unit };
}
export function fmtShop(name, quantity, unit) {
  const a = shopAmount(name, quantity, unit);
  return formatQuantity(a.quantity, a.unit);
}
