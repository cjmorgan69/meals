-- Family sharing. Run once in Supabase > SQL Editor.
-- One household per person. Members share recipes, the meal plan, shopping
-- lists and recipe photos. Everyone keeps their own login and AI allowance.

alter table public.households add column if not exists join_code text unique;
create unique index if not exists household_members_one_per_user on public.household_members (user_id);

-- helpers -------------------------------------------------------------
create or replace function public.my_household_id() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.household_members where user_id = auth.uid() limit 1;
$$;

create or replace function public.shares_household_with(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members a
    join public.household_members b on a.household_id = b.household_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- new rows join the creator's household automatically
create or replace function public.set_household_default() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.household_id is null then new.household_id := public.my_household_id(); end if;
  return new;
end $$;

drop trigger if exists recipes_household_default on public.recipes;
create trigger recipes_household_default before insert on public.recipes
  for each row execute function public.set_household_default();
drop trigger if exists plan_household_default on public.meal_plan_entries;
create trigger plan_household_default before insert on public.meal_plan_entries
  for each row execute function public.set_household_default();
drop trigger if exists lists_household_default on public.shopping_lists;
create trigger lists_household_default before insert on public.shopping_lists
  for each row execute function public.set_household_default();

-- any household member may edit or delete shared recipes ----------------
create or replace function public.owns_recipe(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.recipes r where r.id = rid and public.can_access(r.owner_id, r.household_id));
$$;

drop policy if exists recipes_update on public.recipes;
create policy recipes_update on public.recipes for update to authenticated
  using (public.can_access(owner_id, household_id))
  with check (public.can_access(owner_id, household_id)
              and (household_id is null or public.is_household_member(household_id)));
drop policy if exists recipes_delete on public.recipes;
create policy recipes_delete on public.recipes for delete to authenticated
  using (public.can_access(owner_id, household_id));
drop policy if exists lists_delete on public.shopping_lists;
create policy lists_delete on public.shopping_lists for delete to authenticated
  using (public.can_access(owner_id, household_id));

-- see each other's custom ingredients and recipe photos ---------------
drop policy if exists ingredients_select on public.ingredients;
create policy ingredients_select on public.ingredients for select to authenticated
  using (owner_id is null or owner_id = auth.uid() or public.shares_household_with(owner_id));

drop policy if exists "recipe photos read own" on storage.objects;
create policy "recipe photos read own" on storage.objects for select to authenticated
  using (bucket_id = 'recipe-photos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or ((storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        and public.shares_household_with(((storage.foldername(name))[1])::uuid))
  ));

-- functions the app calls ---------------------------------------------
create or replace function public._share_my_rows(p_hid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.recipes           set household_id = p_hid where owner_id = auth.uid() and household_id is null;
  update public.meal_plan_entries set household_id = p_hid where owner_id = auth.uid() and household_id is null;
  update public.shopping_lists    set household_id = p_hid where owner_id = auth.uid() and household_id is null;
end $$;

create or replace function public._make_join_code() returns text
language plpgsql as $$
declare chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; code text; i int;
begin
  loop
    code := '';
    for i in 1..6 loop code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
    exit when not exists (select 1 from public.households where join_code = code);
  end loop;
  return code;
end $$;

create or replace function public.get_household() returns json
language plpgsql stable security definer set search_path = public as $$
declare v_hid uuid := public.my_household_id(); r json;
begin
  if v_hid is null then return null; end if;
  select json_build_object(
    'id', h.id, 'name', h.name, 'join_code', h.join_code,
    'members', (select coalesce(json_agg(json_build_object(
        'user_id', m.user_id,
        'name', coalesce(nullif(p.display_name, ''), split_part(u.email, '@', 1)),
        'me', m.user_id = auth.uid()) order by m.joined_at), '[]'::json)
      from public.household_members m
      join auth.users u on u.id = m.user_id
      left join public.profiles p on p.id = m.user_id
      where m.household_id = h.id)
  ) into r from public.households h where h.id = v_hid;
  return r;
end $$;

create or replace function public.create_household(p_name text) returns json
language plpgsql security definer set search_path = public as $$
declare v_hid uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in again.'; end if;
  if public.my_household_id() is not null then raise exception 'You are already in a household.'; end if;
  insert into public.households (name, created_by, join_code)
    values (coalesce(nullif(trim(p_name), ''), 'Our household'), auth.uid(), public._make_join_code())
    returning id into v_hid;
  insert into public.household_members (household_id, user_id, role) values (v_hid, auth.uid(), 'owner');
  perform public._share_my_rows(v_hid);
  return public.get_household();
end $$;

create or replace function public.join_household(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare v_hid uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in again.'; end if;
  if public.my_household_id() is not null then raise exception 'You are already in a household. Leave it first.'; end if;
  select id into v_hid from public.households where join_code = upper(trim(p_code));
  if v_hid is null then raise exception 'That code wasn''t found. Check it and try again.'; end if;
  insert into public.household_members (household_id, user_id) values (v_hid, auth.uid());
  perform public._share_my_rows(v_hid);
  return public.get_household();
end $$;

create or replace function public.leave_household() returns void
language plpgsql security definer set search_path = public as $$
declare v_hid uuid := public.my_household_id();
begin
  if v_hid is null then return; end if;
  update public.recipes           set household_id = null where owner_id = auth.uid() and household_id = v_hid;
  update public.meal_plan_entries set household_id = null where owner_id = auth.uid() and household_id = v_hid;
  update public.shopping_lists    set household_id = null where owner_id = auth.uid() and household_id = v_hid;
  delete from public.household_members where household_id = v_hid and user_id = auth.uid();
  if not exists (select 1 from public.household_members where household_id = v_hid) then
    delete from public.households where id = v_hid;
  end if;
end $$;

create or replace function public.new_join_code() returns json
language plpgsql security definer set search_path = public as $$
declare v_hid uuid := public.my_household_id();
begin
  if v_hid is null then raise exception 'You are not in a household.'; end if;
  update public.households set join_code = public._make_join_code() where id = v_hid;
  return public.get_household();
end $$;

revoke execute on function public.get_household(), public.create_household(text), public.join_household(text),
  public.leave_household(), public.new_join_code(), public._share_my_rows(uuid), public._make_join_code()
  from public, anon;
grant execute on function public.get_household(), public.create_household(text), public.join_household(text),
  public.leave_household(), public.new_join_code() to authenticated;
