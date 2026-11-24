-- =====================================================================
--  v98: Weekly leagues. The level now goes up only by finishing high in your league, not by total XP.
--
--  • Every week (Monday 00:00 to Sunday 23:59, India time) students are put in leagues of up to 45 at their own
--    level, whatever test series they take. A student joins this week's league the first time they earn XP in the week.
--  • When the week ends, each league is ranked by the XP earned in that week:
--      top third (15 of 45)    CLIMB zone → next week one level up (needs at least 100 XP that week)
--      middle third            HOLD zone  → same level
--      bottom third (15 of 45) DROP zone  → one level down
--    Level 1 has no drop zone; level 10 (Aspiron Doctor) has no climb zone. A small league uses thirds of its size,
--    so a student alone in a league cannot climb (a third of 1 is 0).
--  • So nobody can reach level 10 in one go: it takes at least 9 good weeks. "Dr." is kept for good once level 10 is
--    reached (best level 10), even if the student later drops a level.
--  • Students who earn no XP in a week are not in that week's league and keep their level.
--  • The week is closed the first time anyone opens the app after it ends (no scheduled job, no extra cost).
--
--  New: tables cbt_private.league_level, cbt_private.league_member; functions cbt_private.xp_rows / xp_between /
--  league_join / league_close / league_tick; public.cbt_league (my league this week). cbt_xp_me and cbt_xp_board
--  now also give the level and the Dr. title; xp_save puts the student in this week's league.
--
--  Run ONCE in Supabase → SQL Editor → New query → paste → Run, after v97. Safe to run again. v35 not needed.
-- =====================================================================
do $$ begin
  if to_regclass('cbt_private.xp_board') is null then
    raise exception 'Run supabase_v97_levelup.sql first, then this file';
  end if;
end $$;

create table if not exists cbt_private.league_level (
  student_id uuid primary key references cbt_private.students(id) on delete cascade,
  level      int  not null default 1 check (level between 1 and 10),
  best       int  not null default 1 check (best between 1 and 10),
  promos     int  not null default 0,     -- weeks finished in the climb zone
  top3       int  not null default 0,     -- weeks finished 1st-3rd in a league of 5 or more
  wins       int  not null default 0,     -- weeks finished 1st in a league of 5 or more
  weeks      int  not null default 0,     -- weeks played
  last_week  date,
  last_zone  text,
  last_rank  int,
  last_n     int,
  last_xp    int,
  last_from  int,
  updated_at timestamptz not null default now()
);
alter table cbt_private.league_level enable row level security;
revoke all on cbt_private.league_level from public, anon, authenticated;

create table if not exists cbt_private.league_member (
  week       date not null,
  student_id uuid not null references cbt_private.students(id) on delete cascade,
  level      int  not null,
  grp        int  not null,
  joined_at  timestamptz not null default now(),
  final_xp   int,
  rank       int,
  zone       text,                        -- up | stay | down, set when the week is closed
  primary key (week, student_id)
);
create index if not exists league_member_grp on cbt_private.league_member (week, level, grp);
create index if not exists league_member_sid on cbt_private.league_member (student_id, week desc);
alter table cbt_private.league_member enable row level security;
revoke all on cbt_private.league_member from public, anon, authenticated;

-- the XP of each piece of work with its time (same rules as xp_calc, v97)
create or replace function cbt_private.xp_rows(p_sid uuid)
returns table(o_at timestamptz, o_xp int)
language sql stable security definer set search_path = cbt_private, pg_temp as $$
  with r as (
    select rs.created_at, rs.late, coalesce(rs.correct, 0) c, coalesce(rs.wrong, 0) w, coalesce(rs.skipped, 0) sk,
           t.practice, t.opens_at, t.closes_at,
           row_number() over (partition by rs.test_id order by rs.created_at, rs.id) n,
           (extract(epoch from rs.created_at) * 1000)::bigint ms
      from results rs join tests t on t.id = rs.test_id
     where rs.student_id = p_sid
       and coalesce(t.result_at, t.closes_at, 0) <= now_ms()
       and not exists (select 1 from public.cbt_cheat_flags f where f.student_id = p_sid and f.test_id = rs.test_id::text)
  ), s as (
    select r.*, (r.n = 1 and not r.practice and r.closes_at is not null and not r.late
                 and r.ms <= r.closes_at and r.ms >= coalesce(r.opens_at, 0)) lv from r
  )
  select created_at,
         (case when lv then 3 * c when n = 1 then 2 * c when n = 2 then c else 0 end
          + case when n = 1 and (c + w + sk) >= 10 and (c + w) >= 0.9 * (c + w + sk) then case when lv then 20 else 10 end else 0 end)::int
    from s
  union all select at, 1 from pyq_progress where student_id = p_sid and rights > 0
  union all select at, 1 from qb_log where student_id = p_sid and ok
  union all select at, 1 from qotd_ans where student_id = p_sid and ok
