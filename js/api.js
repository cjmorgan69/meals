import { sb } from "./supabase.js";
import { PHOTO_BUCKET } from "./config.js";
import { guessCategory } from "./categories.js";

const must = ({ data, error }) => { if (error) throw new Error(error.message || "Something went wrong."); return data; };

export async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
const uid = async () => { const u = await currentUser(); if (!u) throw new Error("Please sign in again."); return u.id; };

// ---------- recipes ----------
export async function listRecipes() {
  const [recipes, stats] = await Promise.all([
    sb.from("recipes").select("id,title,description,image_path,servings,prep_minutes,cook_minutes,tags,is_favourite,created_at").order("created_at", { ascending: false }).then(must),
    sb.from("recipe_cook_stats").select("recipe_id,times_cooked,last_cooked_on").then(must),
  ]);
  const by = new Map(stats.map((s) => [s.recipe_id, s]));
  return recipes.map((r) => ({ ...r, times_cooked: by.get(r.id)?.times_cooked ?? 0, last_cooked_on: by.get(r.id)?.last_cooked_on ?? null }));
}

export async function getRecipe(id) {
  const [r, ings, steps, stats] = await Promise.all([
    sb.from("recipes").select("*").eq("id", id).maybeSingle().then(must),
    sb.from("recipe_ingredients").select("*").eq("recipe_id", id).order("position").then(must),
    sb.from("recipe_steps").select("*").eq("recipe_id", id).order("position").then(must),
    sb.from("recipe_cook_stats").select("times_cooked,last_cooked_on").eq("recipe_id", id).maybeSingle().then(must),
  ]);
  if (!r) return null;
  return { ...r, ingredients: ings, steps, times_cooked: stats?.times_cooked ?? 0, last_cooked_on: stats?.last_cooked_on ?? null };
}

async function resolveIngredientIds(names, owner) {
  const wanted = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) return new Map();
  const existing = must(await sb.from("ingredients").select("id,name,owner_id"));
  const map = new Map();
  // global ingredients (owner null) win over personal ones with the same name
  for (const i of existing.sort((a, b) => (a.owner_id ? 1 : 0) - (b.owner_id ? 1 : 0)).reverse()) map.set(i.name.toLowerCase(), i.id);
  const missing = wanted.filter((n) => !map.has(n));
  if (missing.length) {
    const made = must(await sb.from("ingredients").insert(missing.map((n) => ({ name: n, owner_id: owner, category: guessCategory(n) }))).select("id,name"));
    for (const i of made) map.set(i.name.toLowerCase(), i.id);
  }
  return map;
}

/** recipe: { title, description, servings, prep_minutes, cook_minutes, tags, source, source_url, image_path, ingredients[], steps[] } */
export async function saveRecipe(recipe, id) {
  const owner = await uid();
  const row = {
    title: recipe.title.trim(), description: recipe.description || null, servings: recipe.servings || 4,
    prep_minutes: recipe.prep_minutes ?? null, cook_minutes: recipe.cook_minutes ?? null, tags: recipe.tags || [],
    source: recipe.source || "manual", source_url: recipe.source_url || null, video_url: recipe.video_url || null, image_path: recipe.image_path || null,
  };
  let rid = id;
  if (rid) must(await sb.from("recipes").update(row).eq("id", rid));
  else rid = must(await sb.from("recipes").insert({ ...row, owner_id: owner }).select("id").single()).id;

  const idMap = await resolveIngredientIds(recipe.ingredients.map((i) => i.name || ""), owner);
  must(await sb.from("recipe_ingredients").delete().eq("recipe_id", rid));
  must(await sb.from("recipe_steps").delete().eq("recipe_id", rid));
  const ings = recipe.ingredients.filter((i) => (i.raw_text || i.name || "").trim()).map((i, n) => ({
    recipe_id: rid, position: n, group_label: i.group_label || null,
    raw_text: (i.raw_text || i.name).trim(), ingredient_id: idMap.get((i.name || "").trim().toLowerCase()) ?? null,
    quantity: i.quantity ?? null, unit: i.unit || null, note: i.note || null, optional: !!i.optional,
  }));
  if (ings.length) must(await sb.from("recipe_ingredients").insert(ings));
  const steps = recipe.steps.filter((s) => s.instruction.trim()).map((s, n) => ({
    recipe_id: rid, position: n, instruction: s.instruction.trim(), timer_seconds: s.timer_seconds ?? null,
  }));
  if (steps.length) must(await sb.from("recipe_steps").insert(steps));
  return rid;
}

export async function setFavourite(id, v) { must(await sb.from("recipes").update({ is_favourite: v }).eq("id", id)); }

