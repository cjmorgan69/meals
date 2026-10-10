// Builds a print-ready recipe book in the page and opens the browser's print dialog ("Save as PDF").
import { h, modal } from "./ui.js";
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

/**
 * Puts print-ready pages in the document and opens the print dialog ("Save as PDF").
 * Phones only allow printing straight after a tap, and building the pages takes a moment, so on a phone
 * (or any time the tap has expired) we show a "ready" box and print from its button.
 */
async function present(pages, { paper = "A4", orientation = "portrait" } = {}) {
  document.getElementById("print-root")?.remove(); // a leftover from an earlier attempt
  const size = `${paper === "Letter" ? "letter" : "A4"} ${orientation}`;
  const style = h("style", {}, `@page{size:${size};margin:16mm}`);
  const root = h("div", { id: "print-root" }, style, ...pages);
  document.body.append(root);
  document.body.classList.add("printing");
  await Promise.all([...root.querySelectorAll("img")].map(loadImg));
  const done = () => { root.remove(); document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  const needsTap = navigator.userActivation ? !navigator.userActivation.isActive : false;
  const phone = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (!needsTap && !phone) { window.print(); return; }
  modal((box, close) => {
    const finish = () => { close(); done(); };
    box.append(
      h("h2", {}, "Ready to print"),
      h("p", {}, "Tap the button, then choose “Save as PDF” (or your printer) in the window that opens."),
      h("div.row.end", {},
        h("button.btn", { onclick: finish }, "Cancel"),
        h("button.btn.primary", { onclick: () => window.print() }, "Print / Save as PDF")),
      h("p.hint", {}, "If nothing opens, open this page in your phone's browser (Safari or Chrome) rather than the installed app, and try again."));
  });
}

export async function printRecipes(recipes, { title = "My recipes", paper = "A4", cover = true } = {}) {
  const imgs = await Promise.all(recipes.map((r) => photoUrl(r.image_path).catch(() => null)));
  const pages = [];
  if (cover) {
    pages.push(h("section.bk-cover", {}, h("h1", {}, title), h("p", {}, `${recipes.length} recipe${recipes.length === 1 ? "" : "s"}`)));
    pages.push(h("section.bk-toc", {}, h("h2", {}, "Contents"), h("ol", {}, recipes.map((r) => h("li", {}, r.title)))));
  }
  recipes.forEach((r, n) => pages.push(recipePage(r, imgs[n])));
  await present(pages, { paper, orientation: "portrait" });
}

const MEAL_LABEL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

/**
 * A fridge sheet: one tile per day with the date and each planned meal's photo and name.
 * days: [{ date: Date, entries: [{ title, image_path, meal }] }]
 */
export async function printPlan(days, { title = "What's for dinner", paper = "A4", orientation = "landscape" } = {}) {
  const paths = [...new Set(days.flatMap((d) => d.entries.map((e) => e.image_path)).filter(Boolean))];
  const urls = new Map(await Promise.all(paths.map(async (p) => [p, await photoUrl(p).catch(() => null)])));
  const perPage = 8; // 4 x 2 landscape, 2 x 4 portrait
  const fmt = (d, o) => d.toLocaleDateString("en-AU", o);
  const range = days.length ? `${fmt(days[0].date, { day: "numeric", month: "long" })} – ${fmt(days[days.length - 1].date, { day: "numeric", month: "long", year: "numeric" })}` : "";

  const tile = (d) => {
    const many = d.entries.length > 1;
    return h("div.pl-day", {},
      h("div.pl-date", {}, h("strong", {}, fmt(d.date, { weekday: "long" })), h("span", {}, fmt(d.date, { day: "numeric", month: "short" }))),
      d.entries.length ? h("div.pl-meals" + (many ? ".many" : ""), {}, d.entries.map((e) => {
        const u = urls.get(e.image_path);
        return h("div.pl-meal", {},
          u ? h("img", { src: u, alt: "" }) : h("div.pl-noimg", {}),
          h("div.pl-name", {}, (many || e.meal !== "dinner") ? h("small", {}, MEAL_LABEL[e.meal] || e.meal) : null, e.title));
      })) : h("div.pl-empty", {}, "Nothing planned"));
  };

  const pages = [];
  for (let i = 0; i < Math.max(days.length, 1); i += perPage) {
    pages.push(h("section.pl-page", {},
      h("div.pl-head", {}, h("h1", {}, title), h("p", {}, range)),
      h("div.pl-grid." + (orientation === "landscape" ? "land" : "port"), {}, days.slice(i, i + perPage).map(tile))));
  }
  await present(pages, { paper, orientation });
}
