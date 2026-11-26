-- =====================================================================
--  v103: free access shows in My purchases (with a receipt) too (needs v101)
--
--  Until now My purchases listed only store orders. A test series you GIVE a student (Students → access) had no
--  record there. Now cbt_my_orders also returns "free": every test series the student has access to through
--  Students → access, except a series they already paid for in the store (that one is listed as the order).
--  Series that are free for everybody (the Free tag) are not listed; they were never given to one student.
--  The date of a new grant is remembered from now on (cbt_private.access_dates, filled by a trigger on series_access).
--  Grants made before this file have no date: the receipt shows "Earlier".
--  Nothing that exists is changed except cbt_my_orders (v101), which only gets a new "free" list.
--
--  Run ONCE in Supabase → SQL Editor (after v101). Safe to run again. v35 does not need to be run again.
-- =====================================================================
do $$ begin
  if to_regprocedure('public.cbt_my_orders(text,text,text)') is null then
    raise exception 'Run supabase_v101_orders_delete.sql first, then this file';
  end if;
end $$;

create table if not exists cbt_private.access_dates (
  student_id uuid not null,
  series_id  uuid not null,
  at         timestamptz not null default now(),
  primary key (student_id, series_id)
);
alter table cbt_private.access_dates enable row level security;
revoke all on cbt_private.access_dates from public, anon, authenticated;

create or replace function cbt_private.access_dates_fill() returns trigger
language plpgsql security definer set search_path = cbt_private, pg_temp as $$
begin
  insert into access_dates (student_id, series_id) values (new.student_id, new.series_id) on conflict do nothing;
  return new;
end $$;
revoke all on function cbt_private.access_dates_fill() from public, anon, authenticated;
drop trigger if exists series_access_dates on cbt_private.series_access;
create trigger series_access_dates after insert on cbt_private.series_access
  for each row execute function cbt_private.access_dates_fill();

create or replace function public.cbt_my_orders(p_mobile text, p_code text, p_device text)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; v_m text; v_nm text;
begin
  a := auth(p_mobile, p_code, p_device);
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;
  sid := (a->>'id')::uuid;
  select s.mobile, s.name into v_m, v_nm from students s where s.id = sid;
  return jsonb_build_object('ok', true, 'v101', true, 'v103', true, 'name', v_nm,
    'orders', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'title', x.item_title, 'amount', x.amount,
        'list', coalesce(x.list_price, x.amount + x.coupon_off + x.wallet_used), 'coupon', coalesce(x.coupon_code, ''), 'off', x.coupon_off,
        'wallet', x.wallet_used, 'at', (extract(epoch from coalesce(x.paid_at, x.created_at)) * 1000)::bigint) order by x.created_at desc)
      from (select o.* from public.cbt_store_orders o where o.mobile = right(v_m, 10) and o.status = 'paid'
             order by o.created_at desc limit 100) x), '[]'::jsonb),
    'free', coalesce((select jsonb_agg(jsonb_build_object('code', 'FREE-' || upper(left(md5(sid::text || sr.id::text), 6)),
        'title', sr.title, 'at', (extract(epoch from d.at) * 1000)::bigint) order by d.at desc nulls last, sr.title)
      from series_access ac join series sr on sr.id = ac.series_id and sr.active
      left join access_dates d on d.student_id = ac.student_id and d.series_id = ac.series_id
     where ac.student_id = sid
       and not exists (select 1 from public.cbt_store_orders o join public.cbt_store_items i on i.id = o.item_id
                        where o.mobile = right(v_m, 10) and o.status = 'paid' and i.series_id = sr.id::text)), '[]'::jsonb),
    'delete_at', (select (extract(epoch from d.created_at) * 1000)::bigint from delete_requests d where d.student_id = sid and d.status = 'pending'));
end $$;
revoke all on function public.cbt_my_orders(text, text, text) from public, authenticated;
grant execute on function public.cbt_my_orders(text, text, text) to anon;

notify pgrst, 'reload schema';
