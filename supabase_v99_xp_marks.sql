-- =====================================================================
--  v99: One system from both: a level needs BOTH its XP Mark (total XP, v97) AND a Climb-zone finish (weekly league, v98).
--
--  XP Marks (total XP needed to enter a level):
--    L2 Seeker 250 · L3 Scholar 750 · L4 Achiever 1,500 · L5 Ranker 2,500 · L6 Topper 4,000 · L7 Elite 6,000 ·
--    L8 Legend 9,000 · L9 Mastermind 13,000 · L10 Aspiron Doctor 20,000
--  At the end of the week, a student in the Climb zone (top third, 100+ XP that week) goes up one level only if their
--  total XP has reached the next level's XP Mark. If not, they are "Ready to climb": they keep their level, and climb in a
--  later week once the mark is reached. Hold and Drop zones are unchanged. So Dr. needs 20,000 XP AND 9 good weeks.
--
--  Changes: cbt_private.lv_mark(level); league_member gets total_xp; league_close and cbt_league use the marks
--  (zone 'ready' = Climb zone but the XP Mark is not reached yet). Nothing else changes.
--
--  Run ONCE in Supabase → SQL Editor → New query → paste → Run, after v98. Safe to run again. v35 not needed.
-- =====================================================================
do $$ begin
  if to_regclass('cbt_private.league_member') is null then
    raise exception 'Run supabase_v98_leagues.sql first, then this file';
  end if;
end $$;

alter table cbt_private.league_member add column if not exists total_xp int;

-- total XP needed to be at level p (1..10)
create or replace function cbt_private.lv_mark(p int) returns int language sql immutable as $$
  select (array[0, 250, 750, 1500, 2500, 4000, 6000, 9000, 13000, 20000])[greatest(1, least(10, p))]
$$;
revoke all on function cbt_private.lv_mark(int) from public, anon, authenticated;

-- close one finished week: rank every league, set the zones, move levels (climb needs the next XP Mark)
create or replace function cbt_private.league_close(p_week date) returns void
language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare g record; v record; n int; third int; t_end timestamptz := ((p_week + 7)::timestamp at time zone 'Asia/Kolkata');
begin
  for g in select level, grp from league_member where week = p_week and zone is null group by level, grp loop
    update league_member m set final_xp = xp_between(m.student_id, p_week),
           total_xp = (select coalesce(sum(o_xp), 0)::int from xp_rows(m.student_id) where o_at < t_end)
     where m.week = p_week and m.level = g.level and m.grp = g.grp;
    select count(*) into n from league_member where week = p_week and level = g.level and grp = g.grp;
    third := n / 3;
    for v in select m.student_id, row_number() over (order by m.final_xp desc, m.joined_at, m.student_id) rk, m.final_xp fx, m.total_xp tx
               from league_member m where m.week = p_week and m.level = g.level and m.grp = g.grp loop
      update league_member set rank = v.rk,
             zone = case when v.rk <= third and v.fx >= 100 and g.level < 10 then
                           case when v.tx >= lv_mark(g.level + 1) then 'up' else 'ready' end
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

-- ---------- students: my league this week (v98 + XP Marks) ----------
create or replace function public.cbt_league(p_mobile text, p_code text, p_device text)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; wk date := xp_week(); me jsonb; mm league_member%rowtype; n int; third int; L jsonb; hist jsonb; mk int;
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
    mk := lv_mark(mm.level + 1);
    select count(*) into n from league_member where week = wk and level = mm.level and grp = mm.grp;
    third := n / 3;
    select coalesce(jsonb_agg(z.row order by z.rk), '[]'::jsonb) into L from (
      select q.rk, jsonb_build_object('rank', q.rk, 'name', short_name(q.name), 'xp', q.wx, 'me', q.student_id = sid,
               'dr', coalesce(q.best, 1) >= 10, 'series', coalesce(q.series, ''), 'streak', q.alive, 'mark', q.tx >= mk,
               'zone', case when q.rk <= third and q.wx >= 100 and mm.level < 10 then case when q.tx >= mk then 'up' else 'ready' end
                            when q.rk > n - third and mm.level > 1 then 'down' else 'stay' end) row
        from (select m.student_id, s.name, l.best, b.series, coalesce(xp_alive(b), 0) alive, coalesce(b.xp, 0) tx,
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
    'n', coalesce(n, 0), 'third', coalesce(third, 0), 'min_xp', 100, 'next_mark', lv_mark(coalesce(mm.level, (me->>'level')::int) + 1),
    'members', coalesce(L, '[]'::jsonb), 'history', hist,
    'week_start', wk, 'ends_at', (extract(epoch from ((wk + 7)::timestamp at time zone 'Asia/Kolkata')) * 1000)::bigint);
end $$;
revoke all on function public.cbt_league(text, text, text) from public, authenticated;
grant execute on function public.cbt_league(text, text, text) to anon;

notify pgrst, 'reload schema';
