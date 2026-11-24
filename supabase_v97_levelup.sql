-- =====================================================================
--  v97: Aspiron Level Up — XP, daily streak with Streak Shields, levels, awards and ONE leaderboard for every student
--
--  XP is worked out on the server from what the student really did (the phone cannot change it):
--    Tests, per RIGHT answer (cheating-flagged tests give 0, held-back results count once they are shown):
--      • live attempt (submitted while the test is live, on time)        3 XP
--      • first attempt, not live (a day later, a practice test …)          2 XP
--      • re-attempt (the 2nd attempt only, so nobody can farm one test)    1 XP   (3rd and later: 0)
--      • full test bonus: first attempt with 90 % or more questions answered (10+ questions):
--          +20 XP live, +10 XP otherwise
--    Practice, per question answered right (once per question, ever):
--      • PYQ Analyzer, Question bank, Question of the Day                  1 XP
--  Streak: a day counts when the student submits 1 test OR answers 10 practice questions (India time).
--      Every student starts with 1 Streak Shield; every 7 days in a row earns one more (2 at most).
--      Miss ONE day and a shield is used up: the streak stays (it does not grow that day).
--      Miss two days in a row, or one day with no shield, and the streak starts again from 0.
--  Levels, level names, awards and the "Dr." title are worked out on the phone from these numbers (v3.js, LVL3 / AW3),
--  so they can be renamed without SQL.
--
--  New: table cbt_private.xp_board (one row per student, the leaderboard copy), functions
--       cbt_private.xp_calc / xp_save / xp_refresh, and for students public.cbt_xp_me and public.cbt_xp_board.
--  Nothing that exists is changed. Read-only on results / PYQ / question bank / question of the day.
--  The leaderboard copy is brought up to date when someone opens it (at most every 2 minutes, at most 300 students
--  per time), so there is no new scheduled job and no extra cost.
--
--  Run ONCE in Supabase → SQL Editor → New query → paste → Run, after v96 (needs v55 question bank, v88 question of
--  the day and v93 PYQ Analyzer). Safe to run again. v35 does not need to be run again (no admin function).
--  Until it is run the app keeps showing the XP worked out on the phone, and the Leaderboard says "coming soon".
-- =====================================================================
do $$ begin
  if to_regclass('cbt_private.pyq_progress') is null or to_regclass('cbt_private.qotd_ans') is null
     or to_regclass('cbt_private.qb_log') is null then
    raise exception 'Run supabase_v55_qbank.sql, supabase_v88_qotd.sql and supabase_v93_pyq_analyzer.sql first, then this file';
  end if;
end $$;

create table if not exists cbt_private.xp_board (
  student_id  uuid primary key references cbt_private.students(id) on delete cascade,
  xp          int  not null default 0,
  week_xp     int  not null default 0,
  week_start  date,
  tests       int  not null default 0,   -- tests taken (first attempts, results shown)
  live        int  not null default 0,   -- of them live
  full_tests  int  not null default 0,   -- of them full (90 %+ answered)
  correct     int  not null default 0,   -- right answers in tests (all attempts that gave XP)
  attempted   int  not null default 0,   -- questions answered in tests (first attempts)
  practice    int  not null default 0,   -- practice questions answered right (PYQ + question bank + question of the day)
  acc90       int  not null default 0,   -- first attempts with 90 %+ accuracy (30+ answered)
  streak      int  not null default 0,
  best_streak int  not null default 0,
  shields     int  not null default 0,
  last_day    date,                      -- last active day (India time)
  series      text not null default '',  -- the test series the student takes most tests in
  at          timestamptz not null default now()
);
create index if not exists xp_board_xp on cbt_private.xp_board (xp desc);
create index if not exists xp_board_week on cbt_private.xp_board (week_start, week_xp desc);
alter table cbt_private.xp_board enable row level security;
revoke all on cbt_private.xp_board from public, anon, authenticated;

-- India day and the Monday of this week
create or replace function cbt_private.xp_today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;
create or replace function cbt_private.xp_week() returns date language sql stable as $$
  select cbt_private.xp_today() - (extract(isodow from cbt_private.xp_today())::int - 1)
$$;
revoke all on function cbt_private.xp_today(), cbt_private.xp_week() from public, anon, authenticated;

