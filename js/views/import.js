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
      const shots = []; // { img, url }
      const add = h("input", { type: "file", accept: "image/*", id: "ph", style: "display:none", onchange: async (e) => {
        const f = e.target.files[0]; e.target.value = ""; if (!f) return;
        try { const img = await downscaleImage(f); shots.push({ img, url: URL.createObjectURL(img.blob) }); drawShots(); } catch (x) { err.textContent = x.message; }
      } });
      const strip = h("div.photo-strip"), err = h("p.error", { role: "alert" });
      const addBtn = h("button.btn", { type: "button", onclick: () => add.click() }, "Take or choose a photo");
      const go = h("button.btn.primary", { type: "submit" }, "Read the photo");
      function drawShots() {
        mount(strip, shots.map((s, n) => h("div.shot", {}, h("img", { src: s.url, alt: `Page ${n + 1}` }),
          h("button", { type: "button", "aria-label": `Remove page ${n + 1}`, onclick: () => { shots.splice(n, 1); drawShots(); } }, "✕"))));
        addBtn.textContent = shots.length ? "Add another page" : "Take or choose a photo";
        addBtn.disabled = shots.length >= 4;
        go.textContent = shots.length > 1 ? `Read ${shots.length} pages` : "Read the photo";
      }
      drawShots();
      return h("form", { onsubmit: (e) => { e.preventDefault(); err.textContent = "";
        if (!shots.length) { err.textContent = "Add a photo first."; return; }
        busy(go, async () => {
          const images = shots.map((s) => ({ mime: s.img.mime, base64: s.img.base64 }));
          // One page also goes in the older single-photo fields, so it works before the server update is live.
          finish(await importRecipe({ mode: "photo", images, image_base64: images[0].base64, mime: images[0].mime }), shots[0].img.blob);
        }, { onError: (x) => fail(x, err) }); } },
        h("div.field", {}, h("label", { for: "ph" }, "Photos of a recipe"), add, strip, h("div.row", {}, addBtn),
          h("span.hint", {}, "A cookbook page, a screenshot or a handwritten card. If the recipe runs over more than one page, add each page (up to 4). It still uses just one photo import.")), err, go);
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
