// Turns an ingredient line such as "2 tbsp olive oil, divided" into structured data.
// Pure functions only (no Deno APIs) so they can be unit tested with Node.
import type { Category, DraftIngredient, UnitCode } from "./types.ts";

export const UNIT_ALIASES: Record<string, UnitCode> = {
  g: "g", gram: "g", grams: "g", gr: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  ml: "ml", mls: "ml", millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml",
  l: "l", litre: "l", litres: "l", liter: "l", liters: "l", ltr: "l",
  tsp: "tsp", tsps: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  tbsp: "tbsp", tbsps: "tbsp", tbs: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  cup: "cup", cups: "cup",
  clove: "clove", cloves: "clove",
  bunch: "bunch", bunches: "bunch",
  can: "can", cans: "can", tin: "can", tins: "can",
  pinch: "pinch", pinches: "pinch",
};

const IMPERIAL: Record<string, { unit: UnitCode; factor: number }> = {
  oz: { unit: "g", factor: 28.35 }, ounce: { unit: "g", factor: 28.35 }, ounces: { unit: "g", factor: 28.35 },
  lb: { unit: "g", factor: 453.6 }, lbs: { unit: "g", factor: 453.6 },
  pound: { unit: "g", factor: 453.6 }, pounds: { unit: "g", factor: 453.6 },
};

// Words that count things but aren't a unit we track: "4 slices bacon" -> 4 each, "bacon"
const COUNT_WORDS = new Set([
  "slice", "slices", "sprig", "sprigs", "stalk", "stalks", "stick", "sticks", "head", "heads",
  "piece", "pieces", "rasher", "rashers", "fillet", "fillets", "sheet", "sheets",
]);

const VULGAR: Record<string, number> = {
  "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};

const NUM_RE =
  /^(?:(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞])|([½¼¾⅓⅔⅛⅜⅝⅞])|(\d+)\s+(\d+)\/(\d+)|(\d+)\/(\d+)|(\d+(?:\.\d+)?))/;

export function roundNice(n: number): number {
  if (n >= 100) return Math.round(n / 5) * 5;
  if (n >= 10) return Math.round(n);
  return Math.round(n * 10) / 10;
}

/** Reads a leading quantity ("1 1/2", "1½", "2-3", "0.5"). Ranges use the upper value. */
export function parseLeadingQuantity(input: string): { value: number; rest: string } | null {
  const s = input.trimStart();
  const m = s.match(NUM_RE);
  if (!m) return null;
  let value: number;
  if (m[2]) value = Number(m[1]) + VULGAR[m[2]];
  else if (m[3]) value = VULGAR[m[3]];
  else if (m[6]) {
    if (Number(m[6]) === 0) return null;
    value = Number(m[4]) + Number(m[5]) / Number(m[6]);
  } else if (m[8]) {
    if (Number(m[8]) === 0) return null;
    value = Number(m[7]) / Number(m[8]);
  } else value = Number(m[9]);
  let rest = s.slice(m[0].length);
  const range = rest.match(/^\s*(?:-|–|—|to)\s*(?=[\d½¼¾⅓⅔⅛⅜⅝⅞])/i);
  if (range) {
    const upper = parseLeadingQuantity(rest.slice(range[0].length));
    if (upper) {
      value = Math.max(value, upper.value);
      rest = upper.rest;
    }
  }
  return { value, rest };
}

const DESCRIPTORS = new Set([
  "large", "medium", "small", "big", "fresh", "freshly", "ripe", "whole", "finely", "roughly",
  "thinly", "thickly", "coarsely", "chopped", "diced", "sliced", "minced", "grated", "crushed",
  "peeled", "boneless", "skinless", "lean", "good", "quality", "free-range", "organic",
  "heaped", "level", "baby", "extra", "raw",
]);

const IRREGULAR: Record<string, string> = {
  chillies: "chilli", leaves: "leaf", loaves: "loaf", halves: "half", anchovies: "anchovy",
};

const SINGULAR_EXCEPTIONS = new Set([
  "asparagus", "couscous", "hummus", "molasses", "swiss", "cress", "watercress", "oats",
  "grits", "citrus", "lemongrass", "bass", "hibiscus", "tahini", "hummus",
]);

