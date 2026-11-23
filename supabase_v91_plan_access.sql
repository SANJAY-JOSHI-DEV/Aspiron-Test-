-- =====================================================================
--  v91: Plan access — what Free / Basic / Pro / Ultra may use, decided on the SERVER
--  • One list of features with a limit per plan (Admin → Plans → Access):
--      -1 = unlimited, 0 = not in this plan, N = N uses per period (a day, a month in India time, or in total).
--    Starting values follow the owner's table: Question bank and PYQ = Pro and Ultra, Test generator = 4 a month in
--    Pro and unlimited in Ultra, Doubts = 2 to try on Free and unlimited from Basic.
--  • A student's plan: a plan given by the admin (until its end date) → else Basic when the student has a paid
--    test series → else Free. Payment does not exist yet, so "Give a plan" in the admin is the only way to Pro / Ultra.
--  • LOCKS ARE OFF until the owner switches them on (Admin → Plans → Access). While off, every student can use
--    everything exactly as before; the app only shows which plan a feature belongs to. Uses are counted either way,
--    and every count starts again from zero when the locks are turned on.
--  • Running v55, v75, v43 or v87 again AFTER this file puts back the old function without the plan check: then run this
--    file again. supabase_check_installed.sql (row 32) says so.
--  • The question bank, PYQ chapters, the test generator and doubts check the plan inside their own functions, so the
--    old app and direct calls follow the same rule. Retakes of a generated test and tests already made stay free.
--  Changes: cbt_qb_next, cbt_qb_check, cbt_gen_create, cbt_pyq_chapter and cbt_doubt_ask get one plan check each
--  (their bodies are otherwise the same as in v55 / v75 / v43 / v87). Nothing is deleted. Safe to run again.
--  Run in Supabase → SQL Editor after v90, then run supabase_v35_admin_team.sql AGAIN.
-- =====================================================================

alter table cbt_private.plan_settings add column if not exists enforce boolean not null default false;

create table if not exists cbt_private.plan_features (
  key    text primary key check (key ~ '^[a-z][a-z0-9_]{1,20}$'),
  title  text not null check (length(title) between 1 and 60),
  unit   text not null default 'uses' check (length(unit) between 1 and 20),
  period text not null default 'month' check (period in ('day', 'month', 'total')),
  free   int  not null default 0 check (free between -1 and 100000),
  basic  int  not null default 0 check (basic between -1 and 100000),
  pro    int  not null default -1 check (pro between -1 and 100000),
  ultra  int  not null default -1 check (ultra between -1 and 100000),
  sort   int  not null default 0
);
insert into cbt_private.plan_features (key, title, unit, period, free, basic, pro, ultra, sort) values
  ('qb',    'Question bank',  'questions', 'day',   0,  0, -1, -1, 1),
  ('pyq',   'PYQ bank',       'chapters',  'day',   0,  0, -1, -1, 2),
  ('gen',   'Test generator', 'tests',     'month', 0,  0,  4, -1, 3),
  ('doubt', 'Doubts',         'doubts',    'total', 2, -1, -1, -1, 4)
on conflict (key) do nothing;

-- a plan given by the admin (until payments exist, the only way to Pro / Ultra)
create table if not exists cbt_private.plan_grants (
  student_id uuid primary key references cbt_private.students(id) on delete cascade,
  plan       text not null check (plan in ('basic', 'pro', 'ultra')),
  ends_at    timestamptz not null,
  note       text not null default '' check (length(note) <= 120),
  created_at timestamptz not null default now()
);

-- uses per student, feature and period ('2026-11-22', '2026-11' or 'all')
create table if not exists cbt_private.plan_usage (
  student_id uuid not null references cbt_private.students(id) on delete cascade,
  feature    text not null,
  period     text not null,
  n          int  not null default 0,
  primary key (student_id, feature, period)
);
alter table cbt_private.plan_features enable row level security;
alter table cbt_private.plan_grants enable row level security;
alter table cbt_private.plan_usage enable row level security;
revoke all on cbt_private.plan_features, cbt_private.plan_grants, cbt_private.plan_usage from public, anon, authenticated;

