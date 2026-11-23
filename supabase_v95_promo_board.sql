-- =====================================================================
--  v95: Promotions board — commission per test series, an optional code per influencer, leads.
--
--  • Commission per test series: each link keeps its normal commission, and can have a different one for any
--    test series (cbt_promo_rates). When an order is marked paid, the series' rate is saved on the order
--    (or the normal rate when the series has none), as before: changing a rate later never changes past orders.
--  • Influencer code (optional): a short code such as RAHUL10 for a link, with an on / off switch. A student who
--    types it in the coupon box of the store is counted for that influencer, even without opening the link.
--    If a coupon in Coupons & Refer has the same code, the student also gets that coupon's discount.
--  • Leads: a student who opens a link and enters their name + mobile in the store is saved for that link
--    (cbt_promo_leads), even before they buy. The owner sees who they are; the influencer never does.
--  • Admin: cbt_admin_promos 'get' also returns the codes, leads count, rates and the store's series;
--    'orders' also returns the leads and each order's series and how it came (link / code); new action 'rates'.
--
--  Run ONCE in Supabase → SQL Editor → New query → paste → Run, after v94. Safe to run again.
--  It changes only the real admin function behind the v35 wrapper, so v35 does NOT need to be run again.
--  If supabase_v30_promotions.sql is ever run again, run supabase_v35_admin_team.sql and then this file again.
-- =====================================================================
do $$ begin
  if to_regprocedure('cbt_private.cbt_admin_promos__core(text,text,jsonb)') is null then
    raise exception 'Run supabase_v30_promotions.sql and supabase_v35_admin_team.sql first, then this file';
  end if;
end $$;

-- ---------- influencer code (optional, on / off) ----------
alter table public.cbt_promo_links add column if not exists ucode    text;
alter table public.cbt_promo_links add column if not exists ucode_on boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cbt_promo_links_ucode_chk') then
    alter table public.cbt_promo_links add constraint cbt_promo_links_ucode_chk check (ucode is null or ucode ~ '^[A-Z0-9]{3,20}$');
  end if;
end $$;
create unique index if not exists cbt_promo_links_ucode on public.cbt_promo_links (ucode) where ucode is not null;

-- how an order was tied to its link: null / 'link' = opened the link, 'code' = typed the influencer code
alter table public.cbt_store_orders add column if not exists promo_via text;

-- ---------- commission per test series ----------
create table if not exists public.cbt_promo_rates (
  link_id    uuid not null references public.cbt_promo_links (id) on delete cascade,
  item_id    uuid not null,
  commission int  not null check (commission between 0 and 100000),
  primary key (link_id, item_id)
);
alter table public.cbt_promo_rates enable row level security;     -- no policies: only the functions below
revoke all on public.cbt_promo_rates from public, anon, authenticated;

-- ---------- leads: name + mobile entered in the store after opening a link ----------
create table if not exists public.cbt_promo_leads (
  code    text not null,
  mobile  text not null check (mobile ~ '^[6-9][0-9]{9}$'),
  name    text not null default '' check (length(name) <= 60),
  course  text not null default '' check (length(course) <= 10),
  ip      text not null default '',
  at      timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (code, mobile)
);
create index if not exists cbt_promo_leads_ip on public.cbt_promo_leads (ip, at desc);
alter table public.cbt_promo_leads enable row level security;
revoke all on public.cbt_promo_leads from public, anon, authenticated;

-- ---------- the commission saved on a paid order: the series' own rate first, else the link's normal rate ----------
create or replace function public.cbt_promo_snapshot() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'paid' and new.promo_code is not null and new.promo_rate is null then
    new.promo_rate := coalesce(
      (select r.commission from public.cbt_promo_rates r join public.cbt_promo_links l on l.id = r.link_id
        where l.code = new.promo_code and r.item_id = new.item_id),
      (select l.commission from public.cbt_promo_links l where l.code = new.promo_code), 0);
  end if;
  return new;
end; $$;

