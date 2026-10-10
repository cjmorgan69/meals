import { h, mount, toast, busy, confirmBox, modal } from "../ui.js";
import { getRecipe, photoUrl, setFavourite, deleteRecipe, logCooked, addPlan } from "../api.js";
import { formatQuantity, formatNumber, fmtDuration } from "../units.js";
import { iso } from "../dates.js";
import { printRecipes } from "../print.js";
import { quickPlan } from "../quickplan.js";

export async function render(root, [id]) {
  const r = await getRecipe(id);
  if (!r) return mount(root, h("div.empty", {}, h("h2", {}, "Recipe not found"), h("a.btn", { href: "#/recipes" }, "Back to recipes")));
  let servings = r.servings;

  const ingBox = h("div"), servBox = h("span");
  function drawIngredients() {
    const scale = servings / r.servings;
    const items = []; let lastGroup = null;
    for (const i of r.ingredients) {
      if (i.group_label && i.group_label !== lastGroup) items.push(h("li.grp", {}, i.group_label));
      lastGroup = i.group_label;
      const text = i.quantity != null && scale !== 1
        ? `${formatQuantity(i.quantity * scale, i.unit)} ${i.raw_text.replace(/^[\d\s.,/¼½¾⅓⅔⅛]+(g|kg|ml|l|oz|lbs?|pounds?|ounces?|tsp|tbsp|cups?|cloves?|bunch(es)?|cans?|tins?|pinch(es)?)?\.?\s*/i, "")}`.trim()
        : i.raw_text;
      items.push(h("li", {}, text, i.optional ? h("span.chip", { style: "margin-left:.4rem" }, "optional") : null));
    }
    mount(ingBox, h("ul.ing-list", {}, items));
    servBox.textContent = formatNumber(servings);
  }

  const timers = new Map();
  function stepEl(s, n) {
    const t = s.timer_seconds ? h("button.btn.small.timer", { onclick: (e) => toggleTimer(e.currentTarget, s.timer_seconds) }, `⏱ ${fmtDuration(s.timer_seconds)}`) : null;
    return h("li", {}, h("span.n", {}, n + 1), h("div", {}, h("div", {}, s.instruction), t));
  }
  function toggleTimer(btn, secs) {
    if (timers.has(btn)) { clearInterval(timers.get(btn)); timers.delete(btn); btn.textContent = `⏱ ${fmtDuration(secs)}`; btn.classList.remove("running"); return; }
    let left = secs; btn.classList.add("running");
    const tick = () => {
      if (left <= 0) { clearInterval(timers.get(btn)); timers.delete(btn); btn.textContent = "⏱ Time's up"; toast("Timer finished"); try { navigator.vibrate?.(300); } catch {} return; }
      btn.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} — tap to stop`; left--;
    };
    tick(); timers.set(btn, setInterval(tick, 1000));
  }

  const pic = h("div");
  if (r.image_path) photoUrl(r.image_path).then((u) => { if (u) { mount(pic, h("img", { src: u, alt: r.title })); pic.parentElement?.classList.add("has-pic"); } });
  const fav = h("button.btn.small", { onclick: () => busy(fav, async () => { r.is_favourite = !r.is_favourite; await setFavourite(r.id, r.is_favourite); fav.textContent = r.is_favourite ? "★ Favourite" : "☆ Favourite"; }) }, r.is_favourite ? "★ Favourite" : "☆ Favourite");
  const mins = (r.prep_minutes || 0) + (r.cook_minutes || 0);

  mount(root,
    h("p", {}, h("a", { href: "#/recipes" }, "‹ Recipes")),
    h("div.hero", {}, h("div", {},
      h("h1", {}, r.title),
      r.description ? h("p", {}, r.description) : null,
      h("p.hint", {}, [r.prep_minutes ? `Prep ${r.prep_minutes} min` : null, r.cook_minutes ? `Cook ${r.cook_minutes} min` : null, mins ? null : null, r.times_cooked ? `Cooked ${r.times_cooked} time${r.times_cooked > 1 ? "s" : ""}` : "Not cooked yet"].filter(Boolean).join(" · ")),
      r.tags.length ? h("div.row", {}, r.tags.map((t) => h("span.chip", {}, t))) : null,
      r.source_url ? h("p.hint", {}, "From ", h("a", { href: r.source_url, rel: "noopener noreferrer", target: "_blank" }, new URL(r.source_url).hostname)) : null,
      h("div.row", { style: "margin-top:.8rem" }, r.video_url ? h("a.btn.small.primary", { href: r.video_url, target: "_blank", rel: "noopener noreferrer" }, "▶ Watch video") : null, fav,
        h("button.btn.small", { onclick: () => quickPlan(r) }, "Add to plan"),
        h("button.btn.small", { onclick: () => cookedModal(r) }, "I cooked this"),
        h("button.btn.small", { onclick: (e) => busy(e.currentTarget, () => printRecipes([r], { title: r.title, cover: false })) }, "Print / PDF"),
        h("a.btn.small", { href: `#/edit/${r.id}` }, "Edit"),
        h("button.btn.small.danger", { onclick: async () => { if (await confirmBox("Delete this recipe?", `“${r.title}” will be removed from your recipes and any meal plans.`)) { await deleteRecipe(r.id, r.image_path); toast("Deleted"); location.hash = "#/recipes"; } } }, "Delete"))),
      pic),
    h("div.card", { style: "margin-top:1.2rem" },
      h("div.row.spread", {}, h("h2", {}, "Ingredients"),
        h("div.row", {}, h("button.btn.small", { "aria-label": "Fewer servings", onclick: () => { servings = Math.max(1, servings - 1); drawIngredients(); } }, "−"),
          h("span", {}, "Serves ", servBox),
          h("button.btn.small", { "aria-label": "More servings", onclick: () => { servings += 1; drawIngredients(); } }, "+"))),
      ingBox),
    h("div.card", { style: "margin-top:1rem" }, h("h2", {}, "Method"), h("ol.step-list", {}, r.steps.map(stepEl))));
  drawIngredients();
}

function cookedModal(r) {
  modal((box, close) => {
    let rating = 0;
    const stars = h("div.row", {}, [1, 2, 3, 4, 5].map((n) => h("button.btn.small", { "aria-label": `${n} star${n > 1 ? "s" : ""}`, onclick: (e) => { rating = n; [...stars.children].forEach((b, i) => b.classList.toggle("primary", i < n)); } }, "★")));
    const go = h("button.btn.primary", { onclick: () => busy(go, async () => { await logCooked(r.id, rating); toast("Logged. Nice one."); close(); }) }, "Save");
    mount(box, h("h2", {}, "How was it?"), stars, h("p.hint", {}, "A rating is optional."), h("div.row.end", {}, h("button.btn", { onclick: close }, "Cancel"), go));
  });
}