-- the student's plan right now
create or replace function cbt_private.plan_of(p_sid uuid) returns text language sql stable
set search_path = cbt_private, pg_temp as $$
  select coalesce(
    (select g.plan from plan_grants g where g.student_id = p_sid and g.ends_at > now()),
    case when exists (select 1 from series_access ac join series s on s.id = ac.series_id
                       where ac.student_id = p_sid and not coalesce(s.is_free, false)) then 'basic' end,
    'free')
$$;

-- the period key in India time
create or replace function cbt_private.plan_period(p text) returns text language sql stable as $$
  select case p when 'day' then to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD')
                when 'month' then to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM')
                else 'all' end
$$;

create or replace function cbt_private.plan_lim(f cbt_private.plan_features, p_plan text) returns int language sql immutable as $$
  select case p_plan when 'ultra' then f.ultra when 'pro' then f.pro when 'basic' then f.basic else f.free end
$$;

-- the lowest plan that has the feature (for "Upgrade to Pro")
create or replace function cbt_private.plan_need(f cbt_private.plan_features, p_plan text) returns text language sql immutable as $$
  select coalesce((select k from (values (0, 'free', f.free), (1, 'basic', f.basic), (2, 'pro', f.pro), (3, 'ultra', f.ultra)) v(o, k, l)
                    where o > case p_plan when 'ultra' then 3 when 'pro' then 2 when 'basic' then 1 else 0 end
                      and (l = -1 or l > cbt_private.plan_lim(f, p_plan)) order by o limit 1), '')
$$;

-- may the student use the feature? null = yes (and one use is counted when p_take);
-- otherwise {ok:false, error:'plan', feature, plan, need, lim, used, period}. With the locks off it always says yes.
create or replace function cbt_private.plan_use(p_sid uuid, p_key text, p_take boolean) returns jsonb language plpgsql
set search_path = cbt_private, pg_temp as $$
declare f plan_features%rowtype; v_plan text; v_lim int; v_per text; v_n int; v_on boolean;
begin
  select * into f from plan_features where key = p_key;
  if not found then return null; end if;
  v_on := coalesce((select enforce from plan_settings where id = 1), false);
  v_plan := plan_of(p_sid); v_lim := plan_lim(f, v_plan); v_per := plan_period(f.period);
  if not v_on or v_lim = -1 then
    if p_take then
      insert into plan_usage (student_id, feature, period, n) values (p_sid, p_key, v_per, 1)
      on conflict (student_id, feature, period) do update set n = plan_usage.n + 1;
    end if;
    return null;
  end if;
  if v_lim > 0 then
    if p_take then
      insert into plan_usage as u (student_id, feature, period, n) values (p_sid, p_key, v_per, 1)
      on conflict (student_id, feature, period) do update set n = u.n + 1 where u.n < v_lim
      returning n into v_n;
      if v_n is not null then return null; end if;
    elsif coalesce((select n from plan_usage where student_id = p_sid and feature = p_key and period = v_per), 0) < v_lim then
      return null;
    end if;
  end if;
  return jsonb_build_object('ok', false, 'error', 'plan', 'feature', p_key, 'title', f.title, 'plan', v_plan,
    'need', plan_need(f, v_plan), 'lim', v_lim, 'period', f.period,
    'used', coalesce((select n from plan_usage where student_id = p_sid and feature = p_key and period = v_per), 0));
end $$;
revoke all on function cbt_private.plan_of(uuid), cbt_private.plan_period(text), cbt_private.plan_use(uuid, text, boolean),
  cbt_private.plan_lim(cbt_private.plan_features, text), cbt_private.plan_need(cbt_private.plan_features, text)
  from public, anon, authenticated;