-- ---------- store: is any influencer code on? (the coupon box is shown for it even when coupons are off) ----------
create or replace function public.cbt_promo_codes_on()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('ok', true, 'on', exists (select 1 from public.cbt_promo_links where active and ucode_on and ucode is not null));
$$;
revoke all on function public.cbt_promo_codes_on() from public, authenticated;
grant execute on function public.cbt_promo_codes_on() to anon;

-- ---------- store: the student typed an influencer code for their pending order ----------
-- The typed code wins over a link opened earlier (the student chose it). Wrong codes count toward the store's
-- "too many tries" limit. The answer says only whether it worked.
create or replace function public.cbt_promo_use(p_order text, p_mobile text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
        v_m text := right(regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g'), 10);
        v_c text;
begin
  if public.cbt_store_too_many() then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  if v_u !~ '^[A-Z0-9]{3,20}$' then return jsonb_build_object('ok', true, 'applied', false); end if;
  select code into v_c from public.cbt_promo_links where ucode = v_u and ucode_on and active;
  if v_c is null then perform public.cbt_store_wrong(); return jsonb_build_object('ok', true, 'applied', false); end if;
  update public.cbt_store_orders set promo_code = v_c, promo_via = 'code'
   where code = upper(btrim(coalesce(p_order, ''))) and right(regexp_replace(mobile, '\D', '', 'g'), 10) = v_m
     and status = 'pending' and promo_rate is null;
  if not found then return jsonb_build_object('ok', true, 'applied', false); end if;
  return jsonb_build_object('ok', true, 'applied', true);
end; $$;
revoke all on function public.cbt_promo_use(text, text, text) from public, authenticated;
grant execute on function public.cbt_promo_use(text, text, text) to anon;

-- ---------- store: a student who came through a link entered their name + mobile ----------
-- At most 10 new leads per connection per hour; anything else is quietly ignored (the answer is always ok).
create or replace function public.cbt_promo_lead(p_code text, p_name text, p_mobile text, p_course text default '')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c text := lower(btrim(coalesce(p_code, '')));
        v_m text := right(regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g'), 10);
        v_n text := left(btrim(regexp_replace(coalesce(p_name, ''), '[<>"`\r\n\t]', '', 'g')), 60);
        v_k text := left(lower(regexp_replace(coalesce(p_course, ''), '[^a-zA-Z]', '', 'g')), 10);
        v_ip text := public.cbt_store_ip();
begin
  if v_m !~ '^[6-9][0-9]{9}$' or length(v_n) < 2
     or not exists (select 1 from public.cbt_promo_links where code = v_c and active) then
    return jsonb_build_object('ok', true);
  end if;
  if exists (select 1 from public.cbt_promo_leads where code = v_c and mobile = v_m) then
    update public.cbt_promo_leads set last_at = now(), name = v_n, course = case when v_k = '' then course else v_k end
     where code = v_c and mobile = v_m and last_at < now() - interval '1 minute';
    return jsonb_build_object('ok', true);
  end if;
  if (select count(*) from public.cbt_promo_leads where ip = v_ip and at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', true);
  end if;
  insert into public.cbt_promo_leads (code, mobile, name, course, ip) values (v_c, v_m, v_n, v_k, v_ip)
  on conflict (code, mobile) do nothing;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.cbt_promo_lead(text, text, text, text) from public, authenticated;
grant execute on function public.cbt_promo_lead(text, text, text, text) to anon;

-- ---------- admin (the real function behind the v35 wrapper; view = get, orders · manage = everything else) ----------
create or replace function cbt_private.cbt_admin_promos__core(p_pw text, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = cbt_private, public, pg_temp as $$
declare a jsonb; v_id uuid; v_c text; v_n text; v_ct text; v_note text; v_comm int; v_cl int;
        v_amt int; v_day date; v_ord text; v_valid boolean; v_u text; v_uon boolean; e jsonb;
begin
  a := (public.cbt_admin(p_pw, 'ping', '{}'))::text::jsonb;
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;

  if p_action = 'get' then
    return jsonb_build_object('ok', true,
      'links', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
          select l.id, l.code, l.name, l.contact, l.commission, l.claimed, l.active, l.clicks, l.note, l.created_at,
                 l.ucode, l.ucode_on,
                 (select count(*) from public.cbt_store_orders o where o.promo_code = l.code and o.promo_valid and o.status <> 'rejected') as leads,
                 (select count(*) from public.cbt_store_orders o where o.promo_code = l.code and o.promo_valid and o.status = 'paid') as paid_n,
                 (select count(*) from public.cbt_store_orders o where o.promo_code = l.code and o.promo_valid and o.status = 'pending') as pending_n,
                 (select coalesce(sum(o.amount), 0) from public.cbt_store_orders o where o.promo_code = l.code and o.promo_valid and o.status = 'paid') as revenue,
                 (select coalesce(sum(o.promo_rate), 0) from public.cbt_store_orders o where o.promo_code = l.code and o.promo_valid and o.status = 'paid') as earned,
                 (select coalesce(sum(p.amount), 0) from public.cbt_promo_payouts p where p.link_id = l.id) as paid_out,
                 (select count(*) from public.cbt_store_orders o where o.promo_code = l.code) as orders_all,
                 (select count(*) from (select d.mobile from public.cbt_promo_leads d where d.code = l.code
                                        union
                                        select right(regexp_replace(o.mobile, '\D', '', 'g'), 10) from public.cbt_store_orders o
                                         where o.promo_code = l.code and o.promo_valid) z) as people,
                 (select count(*) from public.cbt_store_orders o where o.promo_code = l.code and o.promo_via = 'code') as via_code
            from public.cbt_promo_links l) x), '[]'::jsonb),
      'payouts', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'link_id', p.link_id, 'amount', p.amount,
                    'paid_on', p.paid_on, 'note', p.note) order by p.paid_on desc, p.created_at desc)
                  from public.cbt_promo_payouts p), '[]'::jsonb),
      'rates', coalesce((select jsonb_agg(jsonb_build_object('link_id', r.link_id, 'item_id', r.item_id, 'commission', r.commission))
                  from public.cbt_promo_rates r), '[]'::jsonb),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'price', i.price, 'active', i.active)
                    order by i.active desc, i.sort_order, i.created_at)
                  from public.cbt_store_items i), '[]'::jsonb));
  end if;

  if p_action = 'orders' then
    v_c := lower(btrim(coalesce(p_data->>'code', '')));
    return jsonb_build_object('ok', true,
      'orders', coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'name', o.name, 'mobile', o.mobile,
                    'item_id', o.item_id, 'item_title', o.item_title, 'amount', o.amount, 'status', o.status, 'valid', o.promo_valid,
                    'rate', o.promo_rate, 'note', o.promo_note, 'via', coalesce(o.promo_via, 'link'), 'at', o.created_at, 'paid_at', o.paid_at)
                    order by o.created_at desc)
                  from (select * from public.cbt_store_orders where promo_code = v_c order by created_at desc limit 500) o), '[]'::jsonb),
      'leads', coalesce((select jsonb_agg(jsonb_build_object('name', d.name, 'mobile', d.mobile, 'course', d.course,
                    'at', d.at, 'last_at', d.last_at) order by d.at desc)
                  from (select * from public.cbt_promo_leads where code = v_c order by at desc limit 1000) d), '[]'::jsonb));
  end if;

  if p_action in ('create', 'update') then
    v_n    := left(btrim(regexp_replace(coalesce(p_data->>'name', ''), '[<>"`\r\t]', '', 'g')), 80);
    v_ct   := left(btrim(regexp_replace(coalesce(p_data->>'contact', ''), '[<>"`\r\t]', '', 'g')), 120);
    v_note := left(btrim(regexp_replace(coalesce(p_data->>'note', ''), '[<>\r\t]', '', 'g')), 500);
    if length(v_n) < 2 then return jsonb_build_object('ok', false, 'error', 'name'); end if;
    if coalesce(p_data->>'commission', '') !~ '^[0-9]{1,6}$' then return jsonb_build_object('ok', false, 'error', 'commission'); end if;
    v_comm := (p_data->>'commission')::int;
    if v_comm > 100000 then return jsonb_build_object('ok', false, 'error', 'commission'); end if;
    if coalesce(p_data->>'claimed', '') = '' then v_cl := null;
    elsif p_data->>'claimed' ~ '^[0-9]{1,7}$' then v_cl := (p_data->>'claimed')::int;
    else return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
    -- the influencer code: optional; empty = no code. An older panel that does not send it keeps the saved one.
    v_u := upper(btrim(coalesce(p_data->>'ucode', '')));
    if v_u <> '' and v_u !~ '^[A-Z0-9]{3,20}$' then return jsonb_build_object('ok', false, 'error', 'ucode'); end if;
    if coalesce(p_data->>'ucode_on', '') !~ '^(true|false)$' and p_data ? 'ucode_on' then return jsonb_build_object('ok', false, 'error', 'ucode'); end if;
    v_uon := coalesce((p_data->>'ucode_on')::boolean, false);
    if v_uon and v_u = '' and p_data ? 'ucode' then return jsonb_build_object('ok', false, 'error', 'ucode_empty'); end if;
    if v_u <> '' and exists (select 1 from public.cbt_promo_links where ucode = v_u
                              and id is distinct from case when p_action = 'update' and coalesce(p_data->>'id', '') ~* '^[0-9a-f-]{36}$'
                                                           then (p_data->>'id')::uuid end) then
      return jsonb_build_object('ok', false, 'error', 'ucode_exists');
    end if;
  end if;

  if p_action = 'create' then
    v_c := lower(btrim(coalesce(p_data->>'code', '')));
    if v_c !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' then return jsonb_build_object('ok', false, 'error', 'code'); end if;
    if exists (select 1 from public.cbt_promo_links where code = v_c) then return jsonb_build_object('ok', false, 'error', 'exists'); end if;
    insert into public.cbt_promo_links (code, name, contact, commission, claimed, note, ucode, ucode_on)
    values (v_c, v_n, v_ct, v_comm, v_cl, v_note, nullif(v_u, ''), v_uon and v_u <> '') returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'code', v_c);
  end if;

  if p_action = 'update' then
    if coalesce(p_data->>'id', '') !~* '^[0-9a-f-]{36}$' then return jsonb_build_object('ok', false, 'error', 'link'); end if;
    v_id := (p_data->>'id')::uuid;
    if coalesce(p_data->>'active', '') !~ '^(true|false)$' and p_data ? 'active' then return jsonb_build_object('ok', false, 'error', 'active'); end if;
    -- the link code never changes: links already shared would stop working (the influencer code can change)
    update public.cbt_promo_links set name = v_n, contact = v_ct, commission = v_comm, claimed = v_cl, note = v_note,
           active   = coalesce((p_data->>'active')::boolean, active),
           ucode    = case when p_data ? 'ucode' then nullif(v_u, '') else ucode end,
           ucode_on = case when p_data ? 'ucode' then v_uon and v_u <> ''
                           when p_data ? 'ucode_on' then v_uon and ucode is not null else ucode_on end
     where id = v_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'link'); end if;
    return jsonb_build_object('ok', true);
  end if;

  -- commission per test series: the full list for one link (series left out use the link's normal commission)
  if p_action = 'rates' then
    if coalesce(p_data->>'id', '') !~* '^[0-9a-f-]{36}$' then return jsonb_build_object('ok', false, 'error', 'link'); end if;
    v_id := (p_data->>'id')::uuid;
    if not exists (select 1 from public.cbt_promo_links where id = v_id) then return jsonb_build_object('ok', false, 'error', 'link'); end if;
    if jsonb_typeof(p_data->'rates') is distinct from 'array' or jsonb_array_length(p_data->'rates') > 300 then
      return jsonb_build_object('ok', false, 'error', 'rates');
    end if;
    for e in select * from jsonb_array_elements(p_data->'rates') loop
      if coalesce(e->>'item', '') !~* '^[0-9a-f-]{36}$' or coalesce(e->>'commission', '') !~ '^[0-9]{1,6}$'
         or (e->>'commission')::int > 100000 then
        return jsonb_build_object('ok', false, 'error', 'rates');
      end if;
    end loop;
    delete from public.cbt_promo_rates where link_id = v_id;
    insert into public.cbt_promo_rates (link_id, item_id, commission)
    select distinct on ((x->>'item')::uuid) v_id, (x->>'item')::uuid, (x->>'commission')::int
      from jsonb_array_elements(p_data->'rates') x
     where exists (select 1 from public.cbt_store_items i where i.id = (x->>'item')::uuid);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'delete' then
    if coalesce(p_data->>'id', '') !~* '^[0-9a-f-]{36}$' then return jsonb_build_object('ok', false, 'error', 'link'); end if;
    v_id := (p_data->>'id')::uuid;
    -- a link with orders or payouts is kept for the records: pause it instead
    if exists (select 1 from public.cbt_store_orders o join public.cbt_promo_links l on l.code = o.promo_code where l.id = v_id)
       or exists (select 1 from public.cbt_promo_payouts p where p.link_id = v_id) then
      return jsonb_build_object('ok', false, 'error', 'has_data');
    end if;
    delete from public.cbt_promo_leads where code = (select code from public.cbt_promo_links where id = v_id);
    delete from public.cbt_promo_links where id = v_id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'set_valid' then
    v_ord   := upper(btrim(coalesce(p_data->>'order', '')));
    v_valid := coalesce((p_data->>'valid')::boolean, true);
    v_note  := left(btrim(regexp_replace(coalesce(p_data->>'note', ''), '[<>\r\t]', '', 'g')), 500);
    update public.cbt_store_orders set promo_valid = v_valid, promo_note = v_note
     where code = v_ord and promo_code is not null;
    if not found then return jsonb_build_object('ok', false, 'error', 'order'); end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'payout_add' then
    if coalesce(p_data->>'link_id', '') !~* '^[0-9a-f-]{36}$' then return jsonb_build_object('ok', false, 'error', 'link'); end if;
    v_id := (p_data->>'link_id')::uuid;
    if coalesce(p_data->>'amount', '') !~ '^[0-9]{1,8}$' or (p_data->>'amount')::int < 1 or (p_data->>'amount')::int > 10000000 then
      return jsonb_build_object('ok', false, 'error', 'amount');
    end if;
    v_amt  := (p_data->>'amount')::int;
    v_note := left(btrim(regexp_replace(coalesce(p_data->>'note', ''), '[<>\r\t]', '', 'g')), 300);
    if coalesce(p_data->>'paid_on', '') = '' then v_day := current_date;
    elsif p_data->>'paid_on' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v_day := (p_data->>'paid_on')::date;
    else return jsonb_build_object('ok', false, 'error', 'date'); end if;
    if not exists (select 1 from public.cbt_promo_links where id = v_id) then return jsonb_build_object('ok', false, 'error', 'link'); end if;
    insert into public.cbt_promo_payouts (link_id, amount, paid_on, note) values (v_id, v_amt, v_day, v_note);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'payout_delete' then
    if coalesce(p_data->>'id', '') !~* '^[0-9a-f-]{36}$' then return jsonb_build_object('ok', false, 'error', 'payout'); end if;
    delete from public.cbt_promo_payouts where id = (p_data->>'id')::uuid;
    if not found then return jsonb_build_object('ok', false, 'error', 'payout'); end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'ping' then return a; end if;
  return jsonb_build_object('ok', false, 'error', 'action');
end; $$;
revoke all on function cbt_private.cbt_admin_promos__core(text, text, jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
select 'v95 installed: promotions board — commission per series, influencer codes, leads' as status;
