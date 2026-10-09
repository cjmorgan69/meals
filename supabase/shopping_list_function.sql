-- Run once in Supabase > SQL Editor. (Builds the shopping list from the meal plan.)
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

revoke execute on function public.generate_shopping_list(uuid, date, date) from public, anon;
grant  execute on function public.generate_shopping_list(uuid, date, date) to authenticated, service_role;