export async function deleteRecipe(id, imagePath) {
  must(await sb.from("recipes").delete().eq("id", id));
  if (imagePath) await sb.storage.from(PHOTO_BUCKET).remove([imagePath]);
}

// ---------- photos ----------
export async function uploadPhoto(blob) {
  const path = `${await uid()}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error(error.message);
  return path;
}
const urlCache = new Map();
export async function photoUrl(path) {
  if (!path) return null;
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
  if (error) return null;
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

// ---------- cooking log ----------
export async function logCooked(recipeId, rating) {
  must(await sb.from("cook_events").insert({ recipe_id: recipeId, rating: rating || null }));
}

// ---------- meal plan ----------
export async function getPlan(from, to) {
  return must(await sb.from("meal_plan_entries").select("id,recipe_id,planned_date,meal,servings,status,notes,recipes(title,image_path)")
    .gte("planned_date", from).lte("planned_date", to).order("planned_date").order("created_at"));
}
export async function addPlan(recipeId, date, meal = "dinner") {
  must(await sb.from("meal_plan_entries").insert({ recipe_id: recipeId, planned_date: date, meal }));
}
export async function setPlanStatus(id, status) { must(await sb.from("meal_plan_entries").update({ status }).eq("id", id)); }
export async function removePlan(id) { must(await sb.from("meal_plan_entries").delete().eq("id", id)); }

// ---------- shopping ----------
export async function getList() {
  let list = must(await sb.from("shopping_lists").select("*").eq("archived", false).order("created_at", { ascending: false }).limit(1).maybeSingle());
  if (!list) list = must(await sb.from("shopping_lists").insert({ name: "Shopping list" }).select("*").single());
  return list;
}
export async function listItems(listId) {
  return must(await sb.from("shopping_list_items").select("*").eq("list_id", listId).order("created_at"));
}
export async function recipeTitles(ids) {
  if (!ids.length) return new Map();
  const rows = must(await sb.from("recipes").select("id,title").in("id", ids));
  return new Map(rows.map((r) => [r.id, r.title]));
}
export async function generateList(listId, from, to) {
  return must(await sb.rpc("generate_shopping_list", { p_list_id: listId, p_from: from, p_to: to }));
}
export async function setChecked(id, checked) { must(await sb.from("shopping_list_items").update({ checked }).eq("id", id)); }
export async function addManualItem(listId, name) {
  must(await sb.from("shopping_list_items").insert({ list_id: listId, name: name.trim(), category: guessCategory(name), is_manual: true }));
}
export async function removeItem(id) { must(await sb.from("shopping_list_items").delete().eq("id", id)); }
export async function clearChecked(listId) { must(await sb.from("shopping_list_items").delete().eq("list_id", listId).eq("checked", true)); }

// ---------- import (edge function) ----------
export async function importRecipe(body) {
  const { data, error } = await sb.functions.invoke("import-recipe", { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.error) msg = j.error; if (j?.code === "quota") { const e = new Error(msg); e.code = "quota"; throw e; } } catch (e) { if (e.code) throw e; }
    throw new Error(msg || "The import failed.");
  }
  if (data?.error || !data?.recipe) throw new Error(data?.error || "Nothing came back from the import.");
  return data;
}

// ---------- account ----------
export async function getUsage() {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const user = await currentUser();
  const [profile, limits, usage] = await Promise.all([
    sb.from("profiles").select("tier,display_name").eq("id", user.id).maybeSingle().then(must),
    sb.from("tier_limits").select("tier,kind,monthly_limit").then(must),
    sb.from("ai_usage").select("kind").gte("created_at", start.toISOString()).then(must),
  ]);
  const tier = profile?.tier ?? "free";
  const used = {}; for (const u of usage) used[u.kind] = (used[u.kind] || 0) + 1;
  return { tier, name: profile?.display_name ?? "", limits: limits.filter((l) => l.tier === tier), used };
}
export async function setDisplayName(name) { must(await sb.from("profiles").update({ display_name: name || null }).eq("id", await uid())); }

export async function exportAll() {
  const ids = (await listRecipes()).map((r) => r.id);
  const recipes = []; for (const id of ids) recipes.push(await getRecipe(id));
  const plan = must(await sb.from("meal_plan_entries").select("*"));
  const cooked = must(await sb.from("cook_events").select("*"));
  return { exported_at: new Date().toISOString(), recipes, meal_plan: plan, cook_events: cooked };
}
export async function deleteAccount() {
  const { error } = await sb.functions.invoke("delete-account", { body: {} });
  if (error) throw new Error("Couldn't delete the account. Try again in a moment.");
  await sb.auth.signOut();
}
