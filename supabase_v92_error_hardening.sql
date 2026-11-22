-- =====================================================================
--  v92: clean answers for bad input (found by running every student function with broken input)
--   * cbt_mistakes: a huge page offset overflowed a number ("integer out of range"); the offset is now capped at 100,000
--     (a page is 15-30 items, so real use never gets near it).
--   * admin reviews and admin suspects: the id / number in the request was read BEFORE the admin password was checked,
--     so anyone, even without signing in, could make them answer with a raw database error. It is now read after the check,
--     and a bad value gives {"ok": false, "error": "id" | "days"}.
--  Nothing else in these functions changes (only the lines marked v92 or the offset cap differ from the repo versions).
--  Where the bodies come from: cbt_mistakes = the exported base functions (no later file changes it);
--  admin reviews = supabase_v23_reviews.sql (its inner function is made by supabase_v35_admin_team.sql);
--  admin suspects = supabase_v68_reattempt_cheat_pdf.sql (inner function made by v35 too).
--  This file puts in the CURRENT repo versions of these three bodies, so first run supabase_check_installed.sql and
--  get every row to "ok" (run any missing file, then v35), and only then run this file.
--  Run after v90. Safe to run again. (If the older files that make these functions are ever run again, run v35 and then
--  this file again after them.)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.cbt_mistakes(p_mobile text, p_code text, p_device text, p_offset integer, p_limit integer, p_kind text, p_sec text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cbt_private', 'pg_temp'
AS $function$
declare a jsonb; sid uuid; items jsonb; cnt jsonb; fcount int;
        lim int := least(greatest(coalesce(p_limit,15),1),30); off int := least(greatest(coalesce(p_offset,0),0),100000);
begin
  a := auth(p_mobile,p_code,p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;

  select jsonb_build_object(
    'wrong', count(*) filter (where kind = 'wrong'),
    'skipped', count(*) filter (where kind = 'skipped'),
    'secs', (select coalesce(jsonb_agg(jsonb_build_object('sec',z.sec,'n',z.n) order by z.sec),'[]'::jsonb)
             from (select m2.sec, count(*) n from mistake_rows(sid) m2 where res_visible(m2.test_id::text) group by m2.sec) z),
    'mastered', (select count(*) from mistake_done where student_id = sid))
  into cnt from mistake_rows(sid) m0 where res_visible(m0.test_id::text);

  select count(*) into fcount from mistake_rows(sid) m
   where res_visible(m.test_id::text) and (p_kind is null or p_kind in ('','all') or m.kind = p_kind) and (p_sec is null or p_sec = '' or m.sec = p_sec);

  select coalesce(jsonb_agg(jsonb_build_object('test_id',z.test_id,'title',z.title,'at',z.at,'qidx',z.qi,'kind',z.kind,'sec',z.sec,
      'q',z.v->'q','options',z.v->'options','answer',z.v->'answer','explanation',coalesce(z.v->'explanation','""'::jsonb),
      'img',z.v->'img','oimg',z.v->'oimg','eimg',z.v->'eimg','mine',z.ans,'time',z.tm) order by z.at desc, z.test_id, z.qi),'[]'::jsonb)
  into items
  from (select * from mistake_rows(sid) m
        where res_visible(m.test_id::text) and (p_kind is null or p_kind in ('','all') or m.kind = p_kind) and (p_sec is null or p_sec = '' or m.sec = p_sec)
        order by m.at desc, m.test_id, m.qi offset off limit lim) z;

  return jsonb_build_object('ok',true,'items',items_lang(sid, items),'counts',cnt,'offset',off,'more',fcount > off + lim);
end $function$;

CREATE OR REPLACE FUNCTION cbt_private.cbt_admin_reviews__core(p_pw text, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare a jsonb; v_id uuid;
begin
  a := (public.cbt_admin(p_pw, 'ping', '{}'))::text::jsonb;
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;
  -- v92: the id is read only after the admin check, and a bad one gives a clean answer (not a database error)
  begin v_id := nullif(p_data->>'id', '')::uuid; exception when others then return jsonb_build_object('ok', false, 'error', 'id'); end;

  if p_action = 'get' then
    return jsonb_build_object('ok', true,
      'moderate', (select moderate from public.cbt_review_settings where id = 1),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'series_id', series_id, 'mobile', mobile, 'name', name, 'photo', photo,
                 'rating', rating, 'body', body, 'status', status, 'pinned', pinned, 'reply', reply,
                 'created_at', created_at, 'updated_at', updated_at) order by updated_at desc)
               from (select * from public.cbt_reviews order by updated_at desc limit 1000) r), '[]'::jsonb));

  elsif p_action = 'status' then
    if p_data->>'status' not in ('shown', 'pending', 'hidden') then return jsonb_build_object('ok', false, 'error', 'status'); end if;
    update public.cbt_reviews set status = p_data->>'status' where id = v_id;
    return jsonb_build_object('ok', true);

  elsif p_action = 'pin' then
    update public.cbt_reviews set pinned = coalesce((p_data->>'pinned')::boolean, false) where id = v_id;
    return jsonb_build_object('ok', true);

  elsif p_action = 'reply' then
    update public.cbt_reviews set reply = left(btrim(regexp_replace(coalesce(p_data->>'reply', ''), '[<>\r\t]', '', 'g')), 400) where id = v_id;
    return jsonb_build_object('ok', true);

  elsif p_action = 'remove_photo' then
    update public.cbt_reviews set photo = '' where id = v_id;
    return jsonb_build_object('ok', true);

  elsif p_action = 'delete' then
    delete from public.cbt_reviews where id = v_id;
    return jsonb_build_object('ok', true);

  elsif p_action = 'moderate' then
    update public.cbt_review_settings set moderate = coalesce((p_data->>'on')::boolean, false) where id = 1;
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'action');
end; $function$;