-- ---------- everything about one student ----------
create or replace function cbt_private.xp_calc(p_sid uuid) returns jsonb
language plpgsql stable security definer set search_path = cbt_private, pg_temp as $$
declare
  t_now bigint := now_ms(); today date := xp_today(); wk date := xp_week();
  wk_ts timestamptz := (xp_week()::timestamp at time zone 'Asia/Kolkata');
  x_live int; x_first int; x_re int; x_bonus int; x_wk int;
  n_tests int; n_live int; n_full int; n_cor int; n_att int; n_acc int;
  p_all int; p_wk int; p_today int; t_today int;
  days date[]; d date; i int := 1; st int := 0; best int := 0; sh int := 1; miss int := 0; stt text;
  wkd text[] := '{}'; v_series text;
begin
  with r as (
    select rs.created_at, rs.late, coalesce(rs.correct, 0) c, coalesce(rs.wrong, 0) w, coalesce(rs.skipped, 0) sk,
           t.practice, t.opens_at, t.closes_at,
           row_number() over (partition by rs.test_id order by rs.created_at, rs.id) n,
           (extract(epoch from rs.created_at) * 1000)::bigint ms
      from results rs join tests t on t.id = rs.test_id
     where rs.student_id = p_sid
       and coalesce(t.result_at, t.closes_at, 0) <= t_now
       and not exists (select 1 from public.cbt_cheat_flags f where f.student_id = p_sid and f.test_id = rs.test_id::text)
  ), s as (
    select r.*, (r.n = 1 and not r.practice and r.closes_at is not null and not r.late
                 and r.ms <= r.closes_at and r.ms >= coalesce(r.opens_at, 0)) lv
      from r
  ), g as (
    select s.*,
           case when lv then 3 * c when n = 1 then 2 * c when n = 2 then c else 0 end base,
           case when n = 1 and (c + w + sk) >= 10 and (c + w) >= 0.9 * (c + w + sk) then case when lv then 20 else 10 end else 0 end bonus
      from s
  )
  select coalesce(sum(base) filter (where lv), 0), coalesce(sum(base) filter (where n = 1 and not lv), 0),
         coalesce(sum(base) filter (where n = 2), 0), coalesce(sum(bonus), 0),
         coalesce(sum(base + bonus) filter (where created_at >= wk_ts), 0),
         count(*) filter (where n = 1), count(*) filter (where lv), count(*) filter (where n = 1 and bonus > 0),
         coalesce(sum(c) filter (where n <= 2), 0), coalesce(sum(c + w) filter (where n = 1), 0),
         count(*) filter (where n = 1 and (c + w) >= 30 and c >= 0.9 * (c + w))
    into x_live, x_first, x_re, x_bonus, x_wk, n_tests, n_live, n_full, n_cor, n_att, n_acc
    from g;

  -- practice: one row per question in each table; right = XP once
  with q as (select rights > 0 ok, at from pyq_progress where student_id = p_sid
             union all select ok, at from qb_log where student_id = p_sid
             union all select ok, at from qotd_ans where student_id = p_sid)
  select count(*) filter (where ok), count(*) filter (where ok and at >= wk_ts),
         count(*) filter (where (at at time zone 'Asia/Kolkata')::date = today)
    into p_all, p_wk, p_today from q;
  select count(*) into t_today from results where student_id = p_sid and (created_at at time zone 'Asia/Kolkata')::date = today;

  -- active days: a test submitted, or 10 practice questions answered
  select array_agg(z.d order by z.d) into days from (
    select (created_at at time zone 'Asia/Kolkata')::date d from results where student_id = p_sid
    union
    select y.d from (select (at at time zone 'Asia/Kolkata')::date d from (
              select at from pyq_progress where student_id = p_sid
              union all select at from qb_log where student_id = p_sid
              union all select at from qotd_ans where student_id = p_sid) x) y
     group by y.d having count(*) >= 10) z;

  -- walk day by day from the first active day: streak, shields, and this week's 7 days
  d := coalesce(days[1], today);
  if d > wk then for k in 0 .. (d - wk - 1) loop wkd := wkd || 'none'::text; end loop; end if;
  while d <= today loop
    if days is not null and i <= cardinality(days) and days[i] = d then
      i := i + 1; st := st + 1; miss := 0; stt := 'done';
      if st % 7 = 0 and sh < 2 then sh := sh + 1; end if;
      best := greatest(best, st);
    elsif d < today then
      miss := miss + 1;
      if st > 0 and miss = 1 and sh > 0 then sh := sh - 1; stt := 'shield';
      else stt := case when st > 0 then 'broke' else 'miss' end; st := 0;
      end if;
    else
      stt := 'today';
    end if;
    if d >= wk then wkd := wkd || stt; end if;
    d := d + 1;
  end loop;
  while cardinality(wkd) < 7 loop wkd := wkd || 'next'::text; end loop;

  select sr.title into v_series from results rs join tests t on t.id = rs.test_id join series sr on sr.id = t.series_id
   where rs.student_id = p_sid group by sr.id, sr.title order by count(*) desc, max(rs.created_at) desc limit 1;
  if v_series is null then
    select sr.title into v_series from series_access ac join series sr on sr.id = ac.series_id
     where ac.student_id = p_sid order by sr.sort_order limit 1;
  end if;

  return jsonb_build_object('ok', true,
    'xp', x_live + x_first + x_re + x_bonus + p_all, 'week_xp', x_wk + p_wk,
    'parts', jsonb_build_object('live', x_live, 'first', x_first, 're', x_re, 'bonus', x_bonus, 'practice', p_all),
    'tests', n_tests, 'live', n_live, 'full', n_full, 'correct', n_cor, 'attempted', n_att, 'practice', p_all, 'acc90', n_acc,
    'streak', st, 'best_streak', best, 'shields', sh, 'last_day', days[cardinality(days)],
    'today', jsonb_build_object('tests', t_today, 'qs', p_today, 'done', today = any(coalesce(days, '{}'))),
    'week', to_jsonb(wkd), 'series', coalesce(v_series, ''), 'day', today);
