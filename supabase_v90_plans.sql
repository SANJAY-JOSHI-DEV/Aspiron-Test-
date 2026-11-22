-- =====================================================================
--  v90: Plans — Basic / Pro / Ultra, the compare list, add-ons, donations, plan coupons and "Notify me"
--  • Basic = a student who has a paid test series. Pro and Ultra are upgrades on the student's account (a student
--    without a test series can take them too). This file only describes the plans and lets students see them:
--    NOTHING is locked or unlocked here and NOBODY can pay yet. "Proceed to Buy" only saves "Notify me".
--  • Admin → Plans: plan names, prices (empty = "price coming soon"), validity, the compare list (one row per feature,
--    with Free / Basic / Pro / Ultra = yes, no, demo or a short text like "4 a month"), add-ons (handwritten notes,
--    test pass …, with a picture), the donation amounts, plan coupons and the list of students who tapped Notify me.
--  • The store (store.html) and its coupons are not touched.
--  Nothing existing is changed or deleted. Safe to run again.
--  Run in Supabase → SQL Editor after v89, then run supabase_v35_admin_team.sql AGAIN.
-- =====================================================================

create table if not exists cbt_private.plans (
  key        text primary key check (key in ('basic', 'pro', 'ultra')),
  title      text not null check (length(title) between 1 and 40),
  tagline    text not null default '' check (length(tagline) <= 120),
  price      int  check (price is null or price between 0 and 1000000),
  mrp        int  check (mrp is null or mrp between 0 and 1000000),
  days       int  not null default 365 check (days between 1 and 3650),
  active     boolean not null default true,
  sort       int  not null default 0,
  updated_at timestamptz not null default now()
);
insert into cbt_private.plans (key, title, tagline, sort) values
  ('basic', 'Basic', 'Your test series', 1),
  ('pro', 'Pro', 'Question bank, PYQ and the test generator', 2),
  ('ultra', 'Ultra', 'Everything, with unlimited practice', 3)
on conflict (key) do nothing;

-- the compare list: values are 'yes', 'no', 'demo' or a short text ("4 a month")
create table if not exists cbt_private.plan_rows (
  id      uuid primary key default gen_random_uuid(),
  section text not null default '' check (length(section) <= 40),
  label   text not null check (length(label) between 1 and 80),
  info    text not null default '' check (length(info) <= 300),
  v_free  text not null default 'no' check (length(v_free) between 1 and 20),
  v_basic text not null default 'yes' check (length(v_basic) between 1 and 20),
  v_pro   text not null default 'yes' check (length(v_pro) between 1 and 20),
  v_ultra text not null default 'yes' check (length(v_ultra) between 1 and 20),
  sort    int not null default 0
);
-- the owner's first table (only when the list is still empty)
insert into cbt_private.plan_rows (section, label, v_free, v_basic, v_pro, v_ultra, sort)
select * from (values
  ('Basic', 'Test series', 'demo', 'yes', 'yes', 'yes', 1),
  ('Basic', 'Doubt support', 'demo', 'yes', 'yes', 'yes', 2),
  ('Basic', 'Test PDF', 'demo', 'yes', 'yes', 'yes', 3),
  ('Basic', 'Save notes', 'demo', 'yes', 'yes', 'yes', 4),
  ('Basic', 'Mistake notebook', 'demo', 'yes', 'yes', 'yes', 5),
  ('Basic', 'Study tracker', 'demo', 'yes', 'yes', 'yes', 6),
  ('Pro', 'Question bank', 'no', 'no', 'yes', 'yes', 7),
  ('Pro', 'PYQ bank', 'no', 'no', 'yes', 'yes', 8),
  ('Pro', 'Test generator', 'no', 'no', '4 a month', 'Unlimited', 9),
  ('Ultra', 'PYQ analyzer', 'no', 'no', 'no', 'yes', 10),
  ('Ultra', 'Question practice', 'no', 'no', 'no', 'yes', 11),
  ('Ultra', 'Flash cards', 'no', 'no', 'no', 'yes', 12),
  ('Ultra', '3D models', 'no', 'no', 'no', 'yes', 13)) v(a, b, c, d, e, f, g)
where not exists (select 1 from cbt_private.plan_rows);

