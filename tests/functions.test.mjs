import test from "node:test";
import assert from "node:assert/strict";
import { parseIngredientLine, guessCategory, normaliseName, parseLeadingQuantity } from "../supabase/functions/import-recipe/ingredients.ts";
import { parseDuration, parseYield, guessTimer, recipeFromJsonLd, findRecipeNode, instructionsToSteps, imageFromJsonLd } from "../supabase/functions/import-recipe/jsonld.ts";
import { htmlToText, extractJsonLd, decodeEntities, extractMetaImage } from "../supabase/functions/import-recipe/html.ts";
import { isBlockedHost, validateUrl, resolveImageUrl, safeFetchImage } from "../supabase/functions/import-recipe/net.ts";
import { normaliseVideoUrl, videoFromJsonLd, videoFromHtml } from "../supabase/functions/import-recipe/video.ts";
import { normaliseAiRecipe, parseJsonLoose, buildPrompt, RECIPE_SCHEMA } from "../supabase/functions/import-recipe/ai.ts";

const p = parseIngredientLine;
const pick = (x) => ({ q: x.quantity, u: x.unit, n: x.name });

test("ingredient lines: quantities, units and names", () => {
  assert.deepEqual(pick(p("2 tbsp olive oil, divided")), { q: 2, u: "tbsp", n: "olive oil" });
  assert.equal(p("2 tbsp olive oil, divided").note, "divided");
  assert.deepEqual(pick(p("500g plain flour")), { q: 500, u: "g", n: "plain flour" });
  assert.deepEqual(pick(p("1 1/2 cups milk")), { q: 1.5, u: "cup", n: "milk" });
  assert.deepEqual(pick(p("2 large onions, finely chopped")), { q: 2, u: "each", n: "onion" });
  assert.deepEqual(pick(p("3 cloves garlic, crushed")), { q: 3, u: "clove", n: "garlic" });
  assert.deepEqual(pick(p("2-3 tbsp soy sauce")), { q: 3, u: "tbsp", n: "soy sauce" });
  assert.deepEqual(pick(p("½ tsp ground cumin")), { q: 0.5, u: "tsp", n: "ground cumin" });
  assert.deepEqual(pick(p("4 slices bacon")), { q: 4, u: "each", n: "bacon" });
  assert.deepEqual(pick(p("2 eggs")), { q: 2, u: "each", n: "egg" });
  assert.deepEqual(pick(p("1 head broccoli")), { q: 1, u: "each", n: "broccoli" });
  assert.deepEqual(pick(p("250ml chicken stock")), { q: 250, u: "ml", n: "chicken stock" });
  assert.deepEqual(pick(p("2 spring onions")), { q: 2, u: "each", n: "spring onion" });
});

test("ingredient lines: pack sizes and imperial units become metric", () => {
  assert.deepEqual(pick(p("1 x 400g tin chopped tomatoes")), { q: 400, u: "g", n: "tomato" });
  assert.deepEqual(pick(p("1 can (400g) chickpeas, drained")), { q: 400, u: "g", n: "chickpea" });
  assert.deepEqual(pick(p("2 cans (400g each) coconut milk")), { q: 800, u: "g", n: "coconut milk" });
  assert.deepEqual(pick(p("1 lb minced beef")), { q: 455, u: "g", n: "beef" });
  assert.deepEqual(pick(p("8 oz cream cheese")), { q: 225, u: "g", n: "cream cheese" });
  assert.deepEqual(pick(p("4 fl oz milk")), { q: 120, u: "ml", n: "milk" }); // 118 ml, rounded to the nearest 5 above 100
  assert.deepEqual(pick(p("1 fl oz cream")), { q: 30, u: "ml", n: "cream" }); // whole numbers from 10 up
});

