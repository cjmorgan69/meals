// Builds a print-ready recipe book in the page and opens the browser's print dialog ("Save as PDF").
import { h } from "./ui.js";
import { photoUrl } from "./api.js";
import { fmtDuration } from "./units.js";

const loadImg = (img) => new Promise((res) => { if (img.complete) res(); else { img.onload = res; img.onerror = res; } });

function recipePage(r, img) {
  const meta = [r.prep_minutes ? `Prep ${r.prep_minutes} min` : null, r.cook_minutes ? `Cook ${r.cook_minutes} min` : null, `Serves ${r.servings}`].filter(Boolean).join("   ·   ");
  let last = null;
  const ings = r.ingredients.map((i) => {
    const out = [];
    if (i.group_label && i.group_label !== last) out.push(h("li.pg", {}, i.group_label));
    last = i.group_label;
    out.push(h("li", {}, i.raw_text + (i.optional ? " (optional)" : "")));
    return out;
  });
  return h("section.bk-recipe", {},
    h("h2", {}, r.title),
    r.description ? h("p.bk-desc", {}, r.description) : null,
    h("p.bk-meta", {}, meta),
    img ? h("img.bk-photo", { src: img, alt: "" }) : null,
    h("div.bk-cols", {},
      h("div.bk-ings", {}, h("h3", {}, "Ingredients"), h("ul", {}, ings)),
      h("div.bk-steps", {}, h("h3", {}, "Method"),
        h("ol", {}, r.steps.map((s) => h("li", {}, s.instruction, s.timer_seconds ? h("em", {}, `  (${fmtDuration(s.timer_seconds)})`) : null))))),
    r.source_url ? h("p.bk-src", {}, `Source: ${r.source_url}`) : null);
}

export async function printRecipes(recipes, { title = "My recipes", paper = "A4", cover = true } = {}) {
  const imgs = await Promise.all(recipes.map((r) => photoUrl(r.image_path).catch(() => null)));
  const pages = [];
  if (cover) {
    pages.push(h("section.bk-cover", {}, h("h1", {}, title), h("p", {}, `${recipes.length} recipe${recipes.length === 1 ? "" : "s"}`)));
    pages.push(h("section.bk-toc", {}, h("h2", {}, "Contents"), h("ol", {}, recipes.map((r) => h("li", {}, r.title)))));
  }
  recipes.forEach((r, n) => pages.push(recipePage(r, imgs[n])));

  const style = h("style", {}, `@page{size:${paper === "Letter" ? "letter" : "A4"};margin:16mm}`);
  const root = h("div", { id: "print-root" }, style, ...pages);
  document.body.append(root);
  document.body.classList.add("printing");
  await Promise.all([...root.querySelectorAll("img")].map(loadImg));
  const done = () => { root.remove(); document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
}
