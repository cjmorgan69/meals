// Counts how often each recipe has been on the plan (pure, so it can be tested without a database).
export function summariseUsage(planRows, cookRows) {
  const days = new Map(); // recipe id -> Set of dates
  const add = (id, d) => { if (!id || !d) return; if (!days.has(id)) days.set(id, new Set()); days.get(id).add(d); };
  planRows.forEach((p) => add(p.recipe_id, p.planned_date));
  cookRows.forEach((c) => add(c.recipe_id, c.cooked_on));
  return new Map([...days].map(([id, set]) => [id, { times_planned: set.size, last_planned_on: [...set].sort().at(-1) }]));
}
