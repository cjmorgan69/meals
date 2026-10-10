-- =====================================================================
-- Recipe & Meal Planner: Postgres schema (Supabase flavour)
--
-- Design goals
--   1. Isolation is enforced by the database (row-level security), not
--      by client-side filtering on user id.
--   2. Ingredients are structured (quantity + unit + canonical ingredient)
--      so shopping lists can merge "2 onions + 1 onion" and convert units.
--   3. AI usage is metered and capped server-side, per user, per month.
--   4. Deleting an auth user cascades through everything they own
--      (account deletion / privacy compliance).
--
-- Assumes Supabase's `auth` and `storage` schemas and the roles
-- `authenticated` and `service_role`. Run top to bottom on a fresh project.
-- Anything that must bypass RLS (billing webhooks, AI edge functions,
-- catalogue maintenance) uses the service role key, server-side only.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;   -- fuzzy title search

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type plan_tier           as enum ('free', 'plus', 'premium');
create type ai_kind             as enum ('photo', 'url_ai', 'text', 'video');
create type recipe_source       as enum ('photo', 'url', 'text', 'video', 'manual');
create type unit_kind           as enum ('mass', 'volume', 'count');
create type meal_type           as enum ('breakfast', 'lunch', 'dinner', 'snack');
create type plan_status         as enum ('planned', 'cooked', 'skipped');
create type ingredient_category as enum (
  'produce', 'meat_seafood', 'dairy_eggs', 'bakery',
  'pantry', 'frozen', 'drinks', 'household', 'other'
);

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- Generic updated_at trigger function
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  tier         plan_tier not null default 'free',   -- set by billing webhook only
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

-- Units: global, read-only. to_base converts to the base unit of its kind
-- (g for mass, ml for volume). Metric/Australian conventions:
-- 1 tbsp = 20 ml, 1 cup = 250 ml. Change the seeds if you target the US.
create table public.units (
  code    text primary key,
  kind    unit_kind not null,
  to_base numeric not null check (to_base > 0),
  is_base boolean not null default false
);
create unique index units_one_base_per_kind on public.units (kind)
  where is_base and kind <> 'count';

