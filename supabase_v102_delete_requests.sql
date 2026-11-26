-- =====================================================================
--  v102: the owner's side of "Account deletion" (needs v101)
--
--  A student's deletion request (v101) now shows in Admin → Students & accounts → Deletion requests.
--  The owner (or a team member with Full access to Students) can, for each request:
--    • Delete now  : deletes the student and everything tied to the student (results, XP, notes, doubts, devices …,
--                    the same as Students → Delete). The request is marked "done" and its name and number are cleared
--                    (only the last 4 digits stay, so you can show you handled it).
--    • Reject      : the request is closed, the student keeps the account and the app goes back to normal.
--  The student's app shows a 24-hour countdown. Nothing is deleted by itself when it ends; the request
--  turns red ("overdue") in the admin page and in the dashboard's "needs attention" list, until you handle it.
--  What stays: store orders / payment records (kept for your accounts; they are not shown to anyone else) and the
--  Supabase login (email / Google) of the student, which only the Supabase dashboard (Authentication → Users) can remove.
--
--  Run ONCE in Supabase → SQL Editor (after v101), then run supabase_v35_admin_team.sql again. Safe to run again.
-- =====================================================================
do $$ begin
  if to_regclass('cbt_private.delete_requests') is null then
    raise exception 'Run supabase_v101_orders_delete.sql first, then this file';
  end if;
end $$;

-- admin: get {} | delete {id} | reject {id}
create or replace function public.cbt_admin_delreq(p_pw text, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare e text; d jsonb := coalesce(p_data, '{}'::jsonb); v_id uuid; r delete_requests%rowtype; v_last text;
begin
  e := admin_ok(p_pw);
  if e is not null then return jsonb_build_object('ok', false, 'error', e); end if;
  if p_action = 'get' then
    return jsonb_build_object('ok', true, 'v102', true, 'now', (extract(epoch from now()) * 1000)::bigint,
      'pending', (select count(*) from delete_requests where status = 'pending'),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'mobile', x.mobile, 'reason', x.reason,
          'status', x.status, 'alive', exists (select 1 from students s where s.id = x.student_id),
          'at', (extract(epoch from x.created_at) * 1000)::bigint,
          'closed', (extract(epoch from x.closed_at) * 1000)::bigint)
          order by case when x.status = 'pending' then 0 else 1 end, x.created_at desc)
        from (select * from delete_requests order by created_at desc limit 200) x), '[]'::jsonb));
  end if;
  begin v_id := (d->>'id')::uuid; exception when others then return jsonb_build_object('ok', false, 'error', 'not_found'); end;
  select * into r from delete_requests where id = v_id for update;
  if not found or r.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_last := right(regexp_replace(coalesce(r.mobile, ''), '\D', '', 'g'), 4);
  if p_action = 'delete' then
    delete from students where id = r.student_id;
    update delete_requests set status = 'done', closed_at = now(), name = '', reason = '', mobile = '******' || v_last where id = v_id;
    perform set_config('cbt.detail', 'deleted the account ending ' || v_last, true);
    return jsonb_build_object('ok', true);
  elsif p_action = 'reject' then
    update delete_requests set status = 'rejected', closed_at = now() where id = v_id;
    perform set_config('cbt.detail', 'kept the account ending ' || v_last, true);
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'action');
end $$;
revoke all on function public.cbt_admin_delreq(text, text, jsonb) from public, authenticated;
grant execute on function public.cbt_admin_delreq(text, text, jsonb) to anon;

notify pgrst, 'reload schema';
