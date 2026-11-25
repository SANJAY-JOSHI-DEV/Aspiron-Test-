-- =====================================================================
--  v100: Student category — Class 9 / 10 / 11 / 12 / Dropper and exam NEET / JEE / CBSE / CUET.
--  • The store can now set a series for CBSE only or CUET only (before: NEET, JEE or both).
--  • The Tests page filter lists are not changed here: add CBSE, CUET, Class 9 and Class 10 in Admin → Tests page.
--  Run ONCE in Supabase → SQL Editor → New query → paste → Run (after v32 and v61).  Safe to run again.
--  No new table, no cron, no paid feature.
-- =====================================================================

-- Admin: 'place' (course + section of one series) · 'order' · 'sections' — as in v32, plus 'cbse' and 'cuet'
create or replace function public.cbt_admin_store_layout(p_pw text, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb; v_item uuid; v_course text := lower(btrim(coalesce(p_data->>'course', '')));
begin
  a := (public.cbt_admin(p_pw, 'ping', '{}'))::text::jsonb;
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;

  if p_action = 'place' then
    v_item := nullif(p_data->>'item', '')::uuid;
    if v_item is null or not exists (select 1 from public.cbt_store_items where id = v_item) then
      return jsonb_build_object('ok', false, 'error', 'item');
    end if;
    if v_course not in ('', 'neet', 'jee', 'cbse', 'cuet') then return jsonb_build_object('ok', false, 'error', 'course'); end if;
    update public.cbt_store_items set course = v_course,
      section = left(btrim(regexp_replace(coalesce(p_data->>'section', ''), '[<>"`\r\n\t]', '', 'g')), 40)
     where id = v_item;
    return jsonb_build_object('ok', true);

  elsif p_action = 'order' then
    update public.cbt_store_items t set sort_order = z.ord * 10
      from (select x::uuid as id, ord from jsonb_array_elements_text(coalesce(p_data->'ids', '[]'::jsonb)) with ordinality as e(x, ord)
             where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') z
     where t.id = z.id;
    return jsonb_build_object('ok', true);

  elsif p_action = 'sections' then
    update public.cbt_store_settings set sections = coalesce((
      select jsonb_agg(t order by ord) from (
        select left(btrim(regexp_replace(x, '[<>"`\r\n\t]', '', 'g')), 40) as t, ord
          from jsonb_array_elements_text(coalesce(p_data->'list', '[]'::jsonb)) with ordinality as e(x, ord) limit 30) z
       where t <> ''), '[]'::jsonb)
     where id = 1;
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'action');
end; $$;
revoke all on function public.cbt_admin_store_layout(text, text, jsonb) from public, authenticated;
grant execute on function public.cbt_admin_store_layout(text, text, jsonb) to anon;

notify pgrst, 'reload schema';