-- Canonical ingredient catalogue. owner_id NULL = shared catalogue
-- (maintained with the service role); non-null = a user's custom entry.
create table public.ingredients (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users(id) on delete cascade,
  name       text not null,
  category   ingredient_category not null default 'other',
  created_at timestamptz not null default now()
);
create unique index ingredients_name_uq on public.ingredients
  (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- Ingredients a user always has (skipped when generating shopping lists)
create table public.pantry_staples (
  user_id       uuid not null references auth.users(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  primary key (user_id, ingredient_id)
);

create table public.recipes (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,  -- null = private
  title        text not null,
  description  text,
  source       recipe_source not null default 'manual',
  source_url   text,
  image_path   text,                       -- path inside the recipe-photos bucket
  video_url    text,                       -- link to a YouTube/Vimeo video, if any
  servings     int not null default 4 check (servings > 0),
  prep_minutes int check (prep_minutes >= 0),
  cook_minutes int check (cook_minutes >= 0),
  tags         text[] not null default '{}',   -- dietary + free-form tags
  is_favourite boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index recipes_owner_idx     on public.recipes (owner_id);
create index recipes_household_idx on public.recipes (household_id) where household_id is not null;
create index recipes_tags_idx      on public.recipes using gin (tags);
create index recipes_title_trgm    on public.recipes using gin (title extensions.gin_trgm_ops);

create table public.recipe_steps (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references public.recipes(id) on delete cascade,
  position      int not null,
  instruction   text not null,
  timer_seconds int check (timer_seconds >= 0)
);
create index recipe_steps_recipe_idx on public.recipe_steps (recipe_id, position);

-- raw_text is always kept (what the recipe actually said). The structured
-- columns are filled at ingestion. For "2 onions" store quantity=2,
-- unit='each'; for "salt to taste" leave quantity and unit null.
create table public.recipe_ingredients (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references public.recipes(id) on delete cascade,
  position      int not null default 0,
  group_label   text,                         -- e.g. 'Sauce', 'To serve'
  raw_text      text not null,
  ingredient_id uuid references public.ingredients(id) on delete set null,
  quantity      numeric check (quantity >= 0),
  unit          text references public.units(code),
  note          text,                         -- e.g. 'finely chopped'
  optional      boolean not null default false
);
create index recipe_ingredients_recipe_idx     on public.recipe_ingredients (recipe_id, position);
create index recipe_ingredients_ingredient_idx on public.recipe_ingredients (ingredient_id);

create table public.meal_plan_entries (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  recipe_id    uuid not null references public.recipes(id) on delete cascade,
  planned_date date not null,
  meal         meal_type not null default 'dinner',
  servings     int check (servings > 0),      -- null = use the recipe's servings
  status       plan_status not null default 'planned',
  notes        text,
  created_at   timestamptz not null default now()
);
create index meal_plan_owner_date_idx     on public.meal_plan_entries (owner_id, planned_date);
create index meal_plan_household_date_idx on public.meal_plan_entries (household_id, planned_date)
  where household_id is not null;

-- "Cooked" history drives frequency-based suggestions. Also supports
-- cooking something that was never planned.
create table public.cook_events (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipe_id     uuid not null references public.recipes(id) on delete cascade,
  plan_entry_id uuid references public.meal_plan_entries(id) on delete set null,
  cooked_on     date not null default current_date,
  rating        smallint check (rating between 1 and 5),
  notes         text,
  created_at    timestamptz not null default now()
);
create index cook_events_owner_idx on public.cook_events (owner_id, cooked_on desc);
create index cook_events_recipe_idx on public.cook_events (recipe_id);

create table public.shopping_lists (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  name         text not null default 'Shopping list',
  date_from    date,
  date_to      date,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index shopping_lists_owner_idx on public.shopping_lists (owner_id);

-- Quantities here are in base units (g / ml) or a count unit. Format for
-- display in the client (e.g. 1500 g -> 1.5 kg).
create table public.shopping_list_items (
  id                uuid primary key default gen_random_uuid(),
  list_id           uuid not null references public.shopping_lists(id) on delete cascade,
  ingredient_id     uuid references public.ingredients(id) on delete set null,
  name              text not null,
  category          ingredient_category not null default 'other',
  quantity          numeric,
  unit              text references public.units(code),
  checked           boolean not null default false,
  is_manual         boolean not null default false,    -- kept when the list is regenerated
  source_recipe_ids uuid[] not null default '{}',      -- which recipes need this item
  note              text,
  created_at        timestamptz not null default now()
);
create index shopping_list_items_list_idx on public.shopping_list_items (list_id, category);

-- AI quotas ------------------------------------------------------------
create table public.tier_limits (
  tier          plan_tier not null,
  kind          ai_kind not null,
  monthly_limit int not null check (monthly_limit >= 0),
  primary key (tier, kind)
);

create table public.ai_usage (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  kind            ai_kind not null,
  input_tokens    int,
  output_tokens   int,
  cost_usd_micros bigint,                 -- 1,000,000 = US$1; filled after the call
  created_at      timestamptz not null default now()
);
create index ai_usage_user_month_idx on public.ai_usage (user_id, kind, created_at);

-- ---------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so RLS checks don't recurse)
-- ---------------------------------------------------------------------
create function public.is_household_member(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

create function public.can_access(p_owner uuid, p_household uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_owner = auth.uid()
      or (p_household is not null and public.is_household_member(p_household));
$$;

create function public.can_read_recipe(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.recipes r
    where r.id = rid and public.can_access(r.owner_id, r.household_id)
  );
$$;

create function public.owns_recipe(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.recipes r where r.id = rid and r.owner_id = auth.uid());
$$;

create function public.can_access_list(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shopping_lists l
    where l.id = lid and public.can_access(l.owner_id, l.household_id)
  );
$$;

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.households          enable row level security;
alter table public.household_members   enable row level security;
alter table public.units               enable row level security;
alter table public.ingredients         enable row level security;
alter table public.pantry_staples      enable row level security;
alter table public.recipes             enable row level security;
alter table public.recipe_steps        enable row level security;
alter table public.recipe_ingredients  enable row level security;
alter table public.meal_plan_entries   enable row level security;
alter table public.cook_events         enable row level security;
alter table public.shopping_lists      enable row level security;
alter table public.shopping_list_items enable row level security;
alter table public.tier_limits         enable row level security;
alter table public.ai_usage            enable row level security;

-- profiles: read own; may edit display_name only (tier is locked by column grants)
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant  update (display_name) on public.profiles to authenticated;

-- households
create policy households_select on public.households for select to authenticated
  using (public.is_household_member(id) or created_by = auth.uid());
create policy households_insert on public.households for insert to authenticated
  with check (created_by = auth.uid());
create policy households_update on public.households for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy households_delete on public.households for delete to authenticated
  using (created_by = auth.uid());

-- household_members: see co-members; creator adds themselves first;
-- inviting others should go through a server-side invite flow.
create policy hm_select on public.household_members for select to authenticated
  using (public.is_household_member(household_id));
create policy hm_insert_creator on public.household_members for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.households h
                where h.id = household_id and h.created_by = auth.uid())
  );
create policy hm_delete_self on public.household_members for delete to authenticated
  using (user_id = auth.uid());

-- reference data
create policy units_select on public.units for select to authenticated using (true);
create policy tier_limits_select on public.tier_limits for select to authenticated using (true);

-- ingredients: shared catalogue readable by all; custom entries private
create policy ingredients_select on public.ingredients for select to authenticated
  using (owner_id is null or owner_id = auth.uid());
create policy ingredients_insert on public.ingredients for insert to authenticated
  with check (owner_id = auth.uid());
create policy ingredients_update on public.ingredients for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy ingredients_delete on public.ingredients for delete to authenticated
  using (owner_id = auth.uid());

create policy pantry_all on public.pantry_staples for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- recipes: owner or household members read; only the owner writes
create policy recipes_select on public.recipes for select to authenticated
  using (public.can_access(owner_id, household_id));
create policy recipes_insert on public.recipes for insert to authenticated
  with check (owner_id = auth.uid()
              and (household_id is null or public.is_household_member(household_id)));
create policy recipes_update on public.recipes for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
              and (household_id is null or public.is_household_member(household_id)));
create policy recipes_delete on public.recipes for delete to authenticated
  using (owner_id = auth.uid());

create policy steps_select on public.recipe_steps for select to authenticated
  using (public.can_read_recipe(recipe_id));
create policy steps_write on public.recipe_steps for all to authenticated
  using (public.owns_recipe(recipe_id)) with check (public.owns_recipe(recipe_id));

create policy ri_select on public.recipe_ingredients for select to authenticated
  using (public.can_read_recipe(recipe_id));
create policy ri_write on public.recipe_ingredients for all to authenticated
  using (public.owns_recipe(recipe_id)) with check (public.owns_recipe(recipe_id));

-- meal plan + shopping lists: household members can edit shared rows
create policy plan_select on public.meal_plan_entries for select to authenticated
  using (public.can_access(owner_id, household_id));
create policy plan_insert on public.meal_plan_entries for insert to authenticated
  with check (owner_id = auth.uid()
              and public.can_read_recipe(recipe_id)
              and (household_id is null or public.is_household_member(household_id)));
create policy plan_update on public.meal_plan_entries for update to authenticated
  using (public.can_access(owner_id, household_id))
  with check (public.can_access(owner_id, household_id));
create policy plan_delete on public.meal_plan_entries for delete to authenticated
  using (public.can_access(owner_id, household_id));

create policy cook_all on public.cook_events for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.can_read_recipe(recipe_id));

create policy lists_select on public.shopping_lists for select to authenticated
  using (public.can_access(owner_id, household_id));
create policy lists_insert on public.shopping_lists for insert to authenticated
  with check (owner_id = auth.uid()
              and (household_id is null or public.is_household_member(household_id)));
create policy lists_update on public.shopping_lists for update to authenticated
  using (public.can_access(owner_id, household_id))
  with check (public.can_access(owner_id, household_id));
create policy lists_delete on public.shopping_lists for delete to authenticated
  using (owner_id = auth.uid());

create policy items_all on public.shopping_list_items for all to authenticated
  using (public.can_access_list(list_id)) with check (public.can_access_list(list_id));

-- ai_usage: users may read their own rows; only the service role writes
create policy ai_usage_select on public.ai_usage for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create trigger recipes_updated_at before update on public.recipes
  for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger lists_updated_at before update on public.shopping_lists
  for each row execute function public.set_updated_at();

-- New auth user -> profile row
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Marking a planned meal as cooked logs a cook event
create function public.log_cook_event() returns trigger
language plpgsql as $$
begin
  if new.status = 'cooked' and old.status is distinct from 'cooked' then
    insert into public.cook_events (owner_id, recipe_id, plan_entry_id, cooked_on)
    values (coalesce(auth.uid(), new.owner_id), new.recipe_id, new.id, new.planned_date);
  end if;
  return new;
end $$;

create trigger plan_entry_cooked after update of status on public.meal_plan_entries
  for each row execute function public.log_cook_event();

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
-- Frequency data for "what do I cook often / not cooked in a while".
-- security_invoker => RLS on cook_events applies to the caller.
create view public.recipe_cook_stats with (security_invoker = true) as
  select owner_id, recipe_id, count(*) as times_cooked, max(cooked_on) as last_cooked_on
  from public.cook_events
  group by owner_id, recipe_id;

-- ---------------------------------------------------------------------
-- Shopping list generation
--   * scales each recipe by (planned servings / recipe servings)
--   * converts mass and volume to base units (g / ml) and sums per ingredient
--   * count units (each, clove, ...) are summed per unit, never mixed
--   * skips optional ingredients and the owner's pantry staples
--   * unmatched ingredients (no ingredient_id) group by their raw text
--   * manual items are kept; generated items are replaced
-- Runs as the caller, so RLS applies. Returns the number of items generated.
-- ---------------------------------------------------------------------
create function public.generate_shopping_list(p_list_id uuid, p_from date, p_to date)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner     uuid;
  v_household uuid;
  v_count     int;
begin
  select owner_id, household_id into v_owner, v_household
  from public.shopping_lists where id = p_list_id;

  if not found then
    raise exception 'Shopping list % not found or not accessible', p_list_id;
  end if;

  delete from public.shopping_list_items
  where list_id = p_list_id and not is_manual;

  insert into public.shopping_list_items
    (list_id, ingredient_id, name, category, quantity, unit, source_recipe_ids)
  select p_list_id,
         x.ingredient_id,
         x.name,
         x.category,
         round(sum(x.base_qty), 2),
         x.out_unit,
         array_agg(distinct x.recipe_id)
  from (
    select ri.ingredient_id,
           coalesce(i.name, lower(trim(ri.raw_text)))             as name,
           coalesce(i.category, 'other'::ingredient_category)     as category,
           case when u.kind = 'count' then u.code
                else (select b.code from public.units b
                      where b.kind = u.kind and b.is_base)
           end                                                    as out_unit,
           ri.quantity * u.to_base
             * (coalesce(e.servings, r.servings)::numeric / r.servings) as base_qty,
           r.id                                                   as recipe_id
    from public.meal_plan_entries e
    join public.recipes r             on r.id = e.recipe_id
    join public.recipe_ingredients ri on ri.recipe_id = r.id
    left join public.ingredients i    on i.id = ri.ingredient_id
    left join public.units u
           on u.code = coalesce(ri.unit, case when ri.quantity is not null then 'each' end)
    where e.planned_date between p_from and p_to
      and e.status = 'planned'
      and (e.owner_id = v_owner
           or (v_household is not null and e.household_id = v_household))
      and not ri.optional
      and not exists (
        select 1 from public.pantry_staples ps
        where ps.user_id = v_owner and ps.ingredient_id = ri.ingredient_id
      )
  ) x
  group by x.ingredient_id, x.name, x.category, x.out_unit;

  get diagnostics v_count = row_count;

  update public.shopping_lists
  set date_from = p_from, date_to = p_to
  where id = p_list_id;

  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- AI quota gate. Call from the server-side AI function BEFORE calling
-- the model. Returns the usage row id if allowed, NULL if over quota.
-- Afterwards update that row with token counts and cost, or delete it
-- if the model call failed. Service role only.
-- ---------------------------------------------------------------------
create function public.try_consume_ai_quota(p_user uuid, p_kind ai_kind)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_tier  plan_tier;
  v_limit int;
  v_used  int;
  v_id    bigint;
  v_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
begin
  -- serialise concurrent requests for the same user
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  select tier into v_tier from public.profiles where id = p_user;
  if v_tier is null then return null; end if;

  select monthly_limit into v_limit
  from public.tier_limits where tier = v_tier and kind = p_kind;
  if v_limit is null then return null; end if;

  select count(*) into v_used
  from public.ai_usage
  where user_id = p_user and kind = p_kind and created_at >= v_start;

  if v_used >= v_limit then return null; end if;

  insert into public.ai_usage (user_id, kind) values (p_user, p_kind)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.try_consume_ai_quota(uuid, ai_kind)
  from public, anon, authenticated;
grant  execute on function public.try_consume_ai_quota(uuid, ai_kind) to service_role;

-- ---------------------------------------------------------------------
-- Seed data (placeholders: tune limits against your cost model)
-- ---------------------------------------------------------------------
insert into public.units (code, kind, to_base, is_base) values
  ('g',     'mass',   1,    true),
  ('kg',    'mass',   1000, false),
  ('ml',    'volume', 1,    true),
  ('l',     'volume', 1000, false),
  ('tsp',   'volume', 5,    false),
  ('tbsp',  'volume', 20,   false),
  ('cup',   'volume', 250,  false),
  ('each',  'count',  1,    false),
  ('clove', 'count',  1,    false),
  ('bunch', 'count',  1,    false),
  ('can',   'count',  1,    false),
  ('pinch', 'count',  1,    false);

insert into public.tier_limits (tier, kind, monthly_limit) values
  ('free',    'photo',  10),  ('free',    'url_ai',  20), ('free',    'text',  20), ('free',    'video',  0),
  ('plus',    'photo', 100),  ('plus',    'url_ai', 200), ('plus',    'text', 200), ('plus',    'video',  0),
  ('premium', 'photo', 300),  ('premium', 'url_ai', 500), ('premium', 'text', 500), ('premium', 'video', 30);

-- ---------------------------------------------------------------------
-- Storage: private bucket, one folder per user (<user_id>/<file>)
-- Household members can't read each other's photos with these policies;
-- serve shared photos via signed URLs from a server function.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('recipe-photos', 'recipe-photos', false)
on conflict (id) do nothing;

create policy "recipe photos read own" on storage.objects for select to authenticated
  using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "recipe photos insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "recipe photos update own" on storage.objects for update to authenticated
  using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "recipe photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- Hardening for Supabase's public API: the policy helpers and the list generator
-- are for signed-in users only, and trigger functions can't be called directly.
-- ---------------------------------------------------------------------
revoke execute on function
  public.is_household_member(uuid),
  public.can_access(uuid, uuid),
  public.can_read_recipe(uuid),
  public.owns_recipe(uuid),
  public.can_access_list(uuid),
  public.generate_shopping_list(uuid, date, date)
  from public, anon;
grant execute on function
  public.is_household_member(uuid),
  public.can_access(uuid, uuid),
  public.can_read_recipe(uuid),
  public.owns_recipe(uuid),
  public.can_access_list(uuid),
  public.generate_shopping_list(uuid, date, date)
  to authenticated, service_role;

revoke execute on function
  public.handle_new_user(),
  public.set_updated_at(),
  public.log_cook_event()
  from public, anon, authenticated;
