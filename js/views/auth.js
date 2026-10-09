import { sb } from "../supabase.js";
import { h, mount, busy } from "../ui.js";

export function render(root) {
  let mode = "in";
  const draw = (msg = "") => {
    const email = h("input", { type: "email", id: "em", autocomplete: "email", required: true });
    const pass = h("input", { type: "password", id: "pw", autocomplete: mode === "in" ? "current-password" : "new-password", minlength: 8, required: true });
    const err = h("p.error", { role: "alert" }, msg);
    const btn = h("button.btn.primary", { type: "submit" }, mode === "in" ? "Sign in" : "Create account");
    const form = h("form", {
      onsubmit: (e) => {
        e.preventDefault();
        busy(btn, async () => {
          if (mode === "in") {
            const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
            if (error) throw error;
          } else {
            const { data, error } = await sb.auth.signUp({ email: email.value.trim(), password: pass.value, options: { emailRedirectTo: location.origin + location.pathname } });
            if (error) throw error;
            if (!data.session) draw("Account created. Check your email for a confirmation link, then sign in.");
          }
        }, { onError: (x) => { err.textContent = x.message; } });
      },
    },
      h("div.field", {}, h("label", { for: "em" }, "Email"), email),
      h("div.field", {}, h("label", { for: "pw" }, "Password"), pass, mode === "up" ? h("span.hint", {}, "At least 8 characters.") : null),
      err, h("div.row", {}, btn));
    mount(root, h("div.auth", {},
      h("h1", {}, "Recipe Planner"),
      h("p.hint", {}, "Keep your recipes, plan the week's dinners and get a shopping list."),
      h("div.card", {}, h("h2", {}, mode === "in" ? "Sign in" : "Create your account"), form,
        h("p", {}, mode === "in" ? "New here? " : "Already have an account? ",
          h("a", { href: "#", onclick: (e) => { e.preventDefault(); mode = mode === "in" ? "up" : "in"; draw(); } }, mode === "in" ? "Create an account" : "Sign in")))));
  };
  draw();
}
