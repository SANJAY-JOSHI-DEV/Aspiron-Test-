-- =====================================================================
--  v93: Question of the Day — two more ways to add a question (Admin → Question of the Day → Add questions)
--  1. Write a question: the admin types the question, 4 options, the right answer, the explanation and the subject.
--     It is saved in the Question bank (so students can practise it later too) and put on the chosen day.
--  2. From a test series: pick a series → one of its tests → tick its questions. Each ticked question is copied into
--     the Question bank once (the same "test:<test id>:<number>" link the Question bank page uses) and put on the day.
--     A test whose result is not out yet is refused: its questions would show the answers before the result time.
--  The old way (pick from the Question bank) stays. Text questions only (no picture), at most 40 questions a day, as in v88.
--  Nothing existing is changed. Safe to run again.
--  Run in Supabase → SQL Editor after v92 (needs v88), then run supabase_v35_admin_team.sql AGAIN.
-- =====================================================================

-- text typed by the admin: control characters removed, trimmed, cut to the limit (shown as text in the app, never as HTML)
create or replace function cbt_private.qotd_txt(p text, p_max int) returns text language sql immutable as $$
  select left(btrim(regexp_replace(coalesce(p, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f]', '', 'g')), p_max)
$$;
revoke all on function cbt_private.qotd_txt(text, int) from public, anon, authenticated;

-- put one bank question on a day (the v88 rules); returns 'added' | 'there' | 'full'
create or replace function cbt_private.qotd_put(p_qid uuid, p_day date) returns text language plpgsql
set search_path = cbt_private, pg_temp as $$
declare v_n int;
begin
  select count(*) into v_n from qotd where show_on = p_day;
  if v_n >= 40 then return 'full'; end if;
  insert into qotd (qid, show_on, sort) values (p_qid, p_day, v_n) on conflict (qid, show_on) do nothing;
  return case when found then 'added' else 'there' end;
end $$;
revoke all on function cbt_private.qotd_put(uuid, date) from public, anon, authenticated;

-- ---------- admin: series · test {test_id} · write {date, subject, chapter?, q, options[4], answer, explanation?}
--                   · add_test {date, test_id, idx:[numbers], subject} ----------
create or replace function public.cbt_admin_qotd_add(p_pw text, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare
  e text; d jsonb := case when jsonb_typeof(p_data) = 'object' then p_data else '{}'::jsonb end;
  v_day date; v_tid uuid; x tests%rowtype; v_q jsonb; v_i int; v_id uuid; v_r text; v_add int := 0; v_there int := 0; v_bad int := 0;
  v_sub text; v_txt text; v_opts jsonb; v_ans int;
begin
  e := admin_ok(p_pw);
  if e is not null then return jsonb_build_object('ok', false, 'error', e); end if;

  if p_action = 'series' then   -- every series with its tests (newest first), for the picker
    return jsonb_build_object('ok', true, 'v93', true, 'series', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'tests', coalesce((
               select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'n', jsonb_array_length(t.data), 'held', res_hidden(t.id))
                        order by t.created_at desc)
                 from tests t where t.series_id = s.id and jsonb_typeof(t.data) = 'array'), '[]'::jsonb))
             order by s.sort_order, s.created_at desc)
        from series s), '[]'::jsonb));
  end if;

  if p_action in ('test', 'add_test') then
    begin v_tid := (d->>'test_id')::uuid; exception when others then return jsonb_build_object('ok', false, 'error', 'test'); end;
    select * into x from tests where id = v_tid;
    if not found or jsonb_typeof(x.data) <> 'array' then return jsonb_build_object('ok', false, 'error', 'test'); end if;
  end if;

  if p_action = 'test' then   -- the questions of one test (text only, 4 options, an answer → usable)
    return jsonb_build_object('ok', true, 'title', x.title, 'held', res_hidden(v_tid), 'items', coalesce((
      select jsonb_agg(jsonb_build_object('i', o - 1, 'q', left(coalesce(q->>'q', ''), 400), 'sec', left(coalesce(q->>'sec', ''), 40),
               'a', q->'answer',
               'use', coalesce(q->>'q', '') <> '' and coalesce(q->>'img', '') = ''
                      and jsonb_typeof(q->'options') = 'array' and jsonb_array_length(q->'options') >= 4
                      and coalesce(q->>'answer', '') ~ '^[0-3]$'
                      and not (jsonb_typeof(q->'oimg') = 'array' and exists (select 1 from jsonb_array_elements(q->'oimg') z where jsonb_typeof(z) = 'string' and (z #>> '{}') <> '')),
               'there', exists (select 1 from qbank b where b.src = 'test:' || v_tid || ':' || (o - 1))) order by o)
        from jsonb_array_elements(x.data) with ordinality as w(q, o)), '[]'::jsonb));
  end if;

  if p_action not in ('write', 'add_test') then return jsonb_build_object('ok', false, 'error', 'action'); end if;
  begin
    v_day := case when d->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then (d->>'date')::date end;
  exception when others then v_day := null; end;
  if v_day is null or v_day < qotd_day() - 1 or v_day > qotd_day() + 365 then return jsonb_build_object('ok', false, 'error', 'date'); end if;
  v_sub := lower(qotd_txt(d->>'subject', 30));
  if v_sub !~ '^[a-z][a-z0-9_ -]{0,29}$' then return jsonb_build_object('ok', false, 'error', 'subject'); end if;

  if p_action = 'write' then
    v_txt := qotd_txt(d->>'q', 2000);
    if length(v_txt) < 5 then return jsonb_build_object('ok', false, 'error', 'q'); end if;
    if jsonb_typeof(d->'options') <> 'array' or jsonb_array_length(d->'options') <> 4 then return jsonb_build_object('ok', false, 'error', 'options'); end if;
    select jsonb_agg(qotd_txt(o, 300) order by n) into v_opts from jsonb_array_elements_text(d->'options') with ordinality as w(o, n);
    if exists (select 1 from jsonb_array_elements_text(v_opts) o where o = '') then return jsonb_build_object('ok', false, 'error', 'options'); end if;
    if coalesce(d->>'answer', '') !~ '^[0-3]$' then return jsonb_build_object('ok', false, 'error', 'answer'); end if;
    v_ans := (d->>'answer')::int;
    if (select count(*) from qotd where show_on = v_day) >= 40 then return jsonb_build_object('ok', false, 'error', 'full'); end if;
    insert into qbank (subject, chapter, topic, level, qtype, source, q, options, answer, explanation, src)
    values (v_sub, qotd_txt(d->>'chapter', 80), '', 'medium', qb_type(v_txt), 'extra', v_txt, v_opts, v_ans, qotd_txt(d->>'explanation', 3000), null)
    returning id into v_id;
    v_r := qotd_put(v_id, v_day);
    perform set_config('cbt.detail', left(v_txt, 120), true);
    return jsonb_build_object('ok', true, 'added', case when v_r = 'added' then 1 else 0 end, 'id', v_id);
  end if;

  -- add_test
  if res_hidden(v_tid) then return jsonb_build_object('ok', false, 'error', 'held'); end if;
  if jsonb_typeof(d->'idx') <> 'array' or jsonb_array_length(d->'idx') = 0 then return jsonb_build_object('ok', false, 'error', 'ids'); end if;
  for v_i in select distinct (v #>> '{}')::int from jsonb_array_elements(d->'idx') v where (v #>> '{}') ~ '^\d{1,4}$' limit 40 loop
    v_q := x.data->v_i;
    if v_q is null or coalesce(v_q->>'q', '') = '' or coalesce(v_q->>'img', '') <> '' or jsonb_typeof(v_q->'options') <> 'array'
       or jsonb_array_length(v_q->'options') < 4 or coalesce(v_q->>'answer', '') !~ '^[0-3]$'
       or (jsonb_typeof(v_q->'oimg') = 'array' and exists (select 1 from jsonb_array_elements(v_q->'oimg') z where jsonb_typeof(z) = 'string' and (z #>> '{}') <> '')) then
      v_bad := v_bad + 1; continue;
    end if;
    insert into qbank (subject, chapter, topic, level, qtype, source, q, options, answer, explanation, src)
    values (v_sub, '', '', 'medium', qb_type(v_q->>'q'), 'extra', v_q->>'q',
            (select jsonb_agg(o order by n) from jsonb_array_elements(v_q->'options') with ordinality as w(o, n) where n <= 4),
            (v_q->>'answer')::int, coalesce(v_q->>'explanation', ''), 'test:' || v_tid || ':' || v_i)
    on conflict (src) do nothing;
    select id into v_id from qbank where src = 'test:' || v_tid || ':' || v_i;
    v_r := qotd_put(v_id, v_day);
    if v_r = 'full' then
      perform set_config('cbt.detail', left(x.title, 120), true);
      return jsonb_build_object('ok', false, 'error', 'full', 'added', v_add);
    end if;
    if v_r = 'added' then v_add := v_add + 1; else v_there := v_there + 1; end if;
  end loop;
  perform set_config('cbt.detail', left(x.title, 120), true);
  return jsonb_build_object('ok', true, 'added', v_add, 'skipped', v_there, 'bad', v_bad);
end $$;
revoke all on function public.cbt_admin_qotd_add(text, text, jsonb) from public, authenticated;
grant execute on function public.cbt_admin_qotd_add(text, text, jsonb) to anon;

notify pgrst, 'reload schema';
select 'v93 installed — now run supabase_v35_admin_team.sql again' as status;
