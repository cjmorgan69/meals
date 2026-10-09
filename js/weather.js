// Rule-based weather suggestions: no AI, no cost. Open-Meteo needs no key.
export async function forecastFor(lat, lon) {
  const la = lat.toFixed(1), lo = lon.toFixed(1); // rounded: ~10 km is plenty and avoids sending an exact location
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=auto&forecast_days=7`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Couldn't load the forecast.");
  const j = await r.json();
  return j.daily.time.map((date, i) => ({
    date, max: j.daily.temperature_2m_max[i], min: j.daily.temperature_2m_min[i],
    rain: j.daily.precipitation_sum[i], code: j.daily.weathercode[i],
  }));
}
export function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("This browser can't share a location."));
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => rej(new Error("Location is blocked. Allow it in your browser to get weather ideas.")), { timeout: 10000 });
  });
}
export function classifyWeather(d) {
  if (d.max >= 27) return "hot";
  if (d.max <= 14 || d.rain >= 5) return "cold";
  return "mild";
}
export const weatherText = (d) => {
  const k = classifyWeather(d);
  const icon = d.rain >= 5 ? "🌧" : d.max >= 27 ? "☀️" : d.max <= 14 ? "🥶" : "⛅";
  return `${icon} ${Math.round(d.min)}–${Math.round(d.max)}°C` + (k === "hot" ? ", hot" : k === "cold" ? ", cool or wet" : "");
};
const HOT = /\b(salad|grill|bbq|barbecue|cold|chilled|ceviche|gazpacho|wrap|slaw|poke|noodle salad|skewer|burger)\b/i;
const COLD = /\b(soup|stew|roast|curry|casserole|bake|braise|chilli|pie|lasagne|risotto|hotpot|dumpling|pasta bake|slow)\b/i;
export function scoreRecipe(r, kind, today = new Date()) {
  const text = `${r.title} ${(r.tags || []).join(" ")}`;
  let s = 0;
  if (kind === "hot") { if (HOT.test(text)) s += 3; if (COLD.test(text)) s -= 2; }
  if (kind === "cold") { if (COLD.test(text)) s += 3; if (HOT.test(text)) s -= 2; }
  if (r.is_favourite) s += 1;
  if (r.last_cooked_on) {
    const days = (today - new Date(r.last_cooked_on)) / 86400000;
    s += days > 28 ? 1.5 : days < 7 ? -3 : 0;
  } else s += 0.5; // never cooked: worth a try
  return s;
}
export function suggest(recipes, kind, n = 3, exclude = new Set()) {
  return recipes.filter((r) => !exclude.has(r.id))
    .map((r) => ({ r, s: scoreRecipe(r, kind) + Math.random() * 0.3 }))
    .sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.r);
}