test("ingredient lines: no quantity, optional and to-serve items", () => {
  const salt = p("salt and pepper, to taste");
  assert.equal(salt.quantity, null);
  assert.equal(salt.unit, null);
  assert.equal(salt.name, "salt and pepper");
  assert.equal(salt.note, "to taste");
  assert.deepEqual(pick(p("a pinch of salt")), { q: 1, u: "pinch", n: "salt" });
  const parsley = p("Fresh parsley, to serve");
  assert.equal(parsley.optional, true);
  assert.equal(parsley.quantity, null);
  assert.equal(parsley.name, "parsley");
  assert.equal(p("1 tsp chilli flakes (optional)").optional, true);
  assert.equal(p("2 onions").optional, false);
  assert.equal(p("2 onions").raw_text, "2 onions");
});

test("leading quantity parser", () => {
  assert.equal(parseLeadingQuantity("1½ cups").value, 1.5);
  assert.equal(parseLeadingQuantity("1/4 tsp").value, 0.25);
  assert.equal(parseLeadingQuantity("0.5 kg").value, 0.5);
  assert.equal(parseLeadingQuantity("2 to 3 apples").value, 3);
  assert.equal(parseLeadingQuantity("onions"), null);
  assert.equal(parseLeadingQuantity("1/0 cup"), null);
});

test("names and categories", () => {
  assert.equal(normaliseName("Finely chopped Onions"), "onion");
  assert.equal(normaliseName("tomatoes"), "tomato");
  assert.equal(normaliseName("bay leaves"), "bay leaf");
  assert.equal(normaliseName("red chillies"), "red chilli");
  assert.equal(normaliseName("extra virgin olive oil"), "olive oil");
  assert.equal(normaliseName("baby spinach"), "spinach");
  assert.equal(normaliseName("oats"), "oats");
  assert.equal(guessCategory("frozen peas"), "frozen");
  assert.equal(guessCategory("green bean"), "produce");
  assert.equal(guessCategory("tomato paste"), "pantry");
  assert.equal(guessCategory("coconut milk"), "pantry");
  assert.equal(guessCategory("butter"), "dairy_eggs");
  assert.equal(guessCategory("egg noodle"), "pantry");
  assert.equal(guessCategory("chicken stock"), "pantry");
  assert.equal(guessCategory("chicken breast"), "meat_seafood");
  assert.equal(guessCategory("bread roll"), "bakery");
  assert.equal(guessCategory("red capsicum"), "produce");
  assert.equal(guessCategory("lemon juice"), "produce");
  assert.equal(guessCategory("white wine"), "drinks");
  assert.equal(guessCategory("dish soap"), "other");
});

test("durations, yields and timers", () => {
  assert.equal(parseDuration("PT1H30M"), 90);
  assert.equal(parseDuration("P0DT20M"), 20);
  assert.equal(parseDuration("PT45S"), 1);
  assert.equal(parseDuration("soon"), null);
  assert.equal(parseYield("Serves 4-6"), 4);
  assert.equal(parseYield(["6", "6 servings"]), 6);
  assert.equal(parseYield(undefined), 4);
  assert.equal(guessTimer("Simmer for 10-15 minutes until thick."), 900);
  assert.equal(guessTimer("Bake for 1 hour."), 3600);
  assert.equal(guessTimer("Stir well."), null);
});

const PAGE = `<!doctype html><html><head><title>Best Chicken Curry</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"WebPage","name":"Best Chicken Curry"},
 {"@type":["Recipe"],"name":"Best Chicken Curry &amp; Rice","description":"A <b>quick</b> weeknight curry.",
  "recipeYield":["4","4 servings"],"prepTime":"PT15M","cookTime":"PT30M",
  "recipeCategory":"Dinner","recipeCuisine":"Indian","keywords":"curry, chicken, 30 minutes, 12",
  "recipeIngredient":["2 tbsp vegetable oil","600g chicken thigh, diced","1 x 400g tin coconut milk","1 large onion, sliced"],
  "recipeInstructions":[
    {"@type":"HowToSection","name":"Curry","itemListElement":[
      {"@type":"HowToStep","text":"Heat the oil and fry the onion for 5 minutes."},
      {"@type":"HowToStep","text":"Add chicken and coconut milk. Simmer for 20-25 minutes."}]},
    "Serve with rice."]}]}</script>
<script type="application/ld+json">{ not valid json </script>
</head><body><h1>Best Chicken Curry</h1><p>Lots of story &amp; photos.</p></body></html>`;