CREATE OR REPLACE FUNCTION cbt_private.cbt_admin_suspects__core(p_pw text, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cbt_private', 'pg_temp'
AS $function$
declare e text; d jsonb := coalesce(p_data, '{}'::jsonb); v_days int;
begin
  e := admin_ok(p_pw);
  if e is not null then return jsonb_build_object('ok', false, 'error', e); end if;
  -- v92: read only after the admin check; a bad number gives a clean answer (not a database error)
  begin v_days := coalesce(nullif(d->>'days', '')::int, 30); exception when others then return jsonb_build_object('ok', false, 'error', 'days'); end;

  if p_action = 'count' then
    return jsonb_build_object('ok', true, 'count', (select count(*) from suspect_rows(7) s
      where not exists (select 1 from public.cbt_cheat_flags f where f.student_id = s.student_id and f.test_id = s.test_id)));
  elsif p_action = 'get' then
    return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.result_id, 'test_id', s.test_id, 'title', s.title, 'score', s.score, 'max', s.max_score,
        'used', s.used_seconds, 'duration', s.duration, 'at', (extract(epoch from s.at) * 1000)::bigint,
        'name', st.name, 'mobile', st.mobile,
        'flagged', exists (select 1 from public.cbt_cheat_flags f where f.student_id = s.student_id and f.test_id = s.test_id))
        order by s.at desc)
      from (select * from suspect_rows(v_days) limit 300) s join students st on st.id = s.student_id), '[]'::jsonb));
  elsif p_action = 'ok' then
    if not exists (select 1 from results where id::text = d->>'result_id') then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    insert into suspect_ok (result_id) values (d->>'result_id') on conflict do nothing;
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'action');
end $function$;

-- check (should be true, true, true)
select pg_get_functiondef('public.cbt_mistakes(text,text,text,integer,integer,text,text)'::regprocedure) like '%100000%' as mistakes_v92,
       pg_get_functiondef('cbt_private.cbt_admin_reviews__core(text,text,jsonb)'::regprocedure) like '%v92: the id is read only after%' as reviews_v92,
       pg_get_functiondef('cbt_private.cbt_admin_suspects__core(text,text,jsonb)'::regprocedure) like '%v92: read only after the admin check%' as suspects_v92;