-- add-ons shown on the order summary (handwritten notes, test pass, …)
create table if not exists cbt_private.plan_addons (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'other' check (kind in ('notes', 'pass', 'other')),
  title      text not null check (length(title) between 1 and 80),
  body       text not null default '' check (length(body) <= 400),
  price      int  not null check (price between 0 and 1000000),
  mrp        int  check (mrp is null or mrp between 0 and 1000000),
  img        text not null default '' check (length(img) <= 400000),
  active     boolean not null default true,
  sort       int not null default 0,
  updated_at timestamptz not null default now()
);

-- one row of settings: the donation amounts
create table if not exists cbt_private.plan_settings (
  id        int primary key default 1 check (id = 1),
  donations int[] not null default '{10,25,50,100}'
);
insert into cbt_private.plan_settings (id) values (1) on conflict (id) do nothing;

-- coupons for plans (separate from the store's coupons, which belong to store items)
create table if not exists cbt_private.plan_coupons (
  code       text primary key check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$'),
  kind       text not null check (kind in ('pct', 'flat')),
  value      int  not null,
  plans      text[] not null default '{pro,ultra}',
  ends_at    timestamptz,
  active     boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint plan_coupons_value check ((kind = 'pct' and value between 1 and 100) or (kind = 'flat' and value between 1 and 1000000))
);

-- students who tapped "Notify me" on the order summary (one row per student and plan, the latest choice)
create table if not exists cbt_private.plan_notify (
  student_id uuid not null references cbt_private.students(id) on delete cascade,
  plan       text not null check (plan in ('basic', 'pro', 'ultra')),
  addons     jsonb not null default '[]'::jsonb check (jsonb_typeof(addons) = 'array' and length(addons::text) <= 2000),
  donation   int not null default 0 check (donation between 0 and 100000),
  coupon     text not null default '' check (length(coupon) <= 24),
  total      int not null default 0 check (total between 0 and 10000000),
  created_at timestamptz not null default now(),
  primary key (student_id, plan)
);
alter table cbt_private.plans enable row level security;
alter table cbt_private.plan_rows enable row level security;
alter table cbt_private.plan_addons enable row level security;
alter table cbt_private.plan_settings enable row level security;
alter table cbt_private.plan_coupons enable row level security;
alter table cbt_private.plan_notify enable row level security;
revoke all on cbt_private.plans, cbt_private.plan_rows, cbt_private.plan_addons, cbt_private.plan_settings,
              cbt_private.plan_coupons, cbt_private.plan_notify from public, anon, authenticated;

create or replace function cbt_private.plan_txt(p text, p_max int) returns text language sql immutable as $$
  select left(btrim(regexp_replace(coalesce(p, ''), '[<>\\\x01-\x08\x0b\x0c\x0e-\x1f]', '', 'g')), p_max)
$$;
revoke all on function cbt_private.plan_txt(text, int) from public, anon, authenticated;

-- ---------- everyone: the plans, the compare list, the add-ons and the donation amounts (no sign-in needed) ----------
create or replace function public.cbt_plans()
returns jsonb language sql security definer set search_path = cbt_private, pg_temp stable as $$
  select jsonb_build_object('ok', true, 'v90', true,
    'plans', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'title', title, 'tagline', tagline, 'price', price, 'mrp', mrp, 'days', days) order by sort, key)
                         from plans where active), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('section', section, 'label', label, 'info', info,
                         'free', v_free, 'basic', v_basic, 'pro', v_pro, 'ultra', v_ultra) order by sort, label) from plan_rows), '[]'::jsonb),
    'addons', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'title', title, 'body', body, 'price', price, 'mrp', mrp, 'img', img) order by sort, title)
                         from plan_addons where active), '[]'::jsonb),
    'donations', to_jsonb(coalesce((select donations from plan_settings where id = 1), '{}'::int[])))
$$;
revoke all on function public.cbt_plans() from public;
grant execute on function public.cbt_plans() to anon, authenticated;

-- ---------- student: check a plan coupon (only tells the discount; nothing is bought) ----------
create or replace function public.cbt_plan_coupon(p_mobile text, p_code text, p_device text, p_plan text, p_coupon text)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; c cbt_private.plan_coupons%rowtype; v_code text := upper(btrim(coalesce(p_coupon, '')));
begin
  a := cbt_private.auth(p_mobile, p_code, p_device);
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;
  if not cbt_private.rate_ok((a->>'id')::uuid, 'plan_coupon', 30) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,23}$' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  select * into c from plan_coupons where code = v_code and active and (ends_at is null or ends_at > now());
  if not found or not (coalesce(p_plan, '') = any(c.plans)) then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  return jsonb_build_object('ok', true, 'code', c.code, 'kind', c.kind, 'value', c.value);