test("recipe from JSON-LD embedded in a page", () => {
  const node = findRecipeNode(extractJsonLd(PAGE));
  assert.ok(node);
  const r = recipeFromJsonLd(node, "https://example.com/curry");
  assert.ok(r);
  assert.equal(r.title, "Best Chicken Curry & Rice");
  assert.equal(r.description, "A quick weeknight curry.");
  assert.equal(r.servings, 4);
  assert.equal(r.prep_minutes, 15);
  assert.equal(r.cook_minutes, 30);
  assert.deepEqual(r.tags, ["dinner", "indian", "curry", "chicken", "30 minutes"]);
  assert.equal(r.ingredients.length, 4);
  assert.deepEqual(pick(r.ingredients[2]), { q: 400, u: "g", n: "coconut milk" });
  assert.equal(r.steps.length, 3);
  assert.equal(r.steps[0].timer_seconds, 300);
  assert.equal(r.steps[1].timer_seconds, 1500);
  assert.equal(r.source, "url");
  assert.equal(r.source_url, "https://example.com/curry");
});

test("thin JSON-LD falls back to AI (returns null)", () => {
  const thin = { "@type": "Recipe", name: "X", recipeIngredient: ["1 egg"], recipeInstructions: "Cook it." };
  assert.equal(recipeFromJsonLd(thin, null), null);
  assert.equal(findRecipeNode([{ "@type": "Article" }]), null);
});

test("instructions as plain text split into steps", () => {
  const steps = instructionsToSteps("1. Chop the onion.\n2. Fry for 8 minutes.<br>3) Serve.");
  assert.deepEqual(steps.map((s) => s.instruction), ["Chop the onion.", "Fry for 8 minutes.", "Serve."]);
  assert.equal(steps[1].timer_seconds, 480);
});

test("html helpers", () => {
  const text = htmlToText("<nav>Menu</nav><script>var x=1</script><h1>Soup</h1><p>Add 1&nbsp;cup stock &amp; stir.</p><footer>Bye</footer>");
  assert.equal(text, "Soup\nAdd 1 cup stock & stir.");
  assert.equal(decodeEntities("&#176;C &frac12; &amp;"), "°C ½ &");
  assert.equal(htmlToText("<p>" + "word ".repeat(10000) + "</p>", 100).length, 100);
});

test("blocked hosts and urls", () => {
  for (const h of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "[::1]", "2130706433", "0x7f.0.0.1", "metadata", "db.internal", "printer.local"]) {
    assert.equal(isBlockedHost(h), true, h);
  }
  assert.equal(isBlockedHost("www.recipetineats.com"), false);
  assert.throws(() => validateUrl("ftp://example.com/x"));
  assert.throws(() => validateUrl("http://localhost/x"));
  assert.throws(() => validateUrl("https://user:pw@example.com/"));
  assert.throws(() => validateUrl("https://example.com:8080/"));
  assert.throws(() => validateUrl("not a url"));
  assert.equal(validateUrl("https://www.recipetineats.com/chicken/").hostname, "www.recipetineats.com");
});

