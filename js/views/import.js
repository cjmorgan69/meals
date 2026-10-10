import { h, mount, busy, toast } from "../ui.js";
import { importRecipe } from "../api.js";
import { state } from "../state.js";
import { downscaleImage } from "../image.js";

export function render(root) {
  let tab = "url";
  const body = h("div");
  const tabs = h("div.tabs", { role: "tablist" });
  const TABS = [["url", "Web link"], ["photo", "Photo"], ["text", "Pasted text"]];

  // A web link import may bring the page's own photo back as base64; shrink it like any other photo.
  async function pagePhoto(img) {
    if (!img?.base64) return null;
    try {
      const bytes = Uint8Array.from(atob(img.base64), (c) => c.charCodeAt(0));
      return (await downscaleImage(new Blob([bytes], { type: img.mime }))).blob;
    } catch { return null; }
  }
  async function finish(res, photo) {
    state.draft = res.recipe;
    state.draftPhoto = photo || (await pagePhoto(res.image));
    state.draftPhotoFromWeb = !photo && !!state.draftPhoto;
    location.hash = "#/edit/new";
  }
  function fail(e, box) {
    box.textContent = e.code === "quota" ? "You've used this month's imports for your plan. Type the recipe in instead, or try again next month." : e.message;
  }
  const panels = {
    url() {
      const url = h("input", { type: "url", id: "u", placeholder: "https://…", required: true });
      const err = h("p.error", { role: "alert" }), go = h("button.btn.primary", { type: "submit" }, "Import");
      return h("form", { onsubmit: (e) => { e.preventDefault(); err.textContent = ""; busy(go, async () => await finish(await importRecipe({ mode: "url", url: url.value.trim() })), { onError: (x) => fail(x, err) }); } },
        h("div.field", {}, h("label", { for: "u" }, "Recipe web address"), url, h("span.hint", {}, "Most recipe sites import instantly and don't use your AI allowance. The page's photo comes with it when the site allows.")), err, go);
    },
    photo() {
      const file = h("input", { type: "file", accept: "image/*", id: "ph", required: true });
      const err = h("p.error", { role: "alert" }), go = h("button.btn.primary", { type: "submit" }, "Read the photo");
      return h("form", { onsubmit: (e) => { e.preventDefault(); err.textContent = ""; busy(go, async () => {
        const img = await downscaleImage(file.files[0]);
        finish(await importRecipe({ mode: "photo", image_base64: img.base64, mime: img.mime }), img.blob);
      }, { onError: (x) => fail(x, err) }); } },
        h("div.field", {}, h("label", { for: "ph" }, "Photo of a recipe"), file, h("span.hint", {}, "A cookbook page, a screenshot or a handwritten card. Uses one photo import.")), err, go);
    },
    text() {
      const text = h("textarea", { id: "tx", required: true, style: "min-height:180px", placeholder: "Paste the ingredients and method here" });
      const err = h("p.error", { role: "alert" }), go = h("button.btn.primary", { type: "submit" }, "Read the text");
      return h("form", { onsubmit: (e) => { e.preventDefault(); err.textContent = ""; busy(go, async () => finish(await importRecipe({ mode: "text", text: text.value })), { onError: (x) => fail(x, err) }); } },
        h("div.field", {}, h("label", { for: "tx" }, "Recipe text"), text, h("span.hint", {}, "Uses one text import.")), err, go);
    },
  };
  function draw() {
    mount(tabs, TABS.map(([k, label]) => h("button", { role: "tab", "aria-selected": String(k === tab), onclick: () => { tab = k; draw(); } }, label)));
    mount(body, panels[tab]());
  }
  mount(root, h("p", {}, h("a", { href: "#/recipes" }, "‹ Recipes")), h("h1", {}, "Import a recipe"), h("div.card", {}, tabs, body),
    h("p.hint", { style: "margin-top:1rem" }, "You'll get a chance to check and fix everything before it's saved."));
  draw();
}
