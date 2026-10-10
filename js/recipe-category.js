// A basic category for the recipes screen, taken from the recipe's tags (the title is a fallback).
export const CATEGORIES = [
  ["Breakfast", /\b(breakfast|brunch|porridge|pancakes?|waffles?|omelette|granola|muesli|smoothie bowl)\b/],
  ["Soups", /\b(soups?|broth|chowder)\b/],
  ["Salads", /\b(salads?|slaw)\b/],
  ["Desserts", /\b(desserts?|sweets?|cakes?|puddings?|ice[- ]?cream|brownies?|cookies?|biscuits?|tart|pavlova|slice)\b/],
  ["Baking", /\b(baking|bread|loaf|muffins?|scones?|pastry|rolls?)\b/],
  ["Snacks", /\b(snacks?|dips?|appetisers?|appetizers?|starters?|finger food|lunchbox)\b/],
  ["Sides", /\b(sides?|side dish)\b/],
  ["Drinks", /\b(drinks?|cocktails?|beverages?|juice)\b/],
  ["Lunch", /\b(lunch|sandwich(es)?|wraps?|burgers?)\b/],
  ["Dinner", /\b(dinner|mains?|curry|stew|pasta|roast|stir[- ]?fry|casserole|bbq|barbecue|supper|pizza|tacos?|noodles?|rice)\b/],
];
export const categoryOf = (r) => {
  const tags = (r.tags || []).join(" ").toLowerCase();
  for (const [name, re] of CATEGORIES) if (re.test(tags)) return name;
  const title = String(r.title || "").toLowerCase();
  for (const [name, re] of CATEGORIES) if (re.test(title)) return name;
  return "Other";
};
export const CATEGORY_ORDER = ["Breakfast", "Lunch", "Dinner", "Soups", "Salads", "Sides", "Snacks", "Baking", "Desserts", "Drinks", "Other"];