test("AI output is validated and repaired", () => {
  const raw = {
    is_recipe: true, title: "  Pancakes ", description: null, servings: "6", prep_minutes: 10, cook_minutes: 99999,
    tags: ["Breakfast", "breakfast", "", 7],
    ingredients: [
      { raw_text: "1 1/2 cups flour", quantity: 1.5, unit: "cups", name: "Plain Flour", category: "pantry" },
      { raw_text: "2 eggs", quantity: 2, unit: null, name: "eggs", category: "nonsense" },
      { raw_text: "pinch of salt", quantity: null, unit: "pinch", name: "salt", category: "pantry", optional: false },
      { raw_text: "1 tbsp butter, melted" },
    ],
    steps: [{ instruction: "Mix.", timer_seconds: null }, { instruction: "Cook for 3 minutes each side." }, { instruction: "  " }],
  };
  const r = normaliseAiRecipe(raw, "text", null);
  assert.ok(r);
  assert.equal(r.title, "Pancakes");
  assert.equal(r.servings, 6);
  assert.equal(r.cook_minutes, null);
  assert.deepEqual(r.tags, ["breakfast"]);
  assert.deepEqual(pick(r.ingredients[0]), { q: 1.5, u: "cup", n: "plain flour" });
  assert.deepEqual(pick(r.ingredients[1]), { q: 2, u: "each", n: "egg" });
  assert.equal(r.ingredients[1].category, "dairy_eggs");
  assert.equal(r.ingredients[2].unit, null);
  assert.deepEqual(pick(r.ingredients[3]), { q: 1, u: "tbsp", n: "butter" });
  assert.equal(r.steps.length, 2);
  assert.equal(r.steps[1].timer_seconds, 180);
});

test("AI says not a recipe, or returns junk", () => {
  assert.equal(normaliseAiRecipe({ is_recipe: false, title: "", ingredients: [], steps: [] }, "photo", null), null);
  assert.equal(normaliseAiRecipe({ is_recipe: true, title: "Empty", ingredients: [], steps: [] }, "photo", null), null);
  assert.equal(normaliseAiRecipe("nope", "photo", null), null);
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
});

test("prompt and schema shape", () => {
  const prompt = buildPrompt("url", "Some recipe text", "https://example.com/r");
  assert.ok(prompt.includes("https://example.com/r"));
  assert.ok(prompt.includes("<recipe_input>"));
  assert.ok(buildPrompt("photo").includes("attached image"));
  assert.deepEqual(RECIPE_SCHEMA.required, ["is_recipe", "title", "ingredients", "steps"]);
});

test("recipe photo: found in recipe data or the share image tag", () => {
  assert.equal(imageFromJsonLd({ image: "https://x.com/a.jpg" }), "https://x.com/a.jpg");
  assert.equal(imageFromJsonLd({ image: { "@type": "ImageObject", url: "https://x.com/b.jpg" } }), "https://x.com/b.jpg");
  assert.equal(imageFromJsonLd({ image: [{ url: "https://x.com/c.jpg" }, "https://x.com/d.jpg"] }), "https://x.com/c.jpg");
  assert.equal(imageFromJsonLd({}), null);
  assert.equal(extractMetaImage('<head><meta property="og:image" content="https://x.com/o.jpg?a=1&amp;b=2"></head>'), "https://x.com/o.jpg?a=1&b=2");
  assert.equal(extractMetaImage('<meta content="/rel.jpg" name="twitter:image">'), "/rel.jpg");
  assert.equal(extractMetaImage('<meta property="og:title" content="x">'), null);
  assert.equal(resolveImageUrl("/img/a.jpg", "https://site.com/recipes/1"), "https://site.com/img/a.jpg");
  assert.equal(resolveImageUrl("http://localhost/a.jpg", "https://site.com/"), null);
  assert.equal(resolveImageUrl("http://169.254.169.254/a.jpg", "https://site.com/"), null);
  assert.equal(resolveImageUrl(null, "https://site.com/"), null);
});

