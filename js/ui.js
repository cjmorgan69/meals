// Tiny DOM helpers. h("div.card", {onclick}, child, ...) returns an element.
export function h(tag, props, ...kids) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className += (el.className ? " " : "") + v;
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "disabled" || k === "selected") el[k] = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const mount = (root, ...kids) => { root.replaceChildren(); add(root, kids); };
export const spinner = () => h("span.spinner", { role: "status", "aria-label": "Loading" });
export const loading = (msg = "Loading…") => h("p.empty", {}, spinner(), " ", msg);

export function toast(msg, isErr = false) {
  const t = h("div.toast" + (isErr ? ".err" : ""), {}, msg);
  document.getElementById("toasts").append(t);
  setTimeout(() => t.remove(), isErr ? 6000 : 2800);
}

/** Disables a button while fn runs; errors show as a toast (or onError). */
export async function busy(btn, fn, { onError } = {}) {
  const prev = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.replaceChildren(spinner(), " ", btn.textContent); }
  try { return await fn(); }
  catch (e) { console.error(e); (onError || ((x) => toast(x.message || String(x), true)))(e); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = prev; } }
}

export function modal(build) {
  const overlay = h("div.overlay");
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const box = h("div.modal", { role: "dialog", "aria-modal": "true" });
  overlay.append(box);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  build(box, close);
  document.body.append(overlay);
  const first = box.querySelector("input,textarea,select,button");
  if (first) first.focus();
  return close;
}

export const confirmBox = (title, text, okLabel = "Delete") => new Promise((resolve) => {
  modal((box, close) => {
    mount(box,
      h("h2", {}, title), h("p", {}, text),
      h("div.row.end", {},
        h("button.btn", { onclick: () => { close(); resolve(false); } }, "Cancel"),
        h("button.btn.primary", { onclick: () => { close(); resolve(true); } }, okLabel)));
  });
});

export const escapeText = (s) => String(s ?? "");
