// delete-account: permanently deletes the signed-in user's photos and account.
// Database rows are removed automatically (every table cascades from the auth user).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return reply(500, { error: "The server isn't configured." });
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return reply(401, { error: "Sign in again to continue." });
    const uid = data.user.id;

    // Photos live in <uid>/ inside the recipe-photos bucket and do not cascade.
    for (let page = 0; page < 50; page++) {
      const { data: files, error: listErr } = await admin.storage.from("recipe-photos").list(uid, { limit: 100 });
      if (listErr) throw listErr;
      if (!files || files.length === 0) break;
      const { error: rmErr } = await admin.storage.from("recipe-photos").remove(files.map((f) => `${uid}/${f.name}`));
      if (rmErr) throw rmErr;
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) throw delErr;
    return reply(200, { ok: true });
  } catch (e) {
    console.error("delete-account failed:", e instanceof Error ? e.message : e);
    return reply(500, { error: "Couldn't delete the account. Try again, or contact the app owner." });
  }
});