-- ---------- student: my plan, and what is left of each feature ----------
create or replace function public.cbt_my_plan(p_mobile text, p_code text, p_device text)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; v_plan text;
begin
  a := auth(p_mobile, p_code, p_device);
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;
  sid := (a->>'id')::uuid; v_plan := plan_of(sid);
  return jsonb_build_object('ok', true, 'v91', true, 'plan', v_plan,
    'ends_at', (select (extract(epoch from g.ends_at) * 1000)::bigint from plan_grants g where g.student_id = sid and g.ends_at > now()),
    'enforce', coalesce((select enforce from plan_settings where id = 1), false),
    'feats', coalesce((select jsonb_agg(jsonb_build_object('key', f.key, 'title', f.title, 'unit', f.unit, 'period', f.period,
               'lim', plan_lim(f, v_plan), 'need', plan_need(f, v_plan),
               'min', case when f.free <> 0 then 'free' when f.basic <> 0 then 'basic' when f.pro <> 0 then 'pro' else 'ultra' end,
               'used', coalesce((select n from plan_usage u where u.student_id = sid and u.feature = f.key and u.period = plan_period(f.period)), 0))
               order by f.sort) from plan_features f), '[]'::jsonb));
end $$;
revoke all on function public.cbt_my_plan(text, text, text) from public;
grant execute on function public.cbt_my_plan(text, text, text) to anon, authenticated;

-- ===================== the gated functions (same bodies, one plan check each) =====================
-- question bank: next questions (checks, does not count)
create or replace function public.cbt_qb_next(p_mobile text, p_code text, p_device text, p_f jsonb, p_skip jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; f jsonb := case when jsonb_typeof(p_f) = 'object' then p_f else '{}'::jsonb end; v_skip uuid[]; v_p jsonb;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  v_p := plan_use(sid, 'qb', false); if v_p is not null then return v_p; end if;   -- v91
  if not rate_ok(sid, 'qbn', 80) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;   -- 800 questions an hour
  v_skip := array(select v::uuid from jsonb_array_elements_text(case when jsonb_typeof(p_skip) = 'array' then p_skip else '[]'::jsonb end) v
                   where v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' limit 1000);
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(qb_open(x)) from (
      select b.* from qbank b
       where qb_match(b, f) and not (b.id = any (v_skip))
       order by exists (select 1 from qb_log l where l.student_id = sid and l.qid = b.id), random()
       limit 10) x), '[]'::jsonb),
    'total', (select count(*) from qbank b where qb_match(b, f)));
end $$;
grant execute on function public.cbt_qb_next(text, text, text, jsonb, jsonb) to anon, authenticated;

-- question bank: check an answer (one answered question = one use)
create or replace function public.cbt_qb_check(p_mobile text, p_code text, p_device text, p_q uuid, p_choice int)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; b qbank%rowtype; v_p jsonb;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  if p_choice is null or p_choice not between 0 and 3 then return jsonb_build_object('ok', false, 'error', 'invalid_choice'); end if;
  select * into b from qbank where id = p_q and active and qb_src_open(src);   -- v75: not a live test's question
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not rate_ok(sid, 'qbc', 800) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  v_p := plan_use(sid, 'qb', true); if v_p is not null then return v_p; end if;   -- v91
  insert into qb_log (student_id, qid, choice, ok) values (sid, b.id, p_choice, p_choice = b.answer)
  on conflict (student_id, qid) do update set choice = excluded.choice, ok = excluded.ok, tries = qb_log.tries + 1, at = now();
  return jsonb_build_object('ok', true, 'right', p_choice = b.answer, 'answer', b.answer, 'explanation', b.explanation);
end $$;
grant execute on function public.cbt_qb_check(text, text, text, uuid, int) to anon, authenticated;

