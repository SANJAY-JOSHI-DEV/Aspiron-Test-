-- =====================================================================
--  v100: Student category — Class 9 / 10 / 11 / 12 / Dropper and exam NEET / JEE / CBSE / CUET.
--  • The store can now set a series for CBSE only or CUET only (before: NEET, JEE or both).
--  • The Tests page filter lists (Admin → Tests page) get the new classes and exams added, if missing.
--    Nothing is removed and no series' tags change.
--  Run ONCE in Supabase → SQL Editor → New query → paste → Run (after v32 and v61).  Safe to run again.
--  No new table, no cron, no paid feature.
-- =====================================================================

-- Admin: 'place' (course + section of one series) · 'order' · 'sections' — as in v32, plus 'cbse' and 'cuet'
create or replace function public.cbt_admin_store_layout(p_pw text, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
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
grant execute on function public.cbt_admin_store_layout(text, text, jsonb) to anon, authenticated;

-- Tests page filter lists: add the new exams and classes at the end, keeping what the admin already has
do $$
declare v text;
begin
  if to_regclass('cbt_private.store_look') is null then return; end if;
  foreach v in array array['NEET','JEE','CBSE','CUET'] loop
    update cbt_private.store_look set exams = exams || to_jsonb(v) where id = 1 and jsonb_array_length(exams) < 20
       and not exists (select 1 from jsonb_array_elements_text(exams) e where lower(e) = lower(v));
  end loop;
  foreach v in array array['Class 9','Class 10','Class 11','Class 12','Dropper'] loop
    update cbt_private.store_look set classes = classes || to_jsonb(v) where id = 1 and jsonb_array_length(classes) < 20
       and not exists (select 1 from jsonb_array_elements_text(classes) e where lower(e) = lower(v));
  end loop;
end $$;

notify pgrst, 'reload schema';
