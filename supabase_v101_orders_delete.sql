-- =====================================================================
--  v101: My purchases (receipts) and Account deletion request, for the student app
--
--  public.cbt_my_orders(mobile, code, device)   the student's own PAID store orders (for My purchases + receipt), and
--                                               whether a deletion request is open
--  public.cbt_delete_request(mobile, code, device, reason)   the student asks us to delete the account and data
--  public.cbt_delete_cancel(mobile, code, device)             the student withdraws that request
--
--  A deletion is a REQUEST: nothing is deleted by the app. Requests are listed in cbt_private.delete_requests
--  (Supabase → Table editor, schema cbt_private). After you have checked one, delete the student in
--  Admin → Students as usual and set the request's status to 'done'.
--  Nothing that exists is changed. No scheduled job, no extra cost.
--
--  Run ONCE in Supabase → SQL Editor → New query → paste → Run (after v100). Safe to run again.
--  v35 does not need to be run again. Until it is run, the app shows "My purchases" as empty and the deletion
--  request says "try again later".
-- =====================================================================
create table if not exists cbt_private.delete_requests (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null,
  mobile      text not null default '',
  name        text not null default '',
  reason      text not null default '',
  status      text not null default 'pending',   -- pending | cancelled | done
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create unique index if not exists delete_requests_one_open on cbt_private.delete_requests (student_id) where status = 'pending';
alter table cbt_private.delete_requests enable row level security;
revoke all on cbt_private.delete_requests from public, anon, authenticated;

create or replace function public.cbt_my_orders(p_mobile text, p_code text, p_device text)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; v_m text; v_nm text;
begin
  a := auth(p_mobile, p_code, p_device);
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;
  sid := (a->>'id')::uuid;
  select s.mobile, s.name into v_m, v_nm from students s where s.id = sid;
  return jsonb_build_object('ok', true, 'v101', true, 'name', v_nm,
    'orders', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'title', x.item_title, 'amount', x.amount,
        'list', coalesce(x.list_price, x.amount + x.coupon_off + x.wallet_used), 'coupon', coalesce(x.coupon_code, ''), 'off', x.coupon_off,
        'wallet', x.wallet_used, 'at', (extract(epoch from coalesce(x.paid_at, x.created_at)) * 1000)::bigint) order by x.created_at desc)
      from (select o.* from public.cbt_store_orders o where o.mobile = right(v_m, 10) and o.status = 'paid'
             order by o.created_at desc limit 100) x), '[]'::jsonb),
    'delete_at', (select (extract(epoch from d.created_at) * 1000)::bigint from delete_requests d where d.student_id = sid and d.status = 'pending'));
end $$;
revoke all on function public.cbt_my_orders(text, text, text) from public, authenticated;
grant execute on function public.cbt_my_orders(text, text, text) to anon;

create or replace function public.cbt_delete_request(p_mobile text, p_code text, p_device text, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; s students%rowtype;
begin
  a := auth(p_mobile, p_code, p_device);
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;
  sid := (a->>'id')::uuid;
  if not rate_ok(sid, 'delreq', 5) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  select * into s from students where id = sid;
  insert into delete_requests (student_id, mobile, name, reason)
  values (sid, s.mobile, left(coalesce(s.name, ''), 80), left(btrim(regexp_replace(coalesce(p_reason, ''), '[<>"`\r\n\t]', '', 'g')), 300))
  on conflict (student_id) where status = 'pending' do nothing;
  return jsonb_build_object('ok', true,
    'delete_at', (select (extract(epoch from d.created_at) * 1000)::bigint from delete_requests d where d.student_id = sid and d.status = 'pending'));
end $$;
revoke all on function public.cbt_delete_request(text, text, text, text) from public, authenticated;
grant execute on function public.cbt_delete_request(text, text, text, text) to anon;

create or replace function public.cbt_delete_cancel(p_mobile text, p_code text, p_device text)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid;
begin
  a := auth(p_mobile, p_code, p_device);
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;
  sid := (a->>'id')::uuid;
  update delete_requests set status = 'cancelled', closed_at = now() where student_id = sid and status = 'pending';
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.cbt_delete_cancel(text, text, text) from public, authenticated;
grant execute on function public.cbt_delete_cancel(text, text, text) to anon;

notify pgrst, 'reload schema';
