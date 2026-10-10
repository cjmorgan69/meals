// import-recipe: turns a photo, a web address or pasted text into a draft recipe.
//
// Secrets (Supabase dashboard > Edge Functions > Secrets):
//   GEMINI_API_KEY        required, your Google AI Studio key
//   GEMINI_MODEL          optional, defaults to gemini-3.5-flash-lite
//   GEMINI_PRICE_IN       optional, USD per 1M input tokens for the usage log (default 0.30)
//   GEMINI_PRICE_OUT      optional, USD per 1M output tokens for the usage log (default 2.50)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPrompt, callGemini, INGREDIENT_LIST_SCHEMA, INGREDIENT_PHOTO_PROMPT, normaliseAiRecipe, normaliseIngredientList, parseJsonLoose } from "./ai.ts";
import { extractJsonLd, extractMetaImage, htmlToText } from "./html.ts";
import { findRecipeNode, imageFromJsonLd, recipeFromJsonLd } from "./jsonld.ts";
import { videoFromHtml, videoFromJsonLd } from "./video.ts";
import { resolveImageUrl, safeFetchImage, safeFetchText, validateUrl } from "./net.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const fail = (status: number, code: string, error: string) => reply(status, { code, error });

const MAX_BODY_CHARS = 8_000_000;
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const KIND_LABEL: Record<string, string> = { photo: "photo", url_ai: "link", text: "text" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail(405, "bad_request", "Use POST.");
  try {
    return await handle(req);
  } catch (e) {
    console.error("import-recipe crashed:", e instanceof Error ? e.message : e);
    return fail(500, "server_error", "Something went wrong on the server. Try again in a moment.");
  }
});

async function handle(req: Request): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return fail(500, "server_error", "The server isn't configured.");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Who is calling?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return fail(401, "unauthorized", "Sign in again to continue.");
  const userId = userData.user.id;

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_CHARS) return fail(413, "bad_request", "That file is too large.");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail(400, "bad_request", "The request wasn't valid JSON.");
  }
  const mode = body.mode;
  if (mode !== "photo" && mode !== "url" && mode !== "text" && mode !== "ingredients") return fail(400, "bad_request", "Unknown import type.");

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash-lite";

  // Inputs per mode ------------------------------------------------------
  let sourceUrl: string | null = null;
  let content = "";
  let image: { mime: string; data: string } | undefined;
  let pageVideo: string | null = null; // a YouTube/Vimeo link found on the page (web links only)
  let pagePhoto: { mime: string; base64: string } | null = null; // the recipe page's own photo (web links only)

  if (mode === "url") {
    const raw = typeof body.url === "string" ? body.url : "";
    try {
      validateUrl(raw);
    } catch (e) {
      return fail(400, "bad_request", (e as Error).message);
    }
    let page: { url: string; text: string };
    try {
      page = await safeFetchText(raw);
    } catch (e) {
      return fail(502, "fetch_failed", `${(e as Error).message} Try pasting the recipe text instead.`);
    }
    sourceUrl = page.url;
    // Free path first: most recipe sites embed structured recipe data.
    const node = findRecipeNode(extractJsonLd(page.text));
    const fromJsonLd = node ? recipeFromJsonLd(node, sourceUrl) : null;
    // The page's photo: the recipe data's image, else the share image. Best effort; never blocks the import.
    const photoUrl = resolveImageUrl((node ? imageFromJsonLd(node) : null) ?? extractMetaImage(page.text), page.url);
    if (photoUrl) pagePhoto = await safeFetchImage(photoUrl, { referer: page.url });
    pageVideo = (node ? videoFromJsonLd(node) : null) ?? videoFromHtml(page.text);
    if (fromJsonLd) return reply(200, { recipe: { ...fromJsonLd, video_url: pageVideo }, via: "json-ld", image: pagePhoto });
    content = htmlToText(page.text);
    if (content.length < 200) {
      return fail(422, "no_recipe", "That page doesn't have readable recipe text. Try pasting the recipe text instead.");
    }
  } else if (mode === "text") {
    content = typeof body.text === "string" ? body.text.trim() : "";
    if (content.length < 40) return fail(400, "bad_request", "Paste a little more of the recipe.");
    if (content.length > 20_000) return fail(400, "bad_request", "That text is too long (20,000 characters at most).");
  } else {
    // "photo" (a recipe) and "ingredients" (what's in the fridge) both take a picture
    const mime = typeof body.mime === "string" ? body.mime : "";
    const data = typeof body.image_base64 === "string" ? body.image_base64 : "";
    if (!IMAGE_MIMES.includes(mime) || data.length < 100 || !/^[A-Za-z0-9+/=\s]+$/.test(data)) {
      return fail(400, "bad_request", "Send a JPEG, PNG or WebP photo.");
    }
    image = { mime, data };
  }

  // From here on we spend AI money, so the key must exist ----------------------
  if (!apiKey) {
    return fail(500, "not_configured", "The Gemini API key hasn't been added yet. Add GEMINI_API_KEY under Edge Functions > Secrets.");
  }

  const kind = mode === "photo" || mode === "ingredients" ? "photo" : mode === "text" ? "text" : "url_ai"; // fridge photos share the photo allowance
  const { data: usageId, error: quotaErr } = await admin.rpc("try_consume_ai_quota", { p_user: userId, p_kind: kind });
  if (quotaErr) {
    console.error("quota check failed:", quotaErr.message);
    return fail(500, "server_error", "Couldn't check your import allowance. Try again in a moment.");
  }
  if (usageId === null || usageId === undefined) {
    return fail(429, "quota", `You've used this month's ${KIND_LABEL[kind]} imports for your plan.`);
  }

  let result;
  try {
    result = await callGemini({
      apiKey,
      model,
      prompt: mode === "ingredients" ? INGREDIENT_PHOTO_PROMPT : buildPrompt(mode, content, sourceUrl ?? undefined),
      image,
      schema: mode === "ingredients" ? INGREDIENT_LIST_SCHEMA : undefined,
    });
  } catch (e) {
    console.error("gemini failed:", e instanceof Error ? e.message : e);
    await admin.from("ai_usage").delete().eq("id", usageId); // give the import back
    return fail(502, "ai_failed", "The AI service couldn't read that. If this keeps happening, check the GEMINI_API_KEY secret and the model name.");
  }

  const priceIn = Number(Deno.env.get("GEMINI_PRICE_IN") ?? "0.30");
  const priceOut = Number(Deno.env.get("GEMINI_PRICE_OUT") ?? "2.50");
  await admin.from("ai_usage").update({
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    cost_usd_micros: Math.round(result.inputTokens * priceIn + result.outputTokens * priceOut),
  }).eq("id", usageId);

  if (mode === "ingredients") {
    let list: string[] = [];
    try {
      list = normaliseIngredientList(parseJsonLoose(result.text));
    } catch (e) {
      console.error("could not parse ingredient list:", e instanceof Error ? e.message : e);
    }
    return reply(200, { ingredients: list });
  }

  let recipe = null;
  try {
    recipe = normaliseAiRecipe(parseJsonLoose(result.text), mode === "url" ? "url" : mode, sourceUrl);
  } catch (e) {
    console.error("could not parse model output:", e instanceof Error ? e.message : e);
  }
  if (!recipe) return fail(422, "no_recipe", "No recipe found. Try a clearer photo, or paste the recipe text.");
  return reply(200, { recipe: { ...recipe, video_url: pageVideo }, via: "ai", image: pagePhoto });
}
