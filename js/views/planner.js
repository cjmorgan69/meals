import { h, mount, toast, busy, modal, confirmBox } from "../ui.js";
import { listRecipes, getPlan, addPlan, setPlanStatus, removePlan, logCooked } from "../api.js";
import { iso, parseISO, addDays, dayLabel, dateLabel } from "../dates.js";
import { printPlan } from "../print.js";
import { forecastFor, getPosition, classifyWeather, weatherText, suggest } from "../weather.js";

const midnight = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
let weekStart = midnight(); // the plan shows 7 days from here, starting today
let forecast = null;

export async function render(root) {
  if (weekStart < midnight()) weekStart = midnight(); // the app was left open past midnight: never show past days
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
      h("button.btn.small", { "aria-label": "Previous 7 days", disabled: iso(weekStart) <= today, onclick: () => { weekStart = addDays(weekStart, -7); if (weekStart < midnight()) weekStart = midnight(); forecast = null; redraw(); } }, "‹"),
      h("span", {}, iso(weekStart) === today ? "Next 7 days" : `${dateLabel(weekStart)} – ${dateLabel(addDays(weekStart, 6))}`),
      h("button.btn.small", { "aria-label": "Next 7 days", onclick: () => { weekStart = addDays(weekStart, 7); forecast = null; redraw(); } }, "›"),
      iso(weekStart) !== today ? h("button.btn.small", { onclick: () => { weekStart = midnight(); forecast = null; redraw(); } }, "Today") : null));

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

  mount(root, nav, h("div.row", { style: "margin:.5rem 0 1rem" }, ideaBtn, wxBtn, h("a.btn.small", { href: `#/shopping/${from}/${to}` }, "Shopping list for these days"), h("button.btn.small", { onclick: () => fridgeModal(from) }, "Print for the fridge")), ideas, h("div", {}, list));
}

function fridgeModal(defaultFrom) {
  modal((box, close) => {
    const today = new Date();
    const nextMonday = () => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate()); const add = ((8 - d.getDay()) % 7) || 7; return addDays(d, add); };
    const from = h("input", { type: "date", id: "pf", value: defaultFrom, min: iso(today) });
    const len = h("select", { id: "pn" }, [3, 5, 7, 10, 14].map((n) => h("option", { value: n, selected: n === 7 }, `${n} days`)));
    const paper = h("select", { id: "pp" }, h("option", { value: "A4" }, "A4"), h("option", { value: "Letter" }, "US Letter"));
    const orient = h("select", { id: "po" }, h("option", { value: "landscape" }, "Landscape"), h("option", { value: "portrait" }, "Portrait"));
    const dinners = h("input", { type: "checkbox", id: "pd" });
    const title = h("input", { type: "text", id: "pt", value: "What's for dinner", maxlength: 40 });
    const err = h("p.error", { role: "alert" });
    const go = h("button.btn.primary", { onclick: () => busy(go, async () => {
      err.textContent = "";
      if (!from.value) { err.textContent = "Pick a start date."; return; }
      const start = parseISO(from.value), n = Number(len.value), end = addDays(start, n - 1);
      let entries = (await getPlan(iso(start), iso(end))).filter((e) => e.status !== "skipped");
      if (dinners.checked) entries = entries.filter((e) => e.meal === "dinner");
      const order = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
      const days = Array.from({ length: n }, (_, i) => {
        const d = addDays(start, i), key = iso(d);
        return { date: d, entries: entries.filter((e) => e.planned_date === key).sort((a, b) => order[a.meal] - order[b.meal])
          .map((e) => ({ title: e.recipes?.title || "Recipe", image_path: e.recipes?.image_path || null, meal: e.meal })) };
      });
      close();
      await printPlan(days, { title: title.value.trim() || "What's for dinner", paper: paper.value, orientation: orient.value });
    }, { onError: (x) => { err.textContent = x.message; } }) }, "Make PDF");
    mount(box,
      h("h2", {}, "Print the plan for the fridge"),
      h("div.field", {}, h("label", { for: "pt" }, "Heading"), title),
      h("div.field", {}, h("label", { for: "pf" }, "Start on"), from,
        h("div.row", { style: "margin-top:.4rem" },
          h("button.btn.small", { type: "button", onclick: () => { from.value = iso(today); } }, "Today"),
          h("button.btn.small", { type: "button", onclick: () => { from.value = iso(addDays(today, 1)); } }, "Tomorrow"),
          h("button.btn.small", { type: "button", onclick: () => { from.value = iso(nextMonday()); } }, "Next Monday"))),
      h("div.row", {}, h("div.field", {}, h("label", { for: "pn" }, "For"), len), h("div.field", {}, h("label", { for: "pp" }, "Paper"), paper), h("div.field", {}, h("label", { for: "po" }, "Layout"), orient)),
      h("label", { style: "display:flex;gap:.5rem;align-items:center;margin-bottom:.8rem" }, dinners, "Dinners only"),
      h("p.hint", {}, "Your browser's print window opens. Choose “Save as PDF”, or print it straight away."),
      err,
      h("div.row.end", {}, h("button.btn", { onclick: close }, "Cancel"), go));
  });
}
