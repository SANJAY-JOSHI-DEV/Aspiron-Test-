-- =====================================================================
--  v96: Promotion commission as a % of the price, and one commission for everyone at once.
--
--  • Every commission (an influencer's normal one, and each test series' own one) is either a fixed ₹ per paid
--    student (as before) or a % of what the student paid, e.g. 10% → ₹29.90 → ₹30 on a ₹299 series, ₹80 on ₹799.
--    It is worked out and saved on the order when the order is marked paid, as before: a later change never
--    changes past orders.
--  • Admin: 'bulk' sets one commission for every influencer at once (optionally also removing every per-series
--    commission); 'rates_all' copies one influencer's per-series commissions to every influencer.
--
--  Run ONCE in Supabase → SQL Editor → New query → paste → Run, after v95. Safe to run again.
--  v35 does not need to be run again (only the real function behind the v35 wrapper changes).
-- =====================================================================
do $$ begin
  if to_regclass('public.cbt_promo_rates') is null then
    raise exception 'Run supabase_v95_promo_board.sql first, then this file';
  end if;
end $$;

alter table public.cbt_promo_links add column if not exists commission_pct boolean not null default false;
alter table public.cbt_promo_rates add column if not exists pct boolean not null default false;

-- the commission saved on a paid order: the series' own rate first, else the link's normal rate; ₹ or % of the amount paid
create or replace function public.cbt_promo_snapshot() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c int; v_p boolean;
begin
  if new.status = 'paid' and new.promo_code is not null and new.promo_rate is null then
    select r.commission, r.pct into v_c, v_p from public.cbt_promo_rates r join public.cbt_promo_links l on l.id = r.link_id
     where l.code = new.promo_code and r.item_id = new.item_id;
    if v_c is null then
      select l.commission, l.commission_pct into v_c, v_p from public.cbt_promo_links l where l.code = new.promo_code;
    end if;
    new.promo_rate := case when v_c is null then 0
                           when v_p then round(greatest(coalesce(new.amount, 0), 0) * least(v_c, 100) / 100.0)::int
                           else v_c end;
  end if;
  return new;
end; $$;