end $$;
revoke all on function cbt_private.xp_calc(uuid) from public, anon, authenticated;

-- work out one student and keep the leaderboard copy
create or replace function cbt_private.xp_save(p_sid uuid) returns jsonb
language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare j jsonb := xp_calc(p_sid);
begin
  insert into xp_board as b (student_id, xp, week_xp, week_start, tests, live, full_tests, correct, attempted, practice, acc90,
                             streak, best_streak, shields, last_day, series, at)
  values (p_sid, (j->>'xp')::int, (j->>'week_xp')::int, xp_week(), (j->>'tests')::int, (j->>'live')::int, (j->>'full')::int,
          (j->>'correct')::int, (j->>'attempted')::int, (j->>'practice')::int, (j->>'acc90')::int, (j->>'streak')::int,
          (j->>'best_streak')::int, (j->>'shields')::int, (j->>'last_day')::date, left(j->>'series', 200), now())
  on conflict (student_id) do update set xp = excluded.xp, week_xp = excluded.week_xp, week_start = excluded.week_start,
    tests = excluded.tests, live = excluded.live, full_tests = excluded.full_tests, correct = excluded.correct,
    attempted = excluded.attempted, practice = excluded.practice, acc90 = excluded.acc90, streak = excluded.streak,
    best_streak = excluded.best_streak, shields = excluded.shields, last_day = excluded.last_day, series = excluded.series, at = now();
  return j;
end $$;
revoke all on function cbt_private.xp_save(uuid) from public, anon, authenticated;

-- bring the leaderboard copy up to date: students with something new since their row was made (at most every 2 minutes,
-- 300 students per time; the rest follow on the next opening)
create or replace function cbt_private.xp_refresh() returns void
language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare t_now bigint := now_ms(); last bigint; v record;
begin
  if not pg_try_advisory_xact_lock(hashtext('cbt_xp_refresh')) then return; end if;
  select value::bigint into last from settings where key = 'xp_refresh_at';
  if last is not null and t_now - last < 120000 then return; end if;
  insert into settings (key, value) values ('xp_refresh_at', t_now::text)
  on conflict (key) do update set value = excluded.value;
  for v in
    select s.id from students s left join xp_board b on b.student_id = s.id
     where s.status = 'approved' and (
       exists (select 1 from results rs where rs.student_id = s.id and (b.at is null or rs.created_at > b.at))
       or exists (select 1 from pyq_progress p where p.student_id = s.id and (b.at is null or p.at > b.at))
       or exists (select 1 from qb_log p where p.student_id = s.id and (b.at is null or p.at > b.at))
       or exists (select 1 from qotd_ans p where p.student_id = s.id and (b.at is null or p.at > b.at))
       -- a held-back live result that has come out since
       or (b.at is not null and exists (select 1 from results rs join tests t on t.id = rs.test_id where rs.student_id = s.id
             and coalesce(t.result_at, t.closes_at) > (extract(epoch from b.at) * 1000)::bigint and coalesce(t.result_at, t.closes_at) <= t_now)))
     limit 300
  loop
    perform xp_save(v.id);
  end loop;