test("recipe photo download: accepts real pictures, refuses everything else", async () => {
  const real = globalThis.fetch;
  const png = new Uint8Array(2000).fill(7);
  const make = (body, type, extra = {}) => new Response(body, { status: 200, headers: { "content-type": type, ...extra } });
  try {
    globalThis.fetch = async () => make(png, "image/png");
    const ok = await safeFetchImage("https://site.com/a.png");
    assert.equal(ok.mime, "image/png");
    assert.equal(Buffer.from(ok.base64, "base64").length, 2000);
    globalThis.fetch = async () => make("<html>", "text/html");
    assert.equal(await safeFetchImage("https://site.com/a.png"), null);
    globalThis.fetch = async () => make(png, "image/svg+xml");
    assert.equal(await safeFetchImage("https://site.com/a.svg"), null);
    globalThis.fetch = async () => make(png, "image/jpeg");
    assert.equal(await safeFetchImage("https://site.com/big.jpg", { maxBytes: 1000 }), null);
    globalThis.fetch = async () => new Response("no", { status: 403 });
    assert.equal(await safeFetchImage("https://site.com/a.jpg"), null);
    let called = false;
    globalThis.fetch = async () => { called = true; return make(png, "image/png"); };
    assert.equal(await safeFetchImage("http://127.0.0.1/a.png"), null);
    assert.equal(called, false);
    // a redirect to a private address is refused
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "http://10.0.0.5/x.png" } });
    assert.equal(await safeFetchImage("https://site.com/r.png"), null);
  } finally {
    globalThis.fetch = real;
  }
});

test("recipe video: YouTube and Vimeo links are found and tidied", () => {
  const id = "dQw4w9WgXcQ";
  const want = `https://www.youtube.com/watch?v=${id}`;
  assert.equal(normaliseVideoUrl(`https://youtu.be/${id}?t=5`), want);
  assert.equal(normaliseVideoUrl(`https://www.youtube.com/embed/${id}?rel=0`), want);
  assert.equal(normaliseVideoUrl(`//www.youtube-nocookie.com/embed/${id}`), want);
  assert.equal(normaliseVideoUrl(`https://m.youtube.com/watch?v=${id}&list=x`), want);
  assert.equal(normaliseVideoUrl(`https://www.youtube.com/shorts/${id}`), want);
  assert.equal(normaliseVideoUrl("https://player.vimeo.com/video/123456"), "https://vimeo.com/123456");
  assert.equal(normaliseVideoUrl("https://www.youtube.com/@somechannel"), null);
  assert.equal(normaliseVideoUrl("https://www.youtube.com/embed/videoseries?list=PL1"), null);
  assert.equal(normaliseVideoUrl("https://example.com/v.mp4"), null);
  assert.equal(normaliseVideoUrl("javascript:alert(1)"), null);
  assert.equal(videoFromJsonLd({ video: { "@type": "VideoObject", embedUrl: `https://www.youtube.com/embed/${id}` } }), want);
  assert.equal(videoFromJsonLd({ video: [{ contentUrl: "https://cdn.x.com/a.mp4" }, { url: `https://youtu.be/${id}` }] }), want);
  assert.equal(videoFromJsonLd({}), null);
  assert.equal(videoFromHtml(`<p><iframe width="560" src="https://www.youtube.com/embed/${id}?feature=oembed" allowfullscreen></iframe>`), want);
  assert.equal(videoFromHtml(`<iframe data-src="https://www.youtube.com/embed/${id}"></iframe>`), want);
  assert.equal(videoFromHtml(`<meta property="og:video" content="https://www.youtube.com/embed/${id}">`), want);
  assert.equal(videoFromHtml(`<a href="https://www.youtube.com/watch?v=${id}">Subscribe on YouTube</a>`), null);
});

test("pack words stay out of the name when the pack size is the amount", () => {
  const a = p("400g can chopped tomatoes");
  assert.equal(a.quantity, 400); assert.equal(a.unit, "g"); assert.equal(a.name, "tomato");
  const b = p("1 (400g) tin chickpeas, drained");
  assert.equal(b.name, "chickpea");
  const c = p("250 ml jar of passata");
  assert.equal(c.unit, "ml"); assert.equal(c.name, "passata");
});
