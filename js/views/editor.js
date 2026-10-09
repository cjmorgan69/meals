import { h, mount, busy, toast } from "../ui.js";
import { getRecipe, saveRecipe, uploadPhoto, photoUrl } from "../api.js";
import { state } from "../state.js";
import { UNITS, formatNumber, parseQuantity } from "../units.js";
import { downscaleImage } from "../image.js";

const blank = () => ({ title: "", description: "", servings: 4, prep_minutes: null, cook_minutes: null, tags: [], source: "manual", source_url: null, image_path: null, ingredients: [], steps: [] });

export async function render(root, [id]) {
  const editing = id && id !== "new" ? id : null;
  let r;
  if (editing) { r = await getRecipe(editing); if (!r) return mount(root, h("p.empty", {}, "Recipe not found.")); }
  else if (state.draft) r = { ...blank(), ...state.draft };
  else r = blank();
  const fromDraft = !editing && !!state.draft;
  let photoBlob = !editing ? state.draftPhoto : null;

  const f = {
    title: h("input", { type: "text", id: "t", required: true, value: r.title }),
    desc: h("textarea", { id: "d" }, r.description || ""),
    serves: h("input", { type: "number", id: "s", min: 1, value: r.servings }),
    prep: h("input", { type: "number", id: "p", min: 0, value: r.prep_minutes ?? "" }),
    cook: h("input", { type: "number", id: "c", min: 0, value: r.cook_minutes ?? "" }),
    tags: h("input", { type: "text", id: "g", value: (r.tags || []).join(", "), placeholder: "vegetarian, quick" }),
  };
  const ingBox = h("div"), stepBox = h("div");
  const ings = r.ingredients.map((i) => ({ ...i, qtyText: i.quantity != null ? formatNumber(Number(i.quantity)) : "" }));
  const steps = r.steps.map((s) => ({ ...s }));

  function ingRow(i, n) {
    const qty = h("input", { type: "text", inputmode: "decimal", "aria-label": "Quantity", value: i.qtyText, placeholder: "Qty", oninput: (e) => { i.qtyText = e.target.value; } });
    const unit = h("select", { "aria-label": "Unit", onchange: (e) => { i.unit = e.target.value || null; } }, UNITS.map((u) => h("option", { value: u, selected: (i.unit || "") === u }, u || "—")));
    const txt = h("input", { type: "text", "aria-label": "Ingredient", value: i.raw_text || "", placeholder: "e.g. 2 cloves garlic, crushed", oninput: (e) => { i.raw_text = e.target.value; i.name = i.name && i.raw_text.toLowerCase().includes(i.name) ? i.name : guessName(i.raw_text); } });
    const del = h("button.btn.small.ghost", { type: "button", "aria-label": "Remove ingredient", onclick: () => { ings.splice(n, 1); drawIngs(); } }, "✕");
    return h("div.ed-row", {}, qty, unit, txt, del);
  }
  const drawIngs = () => mount(ingBox, ings.map(ingRow));
  function stepRow(s, n) {
    const t = h("textarea", { "aria-label": `Step ${n + 1}`, oninput: (e) => { s.instruction = e.target.value; } }, s.instruction || "");
    const del = h("button.btn.small.ghost", { type: "button", "aria-label": "Remove step", onclick: () => { steps.splice(n, 1); drawSteps(); } }, "✕");
    return h("div.ed-step", {}, t, del);
  }
  const drawSteps = () => mount(stepBox, steps.map(stepRow));
  drawIngs(); drawSteps();

  const photoPrev = h("div"), photoIn = h("input", { type: "file", accept: "image/*", "aria-label": "Photo", onchange: async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { photoBlob = (await downscaleImage(file)).blob; showPhoto(URL.createObjectURL(photoBlob)); } catch (err) { toast(err.message, true); }
  } });
  const showPhoto = (u) => mount(photoPrev, u ? h("img", { src: u, alt: "", style: "max-width:240px;border-radius:10px" }) : null);
  if (photoBlob) showPhoto(URL.createObjectURL(photoBlob)); else if (r.image_path) photoUrl(r.image_path).then(showPhoto);

  const err = h("p.error", { role: "alert" });
  const save = h("button.btn.primary", { type: "submit" }, "Save recipe");
  const form = h("form", { onsubmit: (e) => {
    e.preventDefault(); err.textContent = "";
    if (!f.title.value.trim()) { err.textContent = "Give the recipe a title."; return; }
    for (const i of ings) {
      const q = parseQuantity(i.qtyText);
      if (Number.isNaN(q)) { err.textContent = `“${i.qtyText}” isn't a quantity. Use a number like 2, 1/2 or 1.5.`; return; }
      i.quantity = q;
    }
    busy(save, async () => {
      let image_path = r.image_path || null;
      if (photoBlob && (!editing || photoBlob !== state.draftPhoto)) { try { image_path = await uploadPhoto(photoBlob); } catch (x) { toast("Saved without the photo: " + x.message, true); } }
      const rec = {
        title: f.title.value, description: f.desc.value.trim(), servings: Math.max(1, Number(f.serves.value) || 4),
        prep_minutes: f.prep.value === "" ? null : Number(f.prep.value), cook_minutes: f.cook.value === "" ? null : Number(f.cook.value),
        tags: f.tags.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
        source: r.source || "manual", source_url: r.source_url || null, image_path,
        ingredients: ings.map((i) => ({ raw_text: i.raw_text, name: i.name || guessName(i.raw_text), quantity: i.quantity, unit: i.unit, note: i.note, optional: i.optional, group_label: i.group_label })),
        steps: steps.map((s) => ({ instruction: s.instruction || "", timer_seconds: s.timer_seconds ?? null })),
      };
      const rid = await saveRecipe(rec, editing);
      state.draft = null; state.draftPhoto = null;
      toast("Saved");
      location.hash = `#/recipe/${rid}`;
    });
  } },
    h("div.field", {}, h("label", { for: "t" }, "Title"), f.title),
    h("div.field", {}, h("label", { for: "d" }, "Description"), f.desc),
    h("div.row", {},
      h("div.field", {}, h("label", { for: "s" }, "Serves"), f.serves),
      h("div.field", {}, h("label", { for: "p" }, "Prep (min)"), f.prep),
      h("div.field", {}, h("label", { for: "c" }, "Cook (min)"), f.cook)),
    h("div.field", {}, h("label", { for: "g" }, "Tags"), f.tags, h("span.hint", {}, "Separate with commas.")),
    h("div.field", {}, h("label", {}, "Photo"), photoIn, photoPrev),
    h("h2", {}, "Ingredients"), ingBox,
    h("button.btn.small", { type: "button", onclick: () => { ings.push({ raw_text: "", qtyText: "", unit: null, name: "" }); drawIngs(); ingBox.querySelector(".ed-row:last-child input[aria-label=Ingredient]")?.focus(); } }, "Add ingredient"),
    h("h2", { style: "margin-top:1.4rem" }, "Method"), stepBox,
    h("button.btn.small", { type: "button", onclick: () => { steps.push({ instruction: "", timer_seconds: null }); drawSteps(); stepBox.querySelector(".ed-step:last-child textarea")?.focus(); } }, "Add step"),
    err,
    h("div.row.end", { style: "margin-top:1.2rem" }, h("a.btn", { href: editing ? `#/recipe/${editing}` : "#/recipes", onclick: () => { if (!editing) { state.draft = null; state.draftPhoto = null; } } }, "Cancel"), save));

  mount(root, h("h1", {}, editing ? "Edit recipe" : fromDraft ? "Check the imported recipe" : "New recipe"),
    fromDraft ? h("p.hint", {}, "Imported recipes can contain mistakes. Check the quantities before you save.") : null,
    h("div.card", {}, form));
}

// Name used to match/create the ingredient record: drop leading quantity/unit and trailing prep notes.
function guessName(raw) {
  return String(raw || "").toLowerCase()
    .replace(/^[\d\s.,/¼½¾⅓⅔⅛-]+/, "")
    .replace(/^(g|kg|ml|l|oz|lbs?|tsp|tbsp|cups?|cloves?|bunch(es)?|cans?|tins?|pinch(es)?|large|small|medium)\b\.?\s*/g, "")
    .replace(/^of\s+/, "").split(",")[0].replace(/\(.*?\)/g, "").trim();
}