create or replace function cbt_private.cbt_admin_promos__core(p_pw text, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = cbt_private, public, pg_temp as $$
declare a jsonb; v_id uuid; v_c text; v_n text; v_ct text; v_note text; v_comm int; v_cl int;
        v_amt int; v_day date; v_ord text; v_valid boolean; v_u text; v_uon boolean; e jsonb; v_pct boolean; v_n2 int;
begin
  a := (public.cbt_admin(p_pw, 'ping', '{}'))::text::jsonb;
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;

  if p_action = 'get' then
    return jsonb_build_object('ok', true,
      'links', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
          select l.id, l.code, l.name, l.contact, l.commission, l.claimed, l.active, l.clicks, l.note, l.created_at,
                 l.ucode, l.ucode_on, l.commission_pct,
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
      'rates', coalesce((select jsonb_agg(jsonb_build_object('link_id', r.link_id, 'item_id', r.item_id, 'commission', r.commission, 'pct', r.pct))
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
    -- v96: the commission is ₹ per paid student, or (pct = true) a % of what the student paid
    if coalesce(p_data->>'pct', '') !~ '^(true|false)$' and p_data ? 'pct' then return jsonb_build_object('ok', false, 'error', 'commission'); end if;
    v_pct := case when p_data ? 'pct' then (p_data->>'pct')::boolean
                  when p_action = 'update' and coalesce(p_data->>'id', '') ~* '^[0-9a-f-]{36}$'
                  then coalesce((select commission_pct from public.cbt_promo_links where id = (p_data->>'id')::uuid), false)
                  else false end;
    if v_pct and v_comm > 100 then return jsonb_build_object('ok', false, 'error', 'pct'); end if;
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
    insert into public.cbt_promo_links (code, name, contact, commission, commission_pct, claimed, note, ucode, ucode_on)
    values (v_c, v_n, v_ct, v_comm, v_pct, v_cl, v_note, nullif(v_u, ''), v_uon and v_u <> '') returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'code', v_c);
  end if;

  if p_action = 'update' then
    if coalesce(p_data->>'id', '') !~* '^[0-9a-f-]{36}$' then return jsonb_build_object('ok', false, 'error', 'link'); end if;
    v_id := (p_data->>'id')::uuid;
    if coalesce(p_data->>'active', '') !~ '^(true|false)$' and p_data ? 'active' then return jsonb_build_object('ok', false, 'error', 'active'); end if;
    -- the link code never changes: links already shared would stop working (the influencer code can change)
    update public.cbt_promo_links set name = v_n, contact = v_ct, commission = v_comm, commission_pct = v_pct, claimed = v_cl, note = v_note,
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
         or (e->>'commission')::int > 100000 or (coalesce(e->>'pct', 'false') !~ '^(true|false)$')
         or (coalesce((e->>'pct')::boolean, false) and (e->>'commission')::int > 100) then
        return jsonb_build_object('ok', false, 'error', 'rates');
      end if;
    end loop;
    delete from public.cbt_promo_rates where link_id = v_id;
    insert into public.cbt_promo_rates (link_id, item_id, commission, pct)
    select distinct on ((x->>'item')::uuid) v_id, (x->>'item')::uuid, (x->>'commission')::int, coalesce((x->>'pct')::boolean, false)
      from jsonb_array_elements(p_data->'rates') x
     where exists (select 1 from public.cbt_store_items i where i.id = (x->>'item')::uuid);
    return jsonb_build_object('ok', true);
  end if;

  -- v96: one commission for every influencer at once (their normal commission). clear = also remove every
  -- per-series commission, so the one commission counts for every test series. Past paid orders never change.
  if p_action = 'bulk' then
    if coalesce(p_data->>'commission', '') !~ '^[0-9]{1,6}$' or (p_data->>'commission')::int > 100000
       or coalesce(p_data->>'pct', '') !~ '^(true|false)$' then return jsonb_build_object('ok', false, 'error', 'commission'); end if;
    v_comm := (p_data->>'commission')::int; v_pct := (p_data->>'pct')::boolean;
    if v_pct and v_comm > 100 then return jsonb_build_object('ok', false, 'error', 'pct'); end if;
    update public.cbt_promo_links set commission = v_comm, commission_pct = v_pct
     where active or coalesce((p_data->>'paused')::boolean, false);
    get diagnostics v_n2 = row_count;
    if coalesce((p_data->>'clear')::boolean, false) then
      delete from public.cbt_promo_rates r using public.cbt_promo_links l
       where l.id = r.link_id and (l.active or coalesce((p_data->>'paused')::boolean, false));
    end if;
    return jsonb_build_object('ok', true, 'n', v_n2);
  end if;

  -- v96: the per-series commissions of one influencer, copied to every influencer
  if p_action = 'rates_all' then
    if coalesce(p_data->>'id', '') !~* '^[0-9a-f-]{36}$' then return jsonb_build_object('ok', false, 'error', 'link'); end if;
    v_id := (p_data->>'id')::uuid;
    if not exists (select 1 from public.cbt_promo_links where id = v_id) then return jsonb_build_object('ok', false, 'error', 'link'); end if;
    delete from public.cbt_promo_rates where link_id <> v_id;
    insert into public.cbt_promo_rates (link_id, item_id, commission, pct)
    select l.id, r.item_id, r.commission, r.pct from public.cbt_promo_links l cross join public.cbt_promo_rates r
     where r.link_id = v_id and l.id <> v_id;
    if coalesce((p_data->>'normal')::boolean, false) then
      update public.cbt_promo_links set commission = s.commission, commission_pct = s.commission_pct
        from public.cbt_promo_links s where s.id = v_id and public.cbt_promo_links.id <> v_id;
    end if;
    return jsonb_build_object('ok', true, 'n', (select count(*) from public.cbt_promo_links) - 1);
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
select 'v96 installed: promotion commission in ₹ or %, one commission for everyone' as status;