$$;
revoke all on function cbt_private.xp_rows(uuid) from public, anon, authenticated;

-- XP earned in the week that starts on p_week (Monday, India time)
create or replace function cbt_private.xp_between(p_sid uuid, p_week date) returns int
language sql stable security definer set search_path = cbt_private, pg_temp as $$
  select coalesce(sum(o_xp), 0)::int from xp_rows(p_sid)
   where o_at >= (p_week::timestamp at time zone 'Asia/Kolkata') and o_at < ((p_week + 7)::timestamp at time zone 'Asia/Kolkata')
$$;
revoke all on function cbt_private.xp_between(uuid, date) from public, anon, authenticated;

-- put the student in this week's league at their level: the first league of that level with room, else a new one
create or replace function cbt_private.league_join(p_sid uuid) returns void
language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare wk date := xp_week(); lv int; g int;
begin
  if exists (select 1 from league_member where week = wk and student_id = p_sid) then return; end if;
  insert into league_level (student_id) values (p_sid) on conflict do nothing;
  select level into lv from league_level where student_id = p_sid;
  perform pg_advisory_xact_lock(hashtext('cbt_league_' || wk || '_' || lv));
  if exists (select 1 from league_member where week = wk and student_id = p_sid) then return; end if;
  select m.grp into g from league_member m where m.week = wk and m.level = lv group by m.grp having count(*) < 45 order by m.grp limit 1;
  if g is null then select coalesce(max(m.grp), 0) + 1 into g from league_member m where m.week = wk and m.level = lv; end if;
  insert into league_member (week, student_id, level, grp) values (wk, p_sid, lv, g) on conflict do nothing;
end $$;
revoke all on function cbt_private.league_join(uuid) from public, anon, authenticated;

-- close one finished week: rank every league, set the zones, move levels up or down
create or replace function cbt_private.league_close(p_week date) returns void
language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare g record; v record; n int; third int;
begin
  for g in select level, grp from league_member where week = p_week and zone is null group by level, grp loop
    update league_member m set final_xp = xp_between(m.student_id, p_week) where m.week = p_week and m.level = g.level and m.grp = g.grp;
    select count(*) into n from league_member where week = p_week and level = g.level and grp = g.grp;
    third := n / 3;
    for v in select m.student_id, row_number() over (order by m.final_xp desc, m.joined_at, m.student_id) rk, m.final_xp fx
               from league_member m where m.week = p_week and m.level = g.level and m.grp = g.grp loop
      update league_member set rank = v.rk,
             zone = case when v.rk <= third and v.fx >= 100 and g.level < 10 then 'up'
                         when v.rk > n - third and g.level > 1 then 'down' else 'stay' end
       where week = p_week and student_id = v.student_id;
    end loop;
    update league_level l set
        last_from = l.level,
        level = case m.zone when 'up' then least(10, l.level + 1) when 'down' then greatest(1, l.level - 1) else l.level end,
        best = greatest(l.best, case m.zone when 'up' then least(10, l.level + 1) else l.level end),
        promos = l.promos + case when m.zone = 'up' then 1 else 0 end,
        top3 = l.top3 + case when n >= 5 and m.rank <= 3 and m.final_xp >= 100 then 1 else 0 end,
        wins = l.wins + case when n >= 5 and m.rank = 1 and m.final_xp >= 100 then 1 else 0 end,
        weeks = l.weeks + 1, last_week = p_week, last_zone = m.zone, last_rank = m.rank, last_n = n, last_xp = m.final_xp,
        updated_at = now()
      from league_member m
     where m.week = p_week and m.level = g.level and m.grp = g.grp and l.student_id = m.student_id;
  end loop;
