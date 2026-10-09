import { h, mount, toast, busy, modal, confirmBox } from "../ui.js";
import { listRecipes, getPlan, addPlan, setPlanStatus, removePlan, logCooked } from "../api.js";
import { iso, parseISO, addDays, startOfWeek, dayLabel, dateLabel } from "../dates.js";
import { forecastFor, getPosition, classifyWeather, weatherText, suggest } from "../weather.js";

let weekStart = startOfWeek(new Date());
let forecast = null;

export async function render(root) {
  const from = iso(weekStart), to = iso(addDays(weekStart, 6));
  const [recipes, plan] = await Promise.all([listRecipes(), getPlan(from, to)]);
  const today = iso(new Date());
  const wx = new Map((forecast || []).map((d) => [d.date, d]));
  const redraw = () => render(root);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const list = days.map((d) => {
    const key = iso(d), entries = plan.filter((p) => p.planned_date === key), w = wx.get(key);
    return h("div.day" + (key === today ? ".today" : ""), {},
      h("div.d", {}, dayLabel(d), h("small", {}, dateLabel(d))),
      h("div", {},
        w ? h("div.wx", {}, weatherText(w)) : null,
        entries.map((p) => h("div.plan-item" + (p.status === "cooked" ? ".cooked" : ""), {},
          h("a.t.grow", { href: `#/recipe/${p.recipe_id}` }, p.recipes?.title || "Recipe"),
          p.meal !== "dinner" ? h("span.chip", {}, p.meal) : null,
          p.status !== "cooked" ? h("button.btn.small", { onclick: (e) => busy(e.currentTarget, async () => { await setPlanStatus(p.id, "cooked"); toast("Marked as cooked"); redraw(); }) }, "Cooked") : h("span.chip", {}, "cooked"),
          h("button.btn.small.ghost", { "aria-label": "Remove from plan", onclick: async () => { await removePlan(p.id); redraw(); } }, "✕"))),
        h("button.btn.small.ghost", { onclick: () => pick(key) }, "+ Add meal")));
  });

  function pick(date) {
    if (!recipes.length) { toast("Add a recipe first", true); return; }
    modal((box, close) => {
      const q = h("input", { type: "search", placeholder: "Search your recipes", "aria-label": "Search" });
      const res = h("div");
      const draw = () => {
        const s = q.value.toLowerCase();
        mount(res, recipes.filter((r) => r.title.toLowerCase().includes(s)).slice(0, 30).map((r) =>
          h("button.btn.ghost", { style: "display:block;width:100%;text-align:left", onclick: async () => { await addPlan(r.id, date); close(); redraw(); } }, r.title, r.last_cooked_on ? h("span.hint", {}, `  last cooked ${r.last_cooked_on}`) : null)));
      };
      q.addEventListener("input", draw); draw();
      mount(box, h("h2", {}, "Pick a recipe"), q, res, h("div.row.end", {}, h("button.btn", { onclick: close }, "Close")));
    });
  }

  const nav = h("div.row.spread", {},
    h("h1", {}, "Plan"),
    h("div.row", {},
      h("button.btn.small", { "aria-label": "Previous week", onclick: () => { weekStart = addDays(weekStart, -7); forecast = null; redraw(); } }, "‹"),
      h("span", {}, `${dateLabel(weekStart)} – ${dateLabel(addDays(weekStart, 6))}`),
      h("button.btn.small", { "aria-label": "Next week", onclick: () => { weekStart = addDays(weekStart, 7); forecast = null; redraw(); } }, "›")));

  const ideas = h("div");
  const wxBtn = h("button.btn.small", { onclick: () => busy(wxBtn, async () => {
    const pos = await getPosition();
    forecast = await forecastFor(pos.lat, pos.lon);
    redraw();
  }) }, forecast ? "Refresh weather" : "Use the weather");
  const ideaBtn = h("button.btn.small", { onclick: () => {
    const planned = new Set(plan.map((p) => p.recipe_id));
    const w = forecast?.find((d) => d.date >= today) || null;
    const kind = w ? classifyWeather(w) : "mild";
    const picks = suggest(recipes, kind, 3, planned);
    mount(ideas, picks.length ? h("div.card", {},
      h("h3", {}, w ? `Ideas for ${kind === "hot" ? "a hot" : kind === "cold" ? "a cool or wet" : "a mild"} day` : "Ideas"),
      h("p.hint", {}, "Based on the forecast, your favourites and what you haven't cooked lately."),
      picks.map((r) => h("div.plan-item", {}, h("a.grow", { href: `#/recipe/${r.id}` }, r.title),
        h("button.btn.small", { onclick: async () => { await addPlan(r.id, w?.date || today); redraw(); } }, "Plan it")))) : h("p.hint", {}, "Nothing new to suggest yet. Add more recipes."));
  } }, "Suggest dinners");

  mount(root, nav, h("div.row", { style: "margin:.5rem 0 1rem" }, ideaBtn, wxBtn, h("a.btn.small", { href: `#/shopping/${from}/${to}` }, "Shopping list for this week")), ideas, h("div", {}, list));
}
