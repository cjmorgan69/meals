# Recipe Planner (test build)

A static web app (no build step) backed by Supabase. Save recipes, import them from a link / photo / text,
plan the week, get a shopping list.

## Set up once
1. **Database**: Supabase dashboard → SQL Editor → paste `supabase/schema.sql` → Run.
2. **Functions**: deploy `supabase/functions/import-recipe` and `delete-account` (verify JWT on).
3. **Gemini key**: Project Settings → Edge Functions → Secrets → add `GEMINI_API_KEY`
   (optional: `GEMINI_MODEL`, default `gemini-3.5-flash-lite`).
4. **Auth**: Authentication → Providers → Email → turn off "Confirm email" for the test.
   Authentication → URL Configuration → set Site URL to your hosted address.
5. **Hosting**: push to GitHub, Settings → Pages → Deploy from branch `main` / root.

`js/config.js` already holds the project URL and publishable key (safe to publish; row-level security protects data).

## Tests
`npm test` (Node 22+). 