end $$;
revoke all on function cbt_private.league_close(date) from public, anon, authenticated;

-- close every week that has ended and is not closed yet (once; others skip while it runs)
create or replace function cbt_private.league_tick() returns void
language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare w date;
begin
  if not exists (select 1 from league_member where week < xp_week() and zone is null) then return; end if;
  if not pg_try_advisory_xact_lock(hashtext('cbt_league_tick')) then return; end if;
  for w in select distinct week from league_member where week < xp_week() and zone is null order by week loop
    perform league_close(w);
  end loop;
end $$;
revoke all on function cbt_private.league_tick() from public, anon, authenticated;

-- v97 xp_save, now also: the student joins this week's league once they have XP this week
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
  if (j->>'week_xp')::int > 0 then perform league_join(p_sid); end if;
  return j;
end $$;
revoke all on function cbt_private.xp_save(uuid) from public, anon, authenticated;

-- level, title and league counts of one student, for the app
create or replace function cbt_private.league_me(p_sid uuid) returns jsonb
language sql stable security definer set search_path = cbt_private, pg_temp as $$
  select jsonb_build_object('level', coalesce(l.level, 1), 'best', coalesce(l.best, 1), 'dr', coalesce(l.best, 1) >= 10,
    'promos', coalesce(l.promos, 0), 'top3', coalesce(l.top3, 0), 'wins', coalesce(l.wins, 0), 'weeks', coalesce(l.weeks, 0),
    'last', case when l.last_week is null then null else jsonb_build_object('week', l.last_week, 'zone', l.last_zone, 'rank', l.last_rank,
              'n', l.last_n, 'xp', l.last_xp, 'from', l.last_from, 'to', l.level) end)
    from (select 1) x left join league_level l on l.student_id = p_sid
$$;
revoke all on function cbt_private.league_me(uuid) from public, anon, authenticated;

-- ---------- students: my XP, streak, level (v97 + v98) ----------
create or replace function public.cbt_xp_me(p_mobile text, p_code text, p_device text)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; j jsonb; wk date := xp_week(); r_all int; r_wk int; n_all int; n_wk int;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  if not rate_ok(sid, 'xpme', 240) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  perform league_tick();
  j := xp_save(sid);
  select count(*) filter (where b.xp > 0), count(*) filter (where b.week_start = wk and b.week_xp > 0),
         1 + count(*) filter (where b.xp > (j->>'xp')::int),
         1 + count(*) filter (where b.week_start = wk and b.week_xp > (j->>'week_xp')::int)
    into n_all, n_wk, r_all, r_wk
    from xp_board b join students s on s.id = b.student_id where s.status = 'approved';
  return j || league_me(sid) || jsonb_build_object('rank_all', case when (j->>'xp')::int > 0 then r_all end, 'total_all', n_all,
                                 'rank_week', case when (j->>'week_xp')::int > 0 then r_wk end, 'total_week', n_wk);
end $$;
revoke all on function public.cbt_xp_me(text, text, text) from public, authenticated;
grant execute on function public.cbt_xp_me(text, text, text) to anon;