-- test generator: a new test is one use; a retake only needs the feature in the plan
create or replace function public.cbt_gen_create(p_mobile text, p_code text, p_device text, p_d jsonb)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare
  a jsonb; sid uuid; d jsonb := case when jsonb_typeof(p_d) = 'object' then p_d else '{}'::jsonb end;
  f jsonb; v_n int; v_dur int; v_plus numeric; v_minus numeric; v_at bigint; v_now bigint := now_ms(); v_ids uuid[];
  v_title text; v_ord text; g gen_tests%rowtype; v_id uuid; v_p jsonb;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  if (select count(*) from gen_tests where student_id = sid and submitted_at is null) >= 30 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;
  if not rate_ok(sid, 'qbg', 20) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  v_at := case when d->>'at' ~ '^\d{10,15}$' then (d->>'at')::bigint else v_now end;
  if v_at < v_now then v_at := v_now; end if;
  if v_at > v_now + 180::bigint * 86400000 then return jsonb_build_object('ok', false, 'error', 'bad_time'); end if;

  if d ? 'copy' then   -- retake: same questions and settings, new attempt
    v_p := plan_use(sid, 'gen', false);   -- v91: a retake is not counted
    if v_p is not null and (v_p->>'lim')::int = 0 then return v_p; end if;
    select * into g from gen_tests where id = case when d->>'copy' ~ '^[0-9a-f-]{36}$' then (d->>'copy')::uuid end and student_id = sid;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    insert into gen_tests (student_id, title, qids, duration, plus, minus, opts, starts_at)
    values (sid, left(regexp_replace(g.title, ' \(retake( \d+)?\)$', '') || ' (retake)', 80), g.qids, g.duration, g.plus, g.minus, g.opts, v_at)
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'n', cardinality(g.qids));
  end if;

  f := case when jsonb_typeof(d->'f') = 'object' then d->'f' else '{}'::jsonb end;
  v_n := case when d->>'n' ~ '^\d{1,3}$' then (d->>'n')::int end;
  v_dur := case when d->>'dur' ~ '^\d{1,3}$' then (d->>'dur')::int end;
  if v_n is null or v_n not between 5 and 200 or v_dur is null or v_dur not between 5 and 360 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  v_plus := case when d->>'plus' in ('1', '2', '3', '4') then (d->>'plus')::numeric else 4 end;
  v_minus := case when d->>'minus' in ('0', '0.25', '0.5', '1') then (d->>'minus')::numeric else 1 end;
  v_ord := case when d->>'order' = 'subject' then 'subject' else 'mix' end;
  v_title := left(btrim(regexp_replace(coalesce(d->>'title', ''), '[\x00-\x1f<>]', '', 'g')), 80);
  if v_title = '' then v_title := 'My test'; end if;

  v_p := plan_use(sid, 'gen', false); if v_p is not null then return v_p; end if;   -- v91 (counted once the test is made)
  -- an even share of every subject, then of every chapter (round-robin), questions not practised first
  select array_agg(id order by case when v_ord = 'subject' then subject end, ord2) into v_ids from (
    select id, subject, random() ord2 from (
      select b.id, b.subject,
             row_number() over (partition by b.subject order by rn_c, seen, random()) rn_s
        from (select b.*, row_number() over (partition by b.subject, b.chapter order by random()) rn_c,
                     exists (select 1 from qb_log l where l.student_id = sid and l.qid = b.id) seen
                from qbank b where qb_match(b, f)) b) x
     order by rn_s, random() limit v_n) y;
  if v_ids is null or cardinality(v_ids) = 0 then return jsonb_build_object('ok', false, 'error', 'empty'); end if;
  v_p := plan_use(sid, 'gen', true); if v_p is not null then return v_p; end if;   -- v91
  insert into gen_tests (student_id, title, qids, duration, plus, minus, opts, starts_at)
  values (sid, v_title, v_ids, v_dur, v_plus, v_minus,
          jsonb_build_object('f', f, 'order', v_ord, 'want', v_n), v_at)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'n', cardinality(v_ids), 'want', v_n);
end $$;
grant execute on function public.cbt_gen_create(text, text, text, jsonb) to anon, authenticated;

