// Light category guesser used for manual shopping items and custom ingredients.
const RULES = [
  ["meat_seafood", /\b(chicken|beef|pork|lamb|mince|bacon|sausage|ham|steak|fish|salmon|tuna|prawn|shrimp|turkey|chorizo)\b/],
  ["dairy_eggs", /\b(milk|cream|butter|cheese|yoghurt|yogurt|egg|eggs|parmesan|mozzarella|feta|ricotta)\b/],
  ["produce", /\b(onion|garlic|tomato|potato|carrot|lemon|lime|apple|banana|lettuce|spinach|basil|parsley|coriander|cucumber|capsicum|pepper|broccoli|mushroom|zucchini|ginger|chilli|avocado|celery|herb|fruit|veg)\w*/],
  ["bakery", /\b(bread|roll|bun|tortilla|wrap|pita|naan|baguette)\b/],
  ["frozen", /\b(frozen|ice cream)\b/],
  ["drinks", /\b(juice|wine|beer|soda|water|coffee|tea|cola)\b/],
  ["household", /\b(foil|wrap|paper|soap|detergent|bag|sponge|napkin)\b/],
  ["pantry", /\b(flour|sugar|salt|oil|vinegar|rice|pasta|noodle|stock|sauce|spice|cumin|paprika|oregano|beans|lentil|honey|oats|tin|can)\w*/],
];
export function guessCategory(name) {
  const s = String(name).toLowerCase();
  for (const [c, re] of RULES) if (re.test(s)) return c;
  return "other";
}
