import { h, mount, busy, toast } from "../ui.js";
import { getRecipe, saveRecipe, uploadPhoto, photoUrl, deletePhoto } from "../api.js";
import { state } from "../state.js";
import { UNITS, formatNumber, parseQuantity } from "../units.js";
import { downscaleImage } from "../image.js";
import { stripQuantity, ingredientName, composeLine, cleanDisplayName } from "../ingredient-text.js";

const blank = () => ({ title: "", description: "", servings: 4, prep_minutes: null, cook_minutes: null, tags: [], source: "manual", source_url: null, image_path: null, ingredients: [], steps: [] });

export async function render(root, [id]) {
  const editing = id && id !== "new" ? id : null;
  let r;
  if (editing) { r = await getRecipe(editing); if (!r) return mount(root, h("p.empty", {}, "Recipe not found.")); }
  else if (state.draft) r = { ...blank(), ...state.draft };
  else r = blank();
  const fromDraft = !editing && !!state.draft;
  let photoBlob = !editing ? state.draftPhoto : null;
  let removePhoto = false;
  // Textareas grow with their text so the phone never scrolls inside a box while you type.
  const grow = (t) => { t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; };
  const autogrow = (t) => { t.classList.add("autogrow"); t.addEventListener("input", () => grow(t)); requestAnimationFrame(() => grow(t)); return t; };

  const f = {
    title: h("input", { type: "text", id: "t", required: true, value: r.title }),
    desc: autogrow(h("textarea", { id: "d" }, r.description || "")),
    serves: h("input", { type: "number", id: "s", min: 1, value: r.servings }),
    prep: h("input", { type: "number", id: "p", min: 0, value: r.prep_minutes ?? "" }),
    cook: h("input", { type: "number", id: "c", min: 0, value: r.cook_minutes ?? "" }),
    video: h("input", { type: "url", id: "v", value: r.video_url || "", placeholder: "https://www.youtube.com/watch?v=…" }),
    tags: h("input", { type: "text", id: "g", value: (r.tags || []).join(", "), placeholder: "vegetarian, quick" }),
  };
  const ingBox = h("div"), stepBox = h("div");
  // The text box holds the ingredient without its amount; the amount lives in the Qty and unit boxes.
  const ings = r.ingredients.map((i) => {
    const qtyText = i.quantity != null ? formatNumber(Number(i.quantity)) : "", label = stripQuantity(i.raw_text || "");
    return { ...i, qtyText, label, start: { raw: i.raw_text || "", label, qtyText, unit: i.unit || null } };
  });
  const steps = r.steps.map((s) => ({ ...s }));

  function ingRow(i, n) {
    const qty = h("input", { type: "text", inputmode: "decimal", "aria-label": "Quantity", value: i.qtyText, placeholder: "Qty", oninput: (e) => { i.qtyText = e.target.value; } });
    const unit = h("select", { "aria-label": "Unit", onchange: (e) => { i.unit = e.target.value || null; } }, UNITS.map((u) => h("option", { value: u, selected: (i.unit || "") === u }, u || "—")));
    const txt = h("input", { type: "text", "aria-label": "Ingredient", value: i.label || "", placeholder: "e.g. garlic, crushed", oninput: (e) => { i.label = e.target.value; } });
    const del = h("button.btn.small.ghost", { type: "button", "aria-label": "Remove ingredient", onclick: () => { ings.splice(n, 1); drawIngs(); } }, "✕");
    return h("div.ed-row", {}, qty, unit, txt, del);
  }
  const drawIngs = () => mount(ingBox, ings.map(ingRow));
  function stepRow(s, n) {
    const t = autogrow(h("textarea", { "aria-label": `Step ${n + 1}`, oninput: (e) => { s.instruction = e.target.value; } }, s.instruction || ""));
    const del = h("button.btn.small.ghost", { type: "button", "aria-label": "Remove step", onclick: () => { steps.splice(n, 1); drawSteps(); } }, "✕");
    return h("div.ed-step", {}, t, del);
  }
  const drawSteps = () => mount(stepBox, steps.map(stepRow));
  drawIngs(); drawSteps();

  const photoPrev = h("div"), photoIn = h("input", { type: "file", accept: "image/*", "aria-label": "Photo", onchange: async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { photoBlob = (await downscaleImage(file)).blob; removePhoto = false; showPhoto(URL.createObjectURL(photoBlob)); } catch (err) { toast(err.message, true); }
  } });
  const dropPhoto = () => { photoBlob = null; removePhoto = true; photoIn.value = ""; showPhoto(null); };
  const showPhoto = (u) => mount(photoPrev, u ? h("img", { src: u, alt: "", style: "max-width:240px;border-radius:10px;display:block" }) : null,
    u ? h("button.btn.small", { type: "button", style: "margin-top:.4rem", onclick: dropPhoto }, "Remove photo") : null, u && state.draftPhotoFromWeb && photoBlob === state.draftPhoto ? h("p.hint", {}, "Photo taken from the recipe page. Choose a file to replace it.") : null);
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
      const same = i.start && i.label === i.start.label && i.qtyText === i.start.qtyText && (i.unit || null) === i.start.unit;
      i.raw_text = same ? i.start.raw : composeLine(q, i.unit, i.label);
      if (!(i.start && i.label === i.start.label && i.name && cleanDisplayName(i.name) === i.name)) i.name = ingredientName(i.label);
    }
    const vid = f.video.value.trim();
    if (vid && !/^https?:\/\//i.test(vid)) { err.textContent = "The video link should start with https://"; return; }
    busy(save, async () => {
      let image_path = removePhoto ? null : r.image_path || null;
      if (photoBlob && (!editing || photoBlob !== state.draftPhoto)) { try { image_path = await uploadPhoto(photoBlob); } catch (x) { toast("Saved without the photo: " + x.message, true); } }
      const rec = {
        title: f.title.value, description: f.desc.value.trim(), servings: Math.max(1, Number(f.serves.value) || 4),
        prep_minutes: f.prep.value === "" ? null : Number(f.prep.value), cook_minutes: f.cook.value === "" ? null : Number(f.cook.value),
        tags: f.tags.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
        source: r.source || "manual", source_url: r.source_url || null, video_url: vid || null, image_path,
        ingredients: ings.map((i) => ({ raw_text: i.raw_text, name: i.name || ingredientName(i.label), quantity: i.quantity, unit: i.unit, note: i.note, optional: i.optional, group_label: i.group_label })),
        steps: steps.map((s) => ({ instruction: s.instruction || "", timer_seconds: s.timer_seconds ?? null })),
      };
      const rid = await saveRecipe(rec, editing);
      if (removePhoto && r.image_path && !photoBlob) { try { await deletePhoto(r.image_path); } catch { /* the file is just left behind */ } }
      state.draft = null; state.draftPhoto = null; state.draftPhotoFromWeb = false;
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
    h("div.field", {}, h("label", { for: "v" }, "Video link"), f.video, h("span.hint", {}, "Optional. A YouTube or Vimeo link.")),
    h("div.field", {}, h("label", { for: "g" }, "Tags"), f.tags, h("span.hint", {}, "Separate with commas.")),
    h("div.field", {}, h("label", {}, "Photo"), photoIn, photoPrev),
    h("h2", {}, "Ingredients"), ingBox,
    h("button.btn.small", { type: "button", onclick: () => { ings.push({ raw_text: "", label: "", qtyText: "", unit: null, name: "" }); drawIngs(); ingBox.querySelector(".ed-row:last-child input[aria-label=Ingredient]")?.focus(); } }, "Add ingredient"),
    h("h2", { style: "margin-top:1.4rem" }, "Method"), stepBox,
    h("button.btn.small", { type: "button", onclick: () => { steps.push({ instruction: "", timer_seconds: null }); drawSteps(); stepBox.querySelector(".ed-step:last-child textarea")?.focus(); } }, "Add step"),
    err,
    h("div.row.end", { style: "margin-top:1.2rem" }, h("a.btn", { href: editing ? `#/recipe/${editing}` : "#/recipes", onclick: () => { if (!editing) { state.draft = null; state.draftPhoto = null; state.draftPhotoFromWeb = false; } } }, "Cancel"), save));

  mount(root, h("h1", {}, editing ? "Edit recipe" : fromDraft ? "Check the imported recipe" : "New recipe"),
    fromDraft ? h("p.hint", {}, "Imported recipes can contain mistakes. Check the quantities before you save.") : null,
    h("div.card", {}, form));
}

// Name used to match/create the ingredient record: drop leading quantity/unit and trailing prep notes.
