-- =====================================================================
--  v94: "DELETE requires a WHERE clause" — the plan locks could not be turned on
--  Supabase blocks a DELETE or UPDATE without WHERE when it comes through the app's API (the pg-safeupdate guard),
--  even inside our own functions. Three places cleared a whole table that way and failed with that message:
--   * Admin → Plans → Access & limits → "Turn locks on": clears the use counts (plan_usage) first, so the switch
--     always failed and the locks stayed Off.
--   * the students' overall rank (cbt_overall): rebuilding the ranking cleared overall_rank, so it could not be rebuilt.
--   * the admin sign-in after 100 wrong passwords in an hour: the pause was never set (fixed in supabase_v35_admin_team.sql).
--  Each now says "where true" (still every row, as before). Nothing else in these functions changes.
--  Where the bodies come from: cbt_admin_plan_access = supabase_v91_plan_access.sql; overall_refresh =
--  supabase_v47_alerts_results.sql (the same line is also fixed in those files, and in older copies).
--  Run in Supabase → SQL Editor after v93, then run supabase_v35_admin_team.sql AGAIN. Safe to run again.
--  Nothing is deleted or added; turning the locks on still starts every count from zero, as v91 says.
-- =====================================================================

-- ---------- overall rank (body from v47; v94: "where true") ----------
create or replace function cbt_private.overall_refresh()
returns void language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare built timestamptz;
begin
  select at into built from rank_built where k = 'overall';
  if built is not null and built > now() - interval '30 seconds' then return; end if;
  if built is null then
    perform pg_advisory_xact_lock(hashtext('cbt_overall_rank'));          -- first time: wait for the one building it
  elsif not pg_try_advisory_xact_lock(hashtext('cbt_overall_rank')) then
    return;                                                              -- someone is building it now: use the current copy
  end if;
  select at into built from rank_built where k = 'overall';
  if built is not null and built > now() - interval '30 seconds' then return; end if;

  perform autosubmit(null, null);   -- expired, auto-saved attempts get their result before ranking

  delete from overall_rank where true;   -- v94: Supabase refuses a DELETE without WHERE
  -- per student and test: the FIRST attempt, if not late and (for held-back tests) after the result time and submitted before it
  insert into overall_rank (student_id, pc, n, rk)
  with b as (select f1.student_id, f1.test_id, f1.score / nullif(f1.max_score,0) * 100 p
             from (select distinct on (rs.student_id, rs.test_id) rs.*, coalesce(tp.result_at, tp.closes_at) ra, coalesce(tp.closes_at, tp.result_at) cut
                   from results rs join tests tp on tp.id = rs.test_id and not tp.practice where rs.test_id is not null
                   order by rs.student_id, rs.test_id, rs.created_at) f1
             where not f1.late and (f1.ra is null or f1.ra <= now_ms())
               and (f1.cut is null or f1.created_at <= to_timestamp((f1.cut + 120000) / 1000.0))
               and not exists (select 1 from public.cbt_cheat_flags f where f.student_id = f1.student_id and f.test_id = f1.test_id::text)),
       s as (select student_id, round(avg(p),1) pc, count(*) n from b group by student_id)
  select s.student_id, s.pc, s.n, rank() over (order by s.pc desc nulls last) from s;

  insert into rank_built (k, at) values ('overall', now()) on conflict (k) do update set at = excluded.at;
end $$;
revoke all on function cbt_private.overall_refresh() from public, anon, authenticated;


-- ---------- (body from v91; v94: "where true") admin: get | enforce {on} | feature_save {key, free, basic, pro, ultra} | grant {mobile, plan, days, note} | revoke {mobile} ----------
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