-- PYQ: one chapter opened = one use
create or replace function public.cbt_pyq_chapter(p_mobile text, p_code text, p_device text, p_exam text, p_chapter text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a jsonb; v_sid uuid; v_p jsonb;
begin
  a := (public.cbt_notice(p_mobile => p_mobile, p_code => p_code, p_device => p_device))::text::jsonb;
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;
  v_sid := (select id from cbt_private.students where mobile = cbt_private.norm_mobile(p_mobile));
  -- v43: at most 60 chapters an hour per student
  if not cbt_private.rate_ok(v_sid, 'pyq', 60) then
    return jsonb_build_object('ok',false,'error','busy');
  end if;
  v_p := cbt_private.plan_use(v_sid, 'pyq', true); if v_p is not null then return v_p; end if;   -- v91
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 't', topic, 'y', year, 'p', paper, 'n', qno, 'q', q, 'o', options, 'a', answer, 'e', explanation, 'img', has_img, 'k', rkey,
             'rep', (select jsonb_agg(distinct r.paper) from public.cbt_pyq r where r.exam = p.exam and r.rkey = p.rkey and r.rkey <> '' ))
             order by year desc, qno)
    from public.cbt_pyq p where exam = p_exam and chapter = p_chapter), '[]'::jsonb));
end; $$;
grant execute on function public.cbt_pyq_chapter(text, text, text, text, text) to anon, authenticated;

-- doubts: one doubt asked = one use
create or replace function public.cbt_doubt_ask(p_mobile text, p_code text, p_device text, p_test text, p_qidx int, p_subject text, p_body text)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; v_sid uuid; v_tid uuid; x cbt_private.tests%rowtype; v_id uuid; v_q jsonb; v_p jsonb;
        v_body text := cbt_private.doubt_txt(p_body, 1200);
        v_sub  text := cbt_private.doubt_txt(p_subject, 40);
begin
  a := cbt_private.auth(p_mobile, p_code, p_device);
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;
  v_sid := (a->>'id')::uuid;
  if length(v_body) < 5 then return jsonb_build_object('ok', false, 'error', 'short'); end if;
  begin v_tid := p_test::uuid; exception when others then return jsonb_build_object('ok', false, 'error', 'test'); end;
  select * into x from cbt_private.tests where id = v_tid;
  if not found then return jsonb_build_object('ok', false, 'error', 'test'); end if;
  if not exists (select 1 from cbt_private.results where student_id = v_sid and test_id = v_tid) then
    return jsonb_build_object('ok', false, 'error', 'not_taken');
  end if;
  if cbt_private.res_hidden(v_tid) then return jsonb_build_object('ok', false, 'error', 'hidden'); end if;
  if p_qidx is null or p_qidx < 0 or p_qidx >= jsonb_array_length(x.data) then
    return jsonb_build_object('ok', false, 'error', 'question');
  end if;
  if (select count(*) from cbt_private.doubts where student_id = v_sid and created_at > now() - interval '1 day') >= 30
     or not cbt_private.rate_ok(v_sid, 'doubt', 20) then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;
  if (select count(*) from cbt_private.doubts where student_id = v_sid and test_id = v_tid and qidx = p_qidx and status = 'open') >= 3 then
    return jsonb_build_object('ok', false, 'error', 'waiting');
  end if;
  v_p := cbt_private.plan_use(v_sid, 'doubt', true); if v_p is not null then return v_p; end if;   -- v91
  v_q := x.data->p_qidx;
  if v_sub = '' then v_sub := cbt_private.doubt_txt(v_q->>'sec', 40); end if;
  insert into cbt_private.doubts (student_id, test_id, series_id, test_title, qidx, qtext, subject, body)
  values (v_sid, v_tid, x.series_id, left(x.title, 300), p_qidx, cbt_private.doubt_txt(v_q->>'q', 400), v_sub, v_body)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.cbt_doubt_ask(text, text, text, text, int, text, text) from public;
grant execute on function public.cbt_doubt_ask(text, text, text, text, int, text, text) to anon, authenticated;

