// Builds a recipe from schema.org Recipe data embedded in a web page (no AI needed).
import type { DraftRecipe, DraftStep } from "./types.ts";
import { fragmentToText } from "./html.ts";
import { parseIngredientLine } from "./ingredients.ts";

type Obj = Record<string, unknown>;

export function flattenNodes(input: unknown, out: Obj[] = []): Obj[] {
  if (Array.isArray(input)) {
    for (const x of input) flattenNodes(x, out);
  } else if (input && typeof input === "object") {
    const o = input as Obj;
    out.push(o);
    if (o["@graph"]) flattenNodes(o["@graph"], out);
  }
  return out;
}

export function findRecipeNode(blocks: unknown[]): Obj | null {
  for (const n of flattenNodes(blocks)) {
    const t = n["@type"];
    const types = Array.isArray(t) ? t : [t];
    if (types.some((x) => typeof x === "string" && x.toLowerCase().endsWith("recipe"))) return n;
  }
  return null;
}

/** ISO 8601 duration ("PT1H30M") to minutes. */
export function parseDuration(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const mins = Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Math.round(Number(m[4] || 0) / 60);
  return mins > 0 ? mins : null;
}

export function parseYield(v: unknown): number {
  const first = Array.isArray(v) ? (v.find((x) => /\d/.test(String(x))) ?? v[0]) : v;
  const m = String(first ?? "").match(/\d+/);
  const n = m ? Number(m[0]) : 4;
  return n >= 1 && n <= 100 ? n : 4;
}

/** Picks a timer from phrases like "simmer for 10-15 minutes" (upper value). */
export function guessTimer(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|minutes?|mins?)\b/i);
  if (!m) return null;
  const n = Number(m[2] ?? m[1]);
  const secs = /^h/i.test(m[3]) ? n * 3600 : n * 60;
  return secs >= 30 && secs <= 6 * 3600 ? Math.round(secs) : null;
}

function splitInstructionText(s: string): string[] {
  const lines = fragmentToText(s).split("\n");
  return lines
    .map((l) => l.replace(/^(?:step\s*)?\d+\s*[.):-]\s*/i, "").trim())
    .filter(Boolean);
}

export function instructionsToSteps(v: unknown): DraftStep[] {
  const out: string[] = [];
  const walk = (x: unknown): void => {
    if (x == null) return;
    if (typeof x === "string") {
      out.push(...splitInstructionText(x));
    } else if (Array.isArray(x)) {
      x.forEach(walk);
    } else if (typeof x === "object") {
      const o = x as Obj;
      if (Array.isArray(o.itemListElement)) {
        walk(o.itemListElement);
        return;
      }
      const t = o.text ?? o.name;
      if (typeof t === "string") walk(t);
    }
  };
  walk(v);
  return out
    .map((t) => t.slice(0, 1500))
    .slice(0, 60)
    .map((instruction) => ({ instruction, timer_seconds: guessTimer(instruction) }));
}

function asStrings(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(asStrings);
  if (typeof v === "string") return [v];
  return [];
}

function collectTags(node: Obj): string[] {
  const raw = [
    ...asStrings(node.recipeCategory),
    ...asStrings(node.recipeCuisine),
    ...asStrings(node.keywords).flatMap((k) => k.split(",")),
  ];
  const seen = new Set<string>();
  for (const r of raw) {
    const t = fragmentToText(r).toLowerCase().trim();
    if (t && t.length <= 30 && !/^\d+$/.test(t)) seen.add(t);
    if (seen.size >= 8) break;
  }
  return [...seen];
}

/** Returns a draft recipe, or null when the data is too thin to trust (caller falls back to AI). */
export function recipeFromJsonLd(node: Obj, sourceUrl: string | null): DraftRecipe | null {
  const title = typeof node.name === "string" ? fragmentToText(node.name).slice(0, 200) : "";
  const ingredientLines = asStrings(node.recipeIngredient ?? node.ingredients)
    .map((l) => fragmentToText(l))
    .filter(Boolean)
    .slice(0, 80);
  const steps = instructionsToSteps(node.recipeInstructions);
  if (!title || ingredientLines.length < 2 || steps.length < 1) return null;

  const prep = parseDuration(node.prepTime);
  const cook = parseDuration(node.cookTime) ?? (prep === null ? parseDuration(node.totalTime) : null);
  const description = typeof node.description === "string"
    ? fragmentToText(node.description).replace(/\n/g, " ").slice(0, 600) || null
    : null;

  return {
    title,
    description,
    servings: parseYield(node.recipeYield),
    prep_minutes: prep,
    cook_minutes: cook,
    tags: collectTags(node),
    ingredients: ingredientLines.map((l) => parseIngredientLine(l)),
    steps,
    source: "url",
    source_url: sourceUrl,
  };
}