function singular(w: string): string {
  if (w.length <= 3 || SINGULAR_EXCEPTIONS.has(w)) return w;
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + "y";
  if (/oes$/.test(w)) return w.slice(0, -2);
  if (/(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (/(ss|us|is)$/.test(w)) return w;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Lowercase, drop preparation words, singular last word: "Finely chopped onions" -> "onion". */
export function normaliseName(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ\s'&/-]/g, " ")
    .replace(/\bextra[- ]virgin\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = s.split(" ").filter(Boolean);
  while (words.length > 1 && DESCRIPTORS.has(words[0])) words.shift();
  if (words.length === 0) return "";
  const last = words.length - 1;
  words[last] = IRREGULAR[words[last]] ?? singular(words[last]);
  return words.join(" ").slice(0, 80);
}

const RULES: Array<[Category, RegExp]> = [
  ["produce", /\b(green beans?|bean sprouts?|snow peas?|sugar snap|(?:lemon|lime) (?:juice|zest))\b/],
  ["frozen", /\b(frozen|ice[- ]cream|gelato)\b/],
  ["drinks", /\b(wine|beer|cider|vodka|rum|whisky|whiskey|brandy|soda|tonic|cola|lemonade|kombucha|juice)\b/],
  ["pantry", /\b(paste|passata|puree|purée|tinned|canned|stock|broth|bouillon|sauce|vinegar|oil|flour|sugar|dried|powder|flakes|spices?|seasoning|noodles?|pasta|spaghetti|penne|rice|oats?|lentils?|chickpeas?|beans?|salt|(?:black|white|cracked) pepper|peppercorns?|coconut (?:milk|cream)|honey|syrup|mustard|mayonnaise|mayo|nuts?|almonds?|cashews?|walnuts?|peanuts?|seeds?|olives?|capers?|cumin|paprika|turmeric|cinnamon|oregano|baking|yeast|cornflour|cornstarch|breadcrumbs|tahini|jam|chocolate|cocoa|vanilla|gelatine|couscous|quinoa)\b|^pepper$|\bground (?!beef|pork|lamb|chicken|turkey|veal)\w+/],
  ["dairy_eggs", /\b(milk|cream|butter|cheese|cheddar|parmesan|mozzarella|feta|ricotta|halloumi|haloumi|yoghurt|yogurt|egg|eggs|ghee|mascarpone|custard|buttermilk)\b/],
  ["meat_seafood", /\b(chicken|beef|pork|lamb|mince|steak|bacon|sausages?|ham|prosciutto|salami|chorizo|turkey|duck|veal|prawns?|shrimp|fish|salmon|tuna|barramundi|snapper|cod|squid|calamari|mussels?|scallops?|crab|lobster|oysters?|anchov(?:y|ies)|brisket|ribs?|drumsticks?|thighs?|wings?)\b/],
  ["bakery", /\b(bread|buns?|rolls?|tortillas?|wraps?|pita|pitta|naan|baguette|croissants?|sourdough|bagels?|crumpets?|flatbread|ciabatta|focaccia)\b/],
  ["produce", /\b(onions?|garlic|tomato(?:es)?|potato(?:es)?|carrots?|lettuce|spinach|kale|capsicum|chill(?:i|y|ies)|cucumbers?|zucchini|courgettes?|eggplant|aubergine|pumpkin|squash|apples?|lemons?|limes?|oranges?|bananas?|berries|berry|avocados?|mushrooms?|broccoli|cauliflower|cabbage|celery|leeks?|spring onions?|shallots?|ginger|basil|parsley|coriander|cilantro|mint|dill|chives|thyme|rosemary|sage|herbs?|rocket|arugula|beetroot|corn|peas?|radish(?:es)?|fennel|mango|pineapple|grapes?|pears?|peach(?:es)?|plums?|melon|watermelon|sweet potato|turnip|parsnip|bok choy|pak choi|salad|sprouts?)\b/],
];

export function guessCategory(name: string): Category {
  const n = name.toLowerCase();
  for (const [cat, re] of RULES) if (re.test(n)) return cat;
  return "other";
}

export function parseIngredientLine(raw: string, group: string | null = null): DraftIngredient {
  const original = raw.replace(/\s+/g, " ").trim();
  let s = original.replace(/^[-•*·]\s*/, "");

  let optional = false;
  if (/\boptional\b/i.test(s)) {
    optional = true;
    s = s.replace(/,?\s*\(?\boptional\b\)?/gi, "");
  }
  if (/\b(to serve|for serving|to garnish|for garnish|to decorate|for decoration)\b/i.test(s)) optional = true;

  let quantity: number | null = null;
  let unit: UnitCode | null = null;
  let rest = s;

  const q = parseLeadingQuantity(s);
  if (q) {
    quantity = q.value;
    rest = q.rest.trim();
    const packWords = "(?:tins?|cans?|packets?|packs?|jars?|bottles?|tubs?)";
    let m = rest.match(
      new RegExp(`^[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*(kg|g|ml|l|litres?|liters?)\\b\\.?\\s*${packWords}?\\s*(?:of\\s+)?(.*)$`, "i"),
    );
    if (!m) {
      m = rest.match(
        new RegExp(`^${packWords}?\\s*\\(\\s*(\\d+(?:\\.\\d+)?)\\s*(kg|g|ml|l|litres?|liters?)\\s*(?:each)?\\s*\\)\\s*${packWords}?\\s*(?:of\\s+)?(.*)$`, "i"),
      );
    }
    if (m) {
      quantity = quantity * Number(m[1]);
      unit = UNIT_ALIASES[m[2].toLowerCase()];
      rest = m[3];
    } else {
      const fl = rest.match(/^(?:fl\.?\s*oz\.?|fluid ounces?)\b\.?\s*(?:of\s+)?(.*)$/i);
      if (fl) {
        quantity = roundNice(quantity * 29.57);
        unit = "ml";
        rest = fl[1];
      } else {
        const tok = rest.match(/^([A-Za-z]+)\b\.?\s*(?:of\s+)?(.*)$/);
        if (tok) {
          const t = tok[1].toLowerCase();
          if (UNIT_ALIASES[t]) {
            unit = UNIT_ALIASES[t];
            rest = tok[2];
          } else if (IMPERIAL[t]) {
            quantity = roundNice(quantity * IMPERIAL[t].factor);
            unit = IMPERIAL[t].unit;
            rest = tok[2];
          } else if (COUNT_WORDS.has(t)) {
            rest = tok[2];
          }
        }
        if (!unit) unit = "each";
      }
    }
  } else {
    const ph = s.match(/^(?:a|an|one)\s+(pinch|bunch|clove|handful|dash|splash|drizzle|knob)(?:es|s)?\s+(?:of\s+)?(.+)$/i) ??
      s.match(/^(pinch|bunch|clove|handful|dash|splash|drizzle|knob)(?:es|s)?\s+of\s+(.+)$/i);
    if (ph) {
      const w = ph[1].toLowerCase();
      if (w === "pinch" || w === "bunch" || w === "clove") {
        quantity = 1;
        unit = w as UnitCode;
      }
      rest = ph[2];
    }
  }

  const notes: string[] = [];
  rest = rest.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    if (inner.trim()) notes.push(inner.trim());
    return " ";
  });
  const comma = rest.indexOf(",");
  if (comma >= 0) {
    const after = rest.slice(comma + 1).trim();
    if (after) notes.push(after);
    rest = rest.slice(0, comma);
  }
  rest = rest.replace(/\b(to taste|as needed|as required|for frying|for greasing|for dusting)\b.*$/i, (m0) => {
    notes.push(m0.trim());
    return "";
  });
  rest = rest.replace(/^of\s+/i, "").trim();

  const name = normaliseName(rest) || normaliseName(original) || original.toLowerCase();
  return {
    raw_text: original,
    quantity: quantity !== null && Number.isFinite(quantity) ? Math.round(quantity * 100) / 100 : null,
    unit: quantity !== null ? unit : null,
    name,
    note: notes.length ? notes.join("; ").slice(0, 200) : null,
    optional,
    category: guessCategory(name),
    group_label: group,
  };
}