-- ---------- admin: get | enforce {on} | feature_save {key, free, basic, pro, ultra} | grant {mobile, plan, days, note} | revoke {mobile} ----------
create or replace function public.cbt_admin_plan_access(p_pw text, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare e text; d jsonb := coalesce(p_data, '{}'::jsonb); v_sid uuid; v_days int; v_l int[]; k text;
begin
  e := admin_ok(p_pw);
  if e is not null then return jsonb_build_object('ok', false, 'error', e); end if;
  if p_action = 'get' then
    return jsonb_build_object('ok', true, 'v91', true,
      'enforce', coalesce((select enforce from plan_settings where id = 1), false),
      'feats', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'title', title, 'unit', unit, 'period', period,
                 'free', free, 'basic', basic, 'pro', pro, 'ultra', ultra) order by sort) from plan_features), '[]'::jsonb),
      'grants', coalesce((select jsonb_agg(jsonb_build_object('student', coalesce(s.name, ''), 'mobile', s.mobile, 'plan', g.plan,
                 'ends_at', (extract(epoch from g.ends_at) * 1000)::bigint, 'note', g.note, 'live', g.ends_at > now()) order by g.ends_at desc)
                 from plan_grants g join students s on s.id = g.student_id), '[]'::jsonb),
      'counts', (select jsonb_build_object('basic', count(*) filter (where p = 'basic'), 'pro', count(*) filter (where p = 'pro'),
                   'ultra', count(*) filter (where p = 'ultra'), 'free', count(*) filter (where p = 'free'))
                   from (select plan_of(id) p from students) z));
  elsif p_action = 'enforce' then
    -- turning the locks on starts every count from zero (uses while the locks were off do not eat a demo)
    if coalesce((d->>'on')::boolean, false) and not coalesce((select enforce from plan_settings where id = 1), false) then
      delete from plan_usage where true;   -- v94: Supabase refuses a DELETE without WHERE
    end if;
    update plan_settings set enforce = coalesce((d->>'on')::boolean, false) where id = 1;
    perform set_config('cbt.detail', case when coalesce((d->>'on')::boolean, false) then 'locks on' else 'locks off' end, true);
    return jsonb_build_object('ok', true);
  elsif p_action = 'feature_save' then
    k := d->>'key';
    begin
      v_l := array[(d->>'free')::int, (d->>'basic')::int, (d->>'pro')::int, (d->>'ultra')::int];
    exception when others then return jsonb_build_object('ok', false, 'error', 'bad_input'); end;
    if exists (select 1 from unnest(v_l) x where x is null or x < -1 or x > 100000) then
      return jsonb_build_object('ok', false, 'error', 'bad_input');
    end if;
    update plan_features set free = v_l[1], basic = v_l[2], pro = v_l[3], ultra = v_l[4] where key = k;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    perform set_config('cbt.detail', k, true);
    return jsonb_build_object('ok', true);
  elsif p_action in ('grant', 'revoke') then
    select id into v_sid from students where mobile = norm_mobile(d->>'mobile');
    if v_sid is null then return jsonb_build_object('ok', false, 'error', 'no_student'); end if;
    if p_action = 'revoke' then
      delete from plan_grants where student_id = v_sid;
      perform set_config('cbt.detail', 'revoke ' || right(coalesce(d->>'mobile', ''), 4), true);
      return jsonb_build_object('ok', true);
    end if;
    if coalesce(d->>'plan', '') not in ('basic', 'pro', 'ultra') then return jsonb_build_object('ok', false, 'error', 'bad_input'); end if;
    v_days := case when d->>'days' ~ '^\d{1,4}$' then (d->>'days')::int end;
    if v_days is null or v_days not between 1 and 3650 then return jsonb_build_object('ok', false, 'error', 'bad_input'); end if;
    insert into plan_grants (student_id, plan, ends_at, note) values (v_sid, d->>'plan', now() + make_interval(days => v_days), cbt_private.plan_txt(d->>'note', 120))
    on conflict (student_id) do update set plan = excluded.plan, ends_at = excluded.ends_at, note = excluded.note, created_at = now();
    perform set_config('cbt.detail', (d->>'plan') || ' ' || v_days || 'd ' || right(coalesce(d->>'mobile', ''), 4), true);
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'action');
end $$;
revoke all on function public.cbt_admin_plan_access(text, text, jsonb) from public;
grant execute on function public.cbt_admin_plan_access(text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