end $$;
revoke all on function cbt_private.xp_refresh() from public, anon, authenticated;

-- the streak a leaderboard row shows today: alive if active yesterday or today, or one day missed with a shield left
create or replace function cbt_private.xp_alive(b cbt_private.xp_board) returns int language sql stable as $$
  select case when b.last_day is null then 0
              when b.last_day >= cbt_private.xp_today() - 1 then b.streak
              when b.last_day = cbt_private.xp_today() - 2 and b.shields > 0 then b.streak
              else 0 end
$$;
revoke all on function cbt_private.xp_alive(cbt_private.xp_board) from public, anon, authenticated;

-- ---------- students: my XP, streak and my place ----------
create or replace function public.cbt_xp_me(p_mobile text, p_code text, p_device text)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; j jsonb; wk date := xp_week(); r_all int; r_wk int; n_all int; n_wk int;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  if not rate_ok(sid, 'xpme', 240) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  j := xp_save(sid);
  select count(*) filter (where b.xp > 0), count(*) filter (where b.week_start = wk and b.week_xp > 0),
         1 + count(*) filter (where b.xp > (j->>'xp')::int),
         1 + count(*) filter (where b.week_start = wk and b.week_xp > (j->>'week_xp')::int)
    into n_all, n_wk, r_all, r_wk
    from xp_board b join students s on s.id = b.student_id where s.status = 'approved';
  return j || jsonb_build_object('rank_all', case when (j->>'xp')::int > 0 then r_all end, 'total_all', n_all,
                                 'rank_week', case when (j->>'week_xp')::int > 0 then r_wk end, 'total_week', n_wk);
end $$;
revoke all on function public.cbt_xp_me(text, text, text) from public, authenticated;
grant execute on function public.cbt_xp_me(text, text, text) to anon;

-- ---------- students: the leaderboard of every student of every test series ----------
--   p_period 'week' (XP earned since Monday, India time) or 'all' (all-time XP). Top 50 + my own row.
create or replace function public.cbt_xp_board(p_mobile text, p_code text, p_device text, p_period text default 'week')
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; me jsonb; wk date := xp_week(); per text; top jsonb; my jsonb; total int;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  if not rate_ok(sid, 'xpboard', 120) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  per := case when p_period = 'all' then 'all' else 'week' end;
  perform xp_refresh();
  me := xp_save(sid);

  select count(*), coalesce(jsonb_agg(q.row order by q.rk) filter (where q.rk <= 50), '[]'::jsonb),
         (array_agg(q.row) filter (where q.student_id = sid))[1]
    into total, top, my
    from (select z.student_id, z.rk, jsonb_build_object('name', short_name(z.name), 'pts', z.pts, 'xp', z.xp, 'rank', z.rk,
                   'me', z.student_id = sid, 'series', z.series, 'tests', z.tests, 'live', z.live, 'full', z.full_tests,
                   'correct', z.correct, 'attempted', z.attempted, 'practice', z.practice, 'acc90', z.acc90,
                   'streak', z.alive, 'best_streak', z.best_streak) row
            from (select b.*, s.name, xp_alive(b) alive, y.pts,
                         row_number() over (order by y.pts desc, b.xp desc, b.best_streak desc, b.at asc, b.student_id) rk
                    from xp_board b join students s on s.id = b.student_id
                    cross join lateral (select case when per = 'all' then b.xp when b.week_start = wk then b.week_xp else 0 end pts) y
                   where s.status = 'approved' and y.pts > 0) z) q;
  return jsonb_build_object('ok', true, 'period', per, 'total', total, 'top', top, 'mine', my, 'me', me,
                            'week_start', wk, 'week_end', wk + 6);
end $$;
revoke all on function public.cbt_xp_board(text, text, text, text) from public, authenticated;
grant execute on function public.cbt_xp_board(text, text, text, text) to anon;

notify pgrst, 'reload schema';