end $$;
revoke all on function public.cbt_plan_coupon(text, text, text, text, text) from public;
grant execute on function public.cbt_plan_coupon(text, text, text, text, text) to anon, authenticated;

-- ---------- student: "Notify me" (payments are not open yet). Saves the choice; grants nothing. ----------
create or replace function public.cbt_plan_notify(p_mobile text, p_code text, p_device text, p_plan text, p_addons jsonb, p_donation int, p_coupon text, p_total int)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; v_add jsonb;
begin
  a := cbt_private.auth(p_mobile, p_code, p_device);
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;
  if coalesce(p_plan, '') not in ('basic', 'pro', 'ultra') then return jsonb_build_object('ok', false, 'error', 'plan'); end if;
  if not cbt_private.rate_ok((a->>'id')::uuid, 'plan_notify', 20) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  -- only ids of add-ons that exist
  select coalesce(jsonb_agg(to_jsonb(x.id::text)), '[]'::jsonb) into v_add from plan_addons x
   where jsonb_typeof(p_addons) = 'array' and x.id::text in (select jsonb_array_elements_text(p_addons) limit 20);
  insert into plan_notify (student_id, plan, addons, donation, coupon, total)
  values ((a->>'id')::uuid, p_plan, v_add, greatest(0, least(coalesce(p_donation, 0), 100000)),
          left(upper(regexp_replace(coalesce(p_coupon, ''), '[^A-Za-z0-9_-]', '', 'g')), 24), greatest(0, least(coalesce(p_total, 0), 10000000)))
  on conflict (student_id, plan) do update set addons = excluded.addons, donation = excluded.donation, coupon = excluded.coupon,
    total = excluded.total, created_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.cbt_plan_notify(text, text, text, text, jsonb, int, text, int) from public;
grant execute on function public.cbt_plan_notify(text, text, text, text, jsonb, int, text, int) to anon, authenticated;

