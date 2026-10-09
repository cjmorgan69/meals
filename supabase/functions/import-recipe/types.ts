export type Category =
  | "produce" | "meat_seafood" | "dairy_eggs" | "bakery"
  | "pantry" | "frozen" | "drinks" | "household" | "other";

export const CATEGORIES: Category[] = [
  "produce", "meat_seafood", "dairy_eggs", "bakery",
  "pantry", "frozen", "drinks", "household", "other",
];

export const UNIT_CODES = [
  "g", "kg", "ml", "l", "tsp", "tbsp", "cup", "each", "clove", "bunch", "can", "pinch",
] as const;

export type UnitCode = typeof UNIT_CODES[number];

export interface DraftIngredient {
  raw_text: string;
  quantity: number | null;
  unit: UnitCode | null;
  name: string;
  note: string | null;
  optional: boolean;
  category: Category;
  group_label: string | null;
}

export interface DraftStep {
  instruction: string;
  timer_seconds: number | null;
}

export interface DraftRecipe {
  title: string;
  description: string | null;
  servings: number;
  prep_minutes: number | null;
  cook_minutes: number | null;
  tags: string[];
  ingredients: DraftIngredient[];
  steps: DraftStep[];
  source: "photo" | "url" | "text";
  source_url: string | null;
}