-- ---------- students: my league this week ----------
create or replace function public.cbt_league(p_mobile text, p_code text, p_device text)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; wk date := xp_week(); me jsonb; mm league_member%rowtype; n int; third int; L jsonb; hist jsonb;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  if not rate_ok(sid, 'league', 240) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  perform league_tick();
  perform xp_refresh();
  me := xp_save(sid) || league_me(sid);
  select * into mm from league_member where week = wk and student_id = sid;
  if found then
    select count(*) into n from league_member where week = wk and level = mm.level and grp = mm.grp;
    third := n / 3;
    select coalesce(jsonb_agg(z.row order by z.rk), '[]'::jsonb) into L from (
      select q.rk, jsonb_build_object('rank', q.rk, 'name', short_name(q.name), 'xp', q.wx, 'me', q.student_id = sid,
               'dr', coalesce(q.best, 1) >= 10, 'series', coalesce(q.series, ''), 'streak', q.alive,
               'zone', case when q.rk <= third and q.wx >= 100 and mm.level < 10 then 'up'
                            when q.rk > n - third and mm.level > 1 then 'down' else 'stay' end) row
        from (select m.student_id, s.name, l.best, b.series, coalesce(xp_alive(b), 0) alive,
                     case when b.week_start = wk then b.week_xp else 0 end wx,
                     row_number() over (order by case when b.week_start = wk then b.week_xp else 0 end desc, m.joined_at, m.student_id) rk
                from league_member m join students s on s.id = m.student_id
                left join xp_board b on b.student_id = m.student_id
                left join league_level l on l.student_id = m.student_id
               where m.week = wk and m.level = mm.level and m.grp = mm.grp) q) z;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('week', h.week, 'level', h.level, 'rank', h.rank, 'zone', h.zone, 'xp', h.final_xp) order by h.week desc), '[]'::jsonb)
    into hist from (select * from league_member where student_id = sid and zone is not null order by week desc limit 12) h;
  return jsonb_build_object('ok', true, 'me', me, 'in', mm.week is not null, 'level', coalesce(mm.level, (me->>'level')::int),
    'n', coalesce(n, 0), 'third', coalesce(third, 0), 'min_xp', 100, 'members', coalesce(L, '[]'::jsonb), 'history', hist,
    'week_start', wk, 'ends_at', (extract(epoch from ((wk + 7)::timestamp at time zone 'Asia/Kolkata')) * 1000)::bigint);
end $$;
revoke all on function public.cbt_league(text, text, text) from public, authenticated;
grant execute on function public.cbt_league(text, text, text) to anon;

-- ---------- students: all students by all-time XP (v97), now with level and Dr. title ----------
create or replace function public.cbt_xp_board(p_mobile text, p_code text, p_device text, p_period text default 'week')
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; me jsonb; wk date := xp_week(); per text; top jsonb; my jsonb; total int;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  if not rate_ok(sid, 'xpboard', 120) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  per := case when p_period = 'all' then 'all' else 'week' end;
  perform league_tick();
  perform xp_refresh();
  me := xp_save(sid) || league_me(sid);
  select count(*), coalesce(jsonb_agg(q.row order by q.rk) filter (where q.rk <= 50), '[]'::jsonb),
         (array_agg(q.row) filter (where q.student_id = sid))[1]
    into total, top, my
    from (select z.student_id, z.rk, jsonb_build_object('name', short_name(z.name), 'pts', z.pts, 'xp', z.xp, 'rank', z.rk,
                   'me', z.student_id = sid, 'series', z.series, 'tests', z.tests, 'live', z.live, 'full', z.full_tests,
                   'correct', z.correct, 'attempted', z.attempted, 'practice', z.practice, 'acc90', z.acc90,
                   'streak', z.alive, 'best_streak', z.best_streak, 'level', z.lv, 'dr', z.lbest >= 10,
                   'promos', z.promos, 'top3', z.top3, 'wins', z.wins) row
            from (select b.*, s.name, xp_alive(b) alive, y.pts, coalesce(l.level, 1) lv, coalesce(l.best, 1) lbest,
                         coalesce(l.promos, 0) promos, coalesce(l.top3, 0) top3, coalesce(l.wins, 0) wins,
                         row_number() over (order by y.pts desc, b.xp desc, b.best_streak desc, b.at asc, b.student_id) rk
                    from xp_board b join students s on s.id = b.student_id
                    left join league_level l on l.student_id = b.student_id
                    cross join lateral (select case when per = 'all' then b.xp when b.week_start = wk then b.week_xp else 0 end pts) y
                   where s.status = 'approved' and y.pts > 0) z) q;
  return jsonb_build_object('ok', true, 'period', per, 'total', total, 'top', top, 'mine', my, 'me', me,
                            'week_start', wk, 'week_end', wk + 6);
end $$;
revoke all on function public.cbt_xp_board(text, text, text, text) from public, authenticated;
grant execute on function public.cbt_xp_board(text, text, text, text) to anon;

notify pgrst, 'reload schema';