-- ---------- admin ----------
-- get | plan_save {key,title,tagline,price,mrp,days,active} | row_save {id?,section,label,info,free,basic,pro,ultra,sort}
-- row_delete {id} | addon_save {id?,kind,title,body,price,mrp,img,active,sort} | addon_delete {id} | donations {amounts[]}
-- coupon_save {code,kind,value,plans[],ends_at,active} | coupon_delete {code}
create or replace function public.cbt_admin_plans(p_pw text, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare e text; d jsonb := coalesce(p_data, '{}'::jsonb); v_id uuid; v_img text; v_arr int[]; v_plans text[];
  vv text; k text;
begin
  e := admin_ok(p_pw);
  if e is not null then return jsonb_build_object('ok', false, 'error', e); end if;
  if p_action = 'get' then
    return jsonb_build_object('ok', true, 'v90', true,
      'plans', coalesce((select jsonb_agg(to_jsonb(p) order by sort, key) from plans p), '[]'::jsonb),
      'rows', coalesce((select jsonb_agg(to_jsonb(r) order by sort, label) from plan_rows r), '[]'::jsonb),
      'addons', coalesce((select jsonb_agg(to_jsonb(x) order by sort, title) from plan_addons x), '[]'::jsonb),
      'donations', to_jsonb(coalesce((select donations from plan_settings where id = 1), '{}'::int[])),
      'coupons', coalesce((select jsonb_agg(to_jsonb(c) order by code) from plan_coupons c), '[]'::jsonb),
      'notify', coalesce((select jsonb_agg(jsonb_build_object('plan', n.plan, 'name', coalesce(s.name, ''), 'mobile', coalesce(s.mobile, ''),
                  'addons', n.addons, 'donation', n.donation, 'coupon', n.coupon, 'total', n.total,
                  'at', (extract(epoch from n.created_at) * 1000)::bigint) order by n.created_at desc)
                  from (select * from plan_notify order by created_at desc limit 500) n left join students s on s.id = n.student_id), '[]'::jsonb));
  elsif p_action = 'plan_save' then
    if coalesce(d->>'key', '') not in ('basic', 'pro', 'ultra') then return jsonb_build_object('ok', false, 'error', 'plan'); end if;
    if cbt_private.plan_txt(d->>'title', 40) = '' then return jsonb_build_object('ok', false, 'error', 'title'); end if;
    if coalesce(d->>'price', '') !~ '^([0-9]{1,7})?$' or coalesce(d->>'mrp', '') !~ '^([0-9]{1,7})?$' or coalesce(d->>'days', '365') !~ '^[0-9]{1,4}$'
       or coalesce(nullif(d->>'days', '')::int, 365) not between 1 and 3650 then
      return jsonb_build_object('ok', false, 'error', 'number');
    end if;
    update plans set title = cbt_private.plan_txt(d->>'title', 40), tagline = cbt_private.plan_txt(d->>'tagline', 120),
      price = nullif(d->>'price', '')::int, mrp = nullif(d->>'mrp', '')::int, days = coalesce(nullif(d->>'days', '')::int, 365),
      active = coalesce((d->>'active')::boolean, true), updated_at = now()
     where key = d->>'key';
    perform set_config('cbt.detail', d->>'key', true);
    return jsonb_build_object('ok', true);
  elsif p_action = 'row_save' then
    if cbt_private.plan_txt(d->>'label', 80) = '' then return jsonb_build_object('ok', false, 'error', 'label'); end if;
    foreach k in array array['free', 'basic', 'pro', 'ultra'] loop
      vv := cbt_private.plan_txt(d->>k, 20);
      if vv = '' then return jsonb_build_object('ok', false, 'error', 'value'); end if;
    end loop;
    if coalesce(d->>'sort', '0') !~ '^[0-9]{1,5}$' then return jsonb_build_object('ok', false, 'error', 'number'); end if;
    if coalesce(d->>'id', '') <> '' then
      begin v_id := (d->>'id')::uuid; exception when others then return jsonb_build_object('ok', false, 'error', 'not_found'); end;
      update plan_rows set section = cbt_private.plan_txt(d->>'section', 40), label = cbt_private.plan_txt(d->>'label', 80),
        info = cbt_private.plan_txt(d->>'info', 300), v_free = cbt_private.plan_txt(d->>'free', 20), v_basic = cbt_private.plan_txt(d->>'basic', 20),
        v_pro = cbt_private.plan_txt(d->>'pro', 20), v_ultra = cbt_private.plan_txt(d->>'ultra', 20), sort = coalesce(nullif(d->>'sort', '')::int, 0)
       where id = v_id;
      if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    else
      if (select count(*) from plan_rows) >= 200 then return jsonb_build_object('ok', false, 'error', 'limit'); end if;
      insert into plan_rows (section, label, info, v_free, v_basic, v_pro, v_ultra, sort)
      values (cbt_private.plan_txt(d->>'section', 40), cbt_private.plan_txt(d->>'label', 80), cbt_private.plan_txt(d->>'info', 300),
              cbt_private.plan_txt(d->>'free', 20), cbt_private.plan_txt(d->>'basic', 20), cbt_private.plan_txt(d->>'pro', 20),
              cbt_private.plan_txt(d->>'ultra', 20), coalesce(nullif(d->>'sort', '')::int, 0))
      returning id into v_id;
    end if;
    perform set_config('cbt.detail', cbt_private.plan_txt(d->>'label', 80), true);
    return jsonb_build_object('ok', true, 'id', v_id);
  elsif p_action = 'row_delete' then
    begin v_id := (d->>'id')::uuid; exception when others then return jsonb_build_object('ok', false, 'error', 'not_found'); end;
    delete from plan_rows where id = v_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    return jsonb_build_object('ok', true);
  elsif p_action = 'addon_save' then
    if cbt_private.plan_txt(d->>'title', 80) = '' then return jsonb_build_object('ok', false, 'error', 'title'); end if;
    if coalesce(d->>'kind', '') not in ('notes', 'pass', 'other') then return jsonb_build_object('ok', false, 'error', 'kind'); end if;
    if coalesce(d->>'price', '') !~ '^[0-9]{1,7}$' or coalesce(d->>'mrp', '') !~ '^([0-9]{1,7})?$' or coalesce(d->>'sort', '0') !~ '^[0-9]{1,5}$' then
      return jsonb_build_object('ok', false, 'error', 'number');
    end if;
    v_img := coalesce(d->>'img', '');
    if v_img <> '' and (length(v_img) > 400000 or v_img !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$') then
      return jsonb_build_object('ok', false, 'error', 'img');
    end if;
    if coalesce(d->>'id', '') <> '' then
      begin v_id := (d->>'id')::uuid; exception when others then return jsonb_build_object('ok', false, 'error', 'not_found'); end;
      update plan_addons set kind = d->>'kind', title = cbt_private.plan_txt(d->>'title', 80), body = cbt_private.plan_txt(d->>'body', 400),
        price = (d->>'price')::int, mrp = nullif(d->>'mrp', '')::int, img = case when d ? 'img' then v_img else img end,
        active = coalesce((d->>'active')::boolean, true), sort = coalesce(nullif(d->>'sort', '')::int, 0), updated_at = now()
       where id = v_id;
      if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    else
      if (select count(*) from plan_addons) >= 30 then return jsonb_build_object('ok', false, 'error', 'limit'); end if;
      insert into plan_addons (kind, title, body, price, mrp, img, active, sort)
      values (d->>'kind', cbt_private.plan_txt(d->>'title', 80), cbt_private.plan_txt(d->>'body', 400), (d->>'price')::int,
              nullif(d->>'mrp', '')::int, v_img, coalesce((d->>'active')::boolean, true), coalesce(nullif(d->>'sort', '')::int, 0))
      returning id into v_id;
    end if;
    perform set_config('cbt.detail', cbt_private.plan_txt(d->>'title', 80), true);
    return jsonb_build_object('ok', true, 'id', v_id);
  elsif p_action = 'addon_delete' then
    begin v_id := (d->>'id')::uuid; exception when others then return jsonb_build_object('ok', false, 'error', 'not_found'); end;
    delete from plan_addons where id = v_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    return jsonb_build_object('ok', true);
  elsif p_action = 'donations' then
    if jsonb_typeof(d->'amounts') is distinct from 'array' or jsonb_array_length(d->'amounts') > 8
       or exists (select 1 from jsonb_array_elements(d->'amounts') v where jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,6}$'
                    or (v #>> '{}')::int not between 1 and 100000) then
      return jsonb_build_object('ok', false, 'error', 'amounts');
    end if;
    select coalesce(array_agg(distinct (v #>> '{}')::int order by (v #>> '{}')::int), '{}') into v_arr from jsonb_array_elements(d->'amounts') v;
    update plan_settings set donations = v_arr where id = 1;
    return jsonb_build_object('ok', true, 'donations', to_jsonb(v_arr));
  elsif p_action = 'coupon_save' then
    if upper(coalesce(d->>'code', '')) !~ '^[A-Z0-9][A-Z0-9_-]{2,23}$' then return jsonb_build_object('ok', false, 'error', 'code'); end if;
    if coalesce(d->>'kind', '') not in ('pct', 'flat') or coalesce(d->>'value', '') !~ '^[0-9]{1,7}$'
       or (d->>'kind' = 'pct' and (d->>'value')::int not between 1 and 100) or (d->>'kind' = 'flat' and (d->>'value')::int not between 1 and 1000000) then
      return jsonb_build_object('ok', false, 'error', 'value');
    end if;
    select coalesce(array_agg(distinct x), '{}') into v_plans from jsonb_array_elements_text(case when jsonb_typeof(d->'plans') = 'array' then d->'plans' else '[]'::jsonb end) x
     where x in ('basic', 'pro', 'ultra');
    if cardinality(v_plans) = 0 then return jsonb_build_object('ok', false, 'error', 'plans'); end if;
    insert into plan_coupons (code, kind, value, plans, ends_at, active)
    values (upper(d->>'code'), d->>'kind', (d->>'value')::int, v_plans,
            case when coalesce(d->>'ends_at', '') ~ '^[0-9]{10,14}$' then to_timestamp((d->>'ends_at')::bigint / 1000.0) end,
            coalesce((d->>'active')::boolean, true))
    on conflict (code) do update set kind = excluded.kind, value = excluded.value, plans = excluded.plans, ends_at = excluded.ends_at,
      active = excluded.active, updated_at = now();
    perform set_config('cbt.detail', upper(d->>'code'), true);
    return jsonb_build_object('ok', true);
  elsif p_action = 'coupon_delete' then
    delete from plan_coupons where code = upper(coalesce(d->>'code', ''));
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'action');
end $$;
revoke all on function public.cbt_admin_plans(text, text, jsonb) from public;
grant execute on function public.cbt_admin_plans(text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
