-- =============================================================
-- POS Reimagined - Complete Database Schema
-- Generated from all migration files
-- Run this in Supabase SQL Editor
-- =============================================================

-- 1. Base schema - roles, profiles, products, sales
-- =============================================================

-- Roles enum
do $$ begin
  create type public.app_role as enum ('admin', 'cashier');
exception
  when duplicate_object then null;
end $$;

-- Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  username text unique,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- User roles (separate table)
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
alter table public.user_roles enable row level security;

-- Security definer to check role (avoid RLS recursion)
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.get_user_role(_user_id uuid)
returns app_role
language sql stable security definer set search_path = public
as $$
  select role from public.user_roles where user_id = _user_id limit 1
$$;

-- Categories
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;

-- Products
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  barcode text not null unique,
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  purchase_price numeric(12,2) not null default 0,
  sale_price numeric(12,2) not null default 0,
  stock integer not null default 0,
  min_stock_alert integer not null default 5,
  is_active boolean not null default true,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.products enable row level security;
create index if not exists idx_products_barcode on public.products(barcode);
create index if not exists idx_products_name on public.products(name);

-- Sales
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  bill_no text not null unique,
  cashier_id uuid not null references auth.users(id),
  cashier_name text not null default '',
  subtotal numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  cash_received numeric(12,2) not null default 0,
  change_returned numeric(12,2) not null default 0,
  payment_type text not null default 'cash',
  items_count integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.sales enable row level security;
create index if not exists idx_sales_created on public.sales(created_at desc);

-- Sale items
create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  barcode text not null default '',
  qty integer not null,
  unit_price numeric(12,2) not null,
  purchase_price numeric(12,2) not null default 0,
  subtotal numeric(12,2) not null
);
alter table public.sale_items enable row level security;
create index if not exists idx_sale_items_sale on public.sale_items(sale_id);

-- Store settings (single row)
create table if not exists public.store_settings (
  id integer primary key default 1,
  store_name text not null default 'ZIC Mart',
  address text not null default 'ZIC Petrol Pump, Murree Road, Abbottabad',
  phone text not null default '0313-5881633',
  tax_rate numeric(5,2) not null default 0,
  currency text not null default 'Rs.',
  footer_message text not null default 'Thank you for shopping at ZIC Mart!',
  logo_url text,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);
alter table public.store_settings enable row level security;
insert into public.store_settings (id) values (1) on conflict (id) do nothing;

-- Bill sequence per day
create table if not exists public.bill_sequences (
  date_key text primary key,
  prefix text not null,
  last_seq integer not null default 0
);
alter table public.bill_sequences enable row level security;

-- Function to generate next bill no atomically (v2 - handles imported data)
create or replace function public.next_bill_no(_prefix text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _date_key text := to_char(now(), 'YYYYMMDD');
  _key text := _prefix || '-' || _date_key;
  _seq integer;
  _max_existing integer;
begin
  SELECT COALESCE(MAX(NULLIF(regexp_replace(bill_no, '^' || _prefix || '-' || _date_key || '-', ''), '')::int), 0)
    INTO _max_existing
  FROM public.sales
  WHERE bill_no LIKE _prefix || '-' || _date_key || '-%';

  insert into public.bill_sequences(date_key, prefix, last_seq)
  values (_key, _prefix, _max_existing + 1)
  on conflict (date_key) do update set last_seq = GREATEST(bill_sequences.last_seq + 1, _max_existing + 1)
  returning last_seq into _seq;

  return _prefix || '-' || _date_key || '-' || lpad(_seq::text, 4, '0');
end;
$$;

-- Process sale RPC: creates sale + items + decrements stock atomically (v3 - with shift & payment_method)
create or replace function public.process_sale(
  _items jsonb, _subtotal numeric, _tax_amount numeric, _discount numeric,
  _total numeric, _cash_received numeric, _change_returned numeric, _payment_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _bill_no text;
  _sale_id uuid;
  _cashier_name text;
  _session_id uuid;
  _payment_method text;
  _item jsonb;
  _items_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  SELECT id INTO _session_id FROM public.cash_sessions
  WHERE user_id = auth.uid() AND status = 'open' LIMIT 1;

  IF _session_id IS NULL THEN
    RAISE EXCEPTION 'No open shift. Please start a shift before making sales.';
  END IF;

  _payment_method := CASE WHEN lower(coalesce(_payment_type,'cash')) = 'card' THEN 'card' ELSE 'cash' END;

  select coalesce(full_name, username, 'Cashier') into _cashier_name
  from public.profiles where id = auth.uid();

  _bill_no := public.next_bill_no('ZIC');

  INSERT INTO public.sales(bill_no, cashier_id, cashier_name, subtotal, tax_amount, discount, total,
    cash_received, change_returned, payment_type, items_count, session_id, payment_method)
  VALUES (_bill_no, auth.uid(), coalesce(_cashier_name,''), _subtotal, _tax_amount, _discount, _total,
    _cash_received, _change_returned, _payment_type, 0, _session_id, _payment_method)
  RETURNING id INTO _sale_id;

  for _item in select * from jsonb_array_elements(_items) loop
    insert into public.sale_items(sale_id, product_id, product_name, barcode, qty, unit_price, purchase_price, subtotal)
    values (
      _sale_id,
      (_item->>'product_id')::uuid,
      _item->>'product_name',
      coalesce(_item->>'barcode',''),
      (_item->>'qty')::int,
      (_item->>'unit_price')::numeric,
      coalesce((_item->>'purchase_price')::numeric, 0),
      (_item->>'subtotal')::numeric
    );

    update public.products
      set stock = stock - (_item->>'qty')::int,
          updated_at = now()
      where id = (_item->>'product_id')::uuid;

    _items_count := _items_count + (_item->>'qty')::int;
  end loop;

  update public.sales set items_count = _items_count where id = _sale_id;

  return jsonb_build_object('sale_id', _sale_id, 'bill_no', _bill_no);
end;
$$;

-- Auto profile creation; first user becomes admin
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare _is_first boolean;
begin
  insert into public.profiles(id, full_name, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1))
  );

  select count(*) = 0 into _is_first from public.user_roles;
  insert into public.user_roles(user_id, role)
  values (new.id, case when _is_first then 'admin'::app_role else 'cashier'::app_role end);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Updated_at trigger helper
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin new.updated_at = now(); return new; end;
$$;

-- ===== RLS POLICIES =====

-- profiles: user reads own; admin reads all
create policy "profiles self read" on public.profiles for select using (auth.uid() = id);
create policy "profiles admin read all" on public.profiles for select using (public.has_role(auth.uid(),'admin'));
create policy "profiles self update" on public.profiles for update using (auth.uid() = id);
create policy "profiles admin manage" on public.profiles for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- user_roles: user reads own; admin manages
create policy "roles self read" on public.user_roles for select using (auth.uid() = user_id);
create policy "roles admin read" on public.user_roles for select using (public.has_role(auth.uid(),'admin'));
create policy "roles admin manage" on public.user_roles for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- categories: all auth read; admin write
create policy "cat read" on public.categories for select to authenticated using (true);
create policy "cat admin write" on public.categories for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- products: all auth read; admin write (sales RPC uses security definer for stock)
create policy "prod read" on public.products for select to authenticated using (true);
create policy "prod admin write" on public.products for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- sales: cashier sees own; admin sees all; insert via RPC (security definer) - block direct insert
create policy "sales own read" on public.sales for select using (auth.uid() = cashier_id);
create policy "sales admin read" on public.sales for select using (public.has_role(auth.uid(),'admin'));

-- sale_items: read if can read parent sale
create policy "sale_items read own" on public.sale_items for select using (
  exists(select 1 from public.sales s where s.id = sale_id and (s.cashier_id = auth.uid() or public.has_role(auth.uid(),'admin')))
);

-- store_settings: all auth read; admin write
create policy "settings read" on public.store_settings for select to authenticated using (true);
create policy "settings admin write" on public.store_settings for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- bill_sequences: server-only via definer, no client policy needed but allow read for admin
create policy "billseq admin read" on public.bill_sequences for select using (public.has_role(auth.uid(),'admin'));

-- Seed default categories
insert into public.categories (name) values ('General'), ('Beverages'), ('Snacks'), ('Groceries') on conflict (name) do nothing;

-- Trigger for products
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();


-- 2. Returns, audit log, profile is_active
-- =============================================================

-- Add is_active to profiles for activation/deactivation
alter table public.profiles add column if not exists is_active boolean not null default true;

-- Returns tables
create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  return_no text not null unique,
  original_sale_id uuid not null references public.sales(id) on delete restrict,
  original_bill_no text not null,
  cashier_id uuid not null,
  cashier_name text not null default '',
  reason text not null default '',
  refund_amount numeric not null default 0,
  items_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns(id) on delete cascade,
  product_id uuid,
  product_name text not null,
  barcode text not null default '',
  qty integer not null,
  unit_price numeric not null,
  subtotal numeric not null
);

alter table public.returns enable row level security;
alter table public.return_items enable row level security;

create policy "returns own read" on public.returns for select using (auth.uid() = cashier_id);
create policy "returns admin read" on public.returns for select using (public.has_role(auth.uid(), 'admin'));
create policy "return_items read own" on public.return_items for select using (
  exists (select 1 from public.returns r where r.id = return_items.return_id and (r.cashier_id = auth.uid() or public.has_role(auth.uid(), 'admin')))
);

-- User audit log
create table if not exists public.user_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_name text not null default '',
  target_user_id uuid,
  target_user_name text not null default '',
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.user_audit_log enable row level security;
create policy "audit admin read" on public.user_audit_log for select using (public.has_role(auth.uid(), 'admin'));
create policy "audit admin insert" on public.user_audit_log for insert with check (public.has_role(auth.uid(), 'admin'));


-- 3. Return status/approval flow, execute privileges
-- =============================================================

-- Add status & approval fields to returns
alter table public.returns add column if not exists status text not null default 'pending';
alter table public.returns add column if not exists approved_by uuid;
alter table public.returns add column if not exists approved_by_name text;
alter table public.returns add column if not exists approved_at timestamptz;
alter table public.returns add column if not exists voided_by uuid;
alter table public.returns add column if not exists voided_by_name text;
alter table public.returns add column if not exists voided_at timestamptz;
alter table public.returns add column if not exists void_reason text;

-- Constrain status values
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'returns_status_check') then
    alter table public.returns add constraint returns_status_check
      check (status in ('pending','approved','voided'));
  end if;
end $$;

-- Process return: creates return in pending status (no stock restore)
create or replace function public.process_return(
  _sale_id uuid,
  _items jsonb,
  _reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _return_no text;
  _return_id uuid;
  _cashier_name text;
  _bill_no text;
  _item jsonb;
  _items_count integer := 0;
  _refund numeric := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select coalesce(full_name, username, 'Cashier') into _cashier_name
  from public.profiles where id = auth.uid();

  select bill_no into _bill_no from public.sales where id = _sale_id;
  if _bill_no is null then raise exception 'Sale not found'; end if;

  _return_no := public.next_bill_no('RET');

  insert into public.returns(return_no, original_sale_id, original_bill_no, cashier_id, cashier_name, reason, refund_amount, items_count, status)
  values (_return_no, _sale_id, _bill_no, auth.uid(), coalesce(_cashier_name,''), coalesce(_reason,''), 0, 0, 'pending')
  returning id into _return_id;

  for _item in select * from jsonb_array_elements(_items) loop
    insert into public.return_items(return_id, product_id, product_name, barcode, qty, unit_price, subtotal)
    values (
      _return_id,
      nullif(_item->>'product_id','')::uuid,
      _item->>'product_name',
      coalesce(_item->>'barcode',''),
      (_item->>'qty')::int,
      (_item->>'unit_price')::numeric,
      (_item->>'subtotal')::numeric
    );

    _items_count := _items_count + (_item->>'qty')::int;
    _refund := _refund + (_item->>'subtotal')::numeric;
  end loop;

  update public.returns set items_count = _items_count, refund_amount = _refund where id = _return_id;

  return jsonb_build_object('return_id', _return_id, 'return_no', _return_no, 'refund', _refund, 'status', 'pending');
end;
$$;

-- Approve return: restore stock now (admin only)
create or replace function public.approve_return(_return_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _status text;
  _approver text;
  _it record;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can approve returns';
  end if;

  select status into _status from public.returns where id = _return_id for update;
  if _status is null then raise exception 'Return not found'; end if;
  if _status <> 'pending' then raise exception 'Only pending returns can be approved'; end if;

  select coalesce(full_name, username, 'Admin') into _approver
  from public.profiles where id = auth.uid();

  for _it in select product_id, qty from public.return_items where return_id = _return_id loop
    if _it.product_id is not null then
      update public.products
        set stock = stock + _it.qty, updated_at = now()
        where id = _it.product_id;
    end if;
  end loop;

  update public.returns
    set status = 'approved',
        approved_by = auth.uid(),
        approved_by_name = coalesce(_approver,''),
        approved_at = now()
    where id = _return_id;

  return jsonb_build_object('return_id', _return_id, 'status', 'approved');
end;
$$;

-- Void return: reverse stock if approved, mark void (admin only)
create or replace function public.void_return(_return_id uuid, _reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _status text;
  _voider text;
  _it record;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can void returns';
  end if;

  select status into _status from public.returns where id = _return_id for update;
  if _status is null then raise exception 'Return not found'; end if;
  if _status = 'voided' then raise exception 'Return already voided'; end if;

  select coalesce(full_name, username, 'Admin') into _voider
  from public.profiles where id = auth.uid();

  if _status = 'approved' then
    for _it in select product_id, qty from public.return_items where return_id = _return_id loop
      if _it.product_id is not null then
        update public.products
          set stock = stock - _it.qty, updated_at = now()
          where id = _it.product_id;
      end if;
    end loop;
  end if;

  update public.returns
    set status = 'voided',
        voided_by = auth.uid(),
        voided_by_name = coalesce(_voider,''),
        voided_at = now(),
        void_reason = coalesce(_reason,'')
    where id = _return_id;

  return jsonb_build_object('return_id', _return_id, 'status', 'voided');
end;
$$;

-- Lock down execute privileges on all SECURITY DEFINER functions.
revoke execute on function public.has_role(uuid, app_role) from public, anon;
grant  execute on function public.has_role(uuid, app_role) to authenticated;

revoke execute on function public.get_user_role(uuid) from public, anon;
grant  execute on function public.get_user_role(uuid) to authenticated;

revoke execute on function public.next_bill_no(text) from public, anon, authenticated;

revoke execute on function public.process_sale(jsonb, numeric, numeric, numeric, numeric, numeric, numeric, text) from public, anon;
grant  execute on function public.process_sale(jsonb, numeric, numeric, numeric, numeric, numeric, numeric, text) to authenticated;

revoke execute on function public.process_return(uuid, jsonb, text) from public, anon;
grant  execute on function public.process_return(uuid, jsonb, text) to authenticated;

revoke execute on function public.approve_return(uuid) from public, anon;
grant  execute on function public.approve_return(uuid) to authenticated;

revoke execute on function public.void_return(uuid, text) from public, anon;
grant  execute on function public.void_return(uuid, text) to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;


-- 4. Admin dashboard analytics
-- =============================================================

create or replace function public.get_admin_dashboard_summary(_start_at timestamptz, _days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _gross numeric := 0;
  _bills integer := 0;
  _refunds numeric := 0;
  _returns_count integer := 0;
  _daily jsonb := '[]'::jsonb;
  _top_products jsonb := '[]'::jsonb;
  _margin jsonb := '[]'::jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view dashboard analytics';
  end if;

  _days := greatest(1, least(coalesce(_days, 7), 90));

  select coalesce(sum(total), 0), count(*)::int
  into _gross, _bills
  from public.sales
  where created_at >= _start_at;

  select coalesce(sum(refund_amount), 0), count(*)::int
  into _refunds, _returns_count
  from public.returns
  where status = 'approved'
    and coalesce(approved_at, created_at) >= _start_at;

  with day_series as (
    select generate_series(
      date_trunc('day', _start_at),
      date_trunc('day', now()),
      interval '1 day'
    )::date as day
  ), sales_by_day as (
    select date_trunc('day', created_at)::date as day, sum(total) as sales
    from public.sales
    where created_at >= _start_at
    group by 1
  ), returns_by_day as (
    select date_trunc('day', coalesce(approved_at, created_at))::date as day, sum(refund_amount) as refunds
    from public.returns
    where status = 'approved'
      and coalesce(approved_at, created_at) >= _start_at
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', case when _days = 1 then 'Today' else to_char(ds.day, 'MM-DD') end,
    'sales', round(coalesce(s.sales, 0)),
    'refunds', round(coalesce(r.refunds, 0))
  ) order by ds.day), '[]'::jsonb)
  into _daily
  from day_series ds
  left join sales_by_day s on s.day = ds.day
  left join returns_by_day r on r.day = ds.day;

  with product_totals as (
    select si.product_name as name,
           sum(si.qty)::int as qty,
           sum(si.subtotal) as revenue
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where s.created_at >= _start_at
    group by si.product_name
    order by sum(si.qty) desc
    limit 7
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', name,
    'qty', qty,
    'revenue', revenue
  )), '[]'::jsonb)
  into _top_products
  from product_totals;

  with margin_buckets as (
    select case
      when si.subtotal > 0 and (((si.subtotal - (si.purchase_price * si.qty)) / si.subtotal) * 100) < 10 then 'Low (<10%)'
      when si.subtotal > 0 and (((si.subtotal - (si.purchase_price * si.qty)) / si.subtotal) * 100) < 30 then 'Mid (10-30%)'
      else 'High (>30%)'
    end as name,
    round(sum(si.subtotal)) as value
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where s.created_at >= _start_at
      and si.subtotal > 0
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'value', value)), '[]'::jsonb)
  into _margin
  from margin_buckets
  where value > 0;

  return jsonb_build_object(
    'grossSales', _gross,
    'bills', _bills,
    'refunds', _refunds,
    'net', _gross - _refunds,
    'rate', case when _gross > 0 then (_refunds / _gross) * 100 else 0 end,
    'returnsCount', _returns_count,
    'daily', _daily,
    'topProducts', _top_products,
    'margin', _margin
  );
end;
$$;

create or replace function public.get_admin_inventory_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.has_role(auth.uid(), 'admin') then
      jsonb_build_object('products', 0, 'lowStock', 0, 'lowStockItems', '[]'::jsonb)
    else (
      select jsonb_build_object(
        'products', count(*)::int,
        'lowStock', count(*) filter (where stock <= min_stock_alert)::int,
        'lowStockItems', coalesce(jsonb_agg(
          jsonb_build_object(
            'id', id,
            'name', name,
            'stock', stock,
            'min_stock_alert', min_stock_alert
          ) order by stock asc
        ) filter (where stock <= min_stock_alert), '[]'::jsonb)
      )
      from public.products
    )
  end
$$;

create index if not exists idx_returns_status_approved_created on public.returns(status, approved_at desc, created_at desc);
create index if not exists idx_sale_items_product_name on public.sale_items(product_name);


-- 5. Admin dashboard - security invoker
-- =============================================================

alter function public.get_admin_dashboard_summary(timestamptz, integer) security invoker;
alter function public.get_admin_inventory_summary() security invoker;

revoke execute on function public.get_admin_dashboard_summary(timestamptz, integer) from public, anon;
grant execute on function public.get_admin_dashboard_summary(timestamptz, integer) to authenticated;
revoke execute on function public.get_admin_inventory_summary() from public, anon;
grant execute on function public.get_admin_inventory_summary() to authenticated;


-- 6. Cash sessions & shift management
-- =============================================================

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text NOT NULL DEFAULT '',
  opening_cash numeric NOT NULL DEFAULT 0,
  closing_cash numeric,
  cash_sales numeric NOT NULL DEFAULT 0,
  expected_cash numeric NOT NULL DEFAULT 0,
  difference numeric,
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

-- Only one open session per user
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_per_user
  ON public.cash_sessions(user_id) WHERE status = 'open';

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions own read" ON public.cash_sessions;
CREATE POLICY "sessions own read" ON public.cash_sessions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "sessions admin read" ON public.cash_sessions;
CREATE POLICY "sessions admin read" ON public.cash_sessions
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- Add columns to sales
ALTER TABLE public.sales
  ADD COLUMN session_id uuid REFERENCES public.cash_sessions(id),
  ADD COLUMN payment_method text NOT NULL DEFAULT 'cash';

CREATE INDEX IF NOT EXISTS sales_session_id_idx ON public.sales(session_id);

-- Open shift
CREATE OR REPLACE FUNCTION public.open_shift(_opening_cash numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_name text;
  _session_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF EXISTS (SELECT 1 FROM public.cash_sessions WHERE user_id = auth.uid() AND status = 'open') THEN
    RAISE EXCEPTION 'You already have an open shift';
  END IF;

  SELECT coalesce(full_name, username, 'Cashier') INTO _user_name
  FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.cash_sessions(user_id, user_name, opening_cash, expected_cash, status)
  VALUES (auth.uid(), coalesce(_user_name, ''), _opening_cash, _opening_cash, 'open')
  RETURNING id INTO _session_id;

  RETURN jsonb_build_object('session_id', _session_id);
END;
$$;

-- Close shift
CREATE OR REPLACE FUNCTION public.close_shift(_closing_cash numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _session_id uuid;
  _opening numeric;
  _cash_sales numeric;
  _expected numeric;
  _diff numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id, opening_cash INTO _session_id, _opening
  FROM public.cash_sessions
  WHERE user_id = auth.uid() AND status = 'open'
  FOR UPDATE;

  IF _session_id IS NULL THEN RAISE EXCEPTION 'No open shift'; END IF;

  SELECT coalesce(sum(total), 0) INTO _cash_sales
  FROM public.sales
  WHERE session_id = _session_id AND payment_method = 'cash';

  _expected := _opening + _cash_sales;
  _diff := _closing_cash - _expected;

  UPDATE public.cash_sessions
  SET closing_cash = _closing_cash,
      cash_sales = _cash_sales,
      expected_cash = _expected,
      difference = _diff,
      status = 'closed',
      closed_at = now()
  WHERE id = _session_id;

  RETURN jsonb_build_object(
    'session_id', _session_id,
    'opening_cash', _opening,
    'cash_sales', _cash_sales,
    'expected_cash', _expected,
    'closing_cash', _closing_cash,
    'difference', _diff
  );
END;
$$;

-- Get open session with live cash sales
CREATE OR REPLACE FUNCTION public.get_open_session()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s record;
  _cash_sales numeric;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _s FROM public.cash_sessions
  WHERE user_id = auth.uid() AND status = 'open' LIMIT 1;

  IF _s.id IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(sum(total), 0) INTO _cash_sales
  FROM public.sales
  WHERE session_id = _s.id AND payment_method = 'cash';

  RETURN jsonb_build_object(
    'id', _s.id,
    'opening_cash', _s.opening_cash,
    'cash_sales', _cash_sales,
    'expected_cash', _s.opening_cash + _cash_sales,
    'opened_at', _s.opened_at
  );
END;
$$;


-- 7. Suppliers
-- =============================================================

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  bill_no text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'cash',
  notes text NOT NULL DEFAULT '',
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_purchases_supplier ON public.supplier_purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments(supplier_id);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

-- Admin full access
DROP POLICY IF EXISTS "suppliers admin all" ON public.suppliers;
CREATE POLICY "suppliers admin all" ON public.suppliers
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "supplier_purchases admin all" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases admin all" ON public.supplier_purchases
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "supplier_payments admin all" ON public.supplier_payments;
CREATE POLICY "supplier_payments admin all" ON public.supplier_payments
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Cashier read-only
DROP POLICY IF EXISTS "suppliers cashier select" ON public.suppliers;
CREATE POLICY "suppliers cashier select" ON public.suppliers
  FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));

DROP POLICY IF EXISTS "supplier_purchases cashier select" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases cashier select" ON public.supplier_purchases
  FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));

DROP POLICY IF EXISTS "supplier_payments cashier select" ON public.supplier_payments;
CREATE POLICY "supplier_payments cashier select" ON public.supplier_payments
  FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));

DROP TRIGGER IF EXISTS trg_suppliers_updated ON public.suppliers;
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Summary function: returns suppliers with totals (accessible by all authenticated users)
CREATE OR REPLACE FUNCTION public.get_suppliers_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY t.name), '[]'::jsonb)
  FROM (
    SELECT s.id, s.name, s.phone, s.address, s.notes,
      coalesce((SELECT sum(amount) FROM public.supplier_purchases WHERE supplier_id = s.id), 0) AS total_purchases,
      coalesce((SELECT sum(amount) FROM public.supplier_payments WHERE supplier_id = s.id), 0) AS total_paid,
      coalesce((SELECT sum(amount) FROM public.supplier_purchases WHERE supplier_id = s.id), 0)
        - coalesce((SELECT sum(amount) FROM public.supplier_payments WHERE supplier_id = s.id), 0) AS balance
    FROM public.suppliers s
    WHERE s.is_active = true
  ) t;
$$;


-- 8. Stock entries
-- =============================================================

create table if not exists public.stock_entries (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  cashier_id uuid not null references auth.users(id),
  cashier_name text not null default '',
  qty integer not null,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.stock_entries enable row level security;
create index if not exists idx_stock_entries_product on public.stock_entries(product_id);
create index if not exists idx_stock_entries_cashier on public.stock_entries(cashier_id);
create index if not exists idx_stock_entries_created on public.stock_entries(created_at desc);

-- RLS for stock entries
drop policy if exists "Cashiers can create stock entries" on public.stock_entries;
create policy "Cashiers can create stock entries" on public.stock_entries
  for insert with check (auth.uid() = cashier_id);

drop policy if exists "Admins can view all stock entries" on public.stock_entries;
create policy "Admins can view all stock entries" on public.stock_entries
  for select using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Cashiers can view their own stock entries" on public.stock_entries;
create policy "Cashiers can view their own stock entries" on public.stock_entries
  for select using (auth.uid() = cashier_id);

-- Function for cashiers to add stock
create or replace function public.add_stock_entry(
  _product_id uuid,
  _qty integer,
  _notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _cashier_name text;
  _entry_id uuid;
  _new_stock integer;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if _qty <= 0 then raise exception 'Quantity must be positive'; end if;

  select coalesce(full_name, username, 'Cashier') into _cashier_name
  from public.profiles where id = auth.uid();

  insert into public.stock_entries(product_id, cashier_id, cashier_name, qty, notes)
  values (_product_id, auth.uid(), coalesce(_cashier_name, ''), _qty, _notes)
  returning id into _entry_id;

  update public.products set stock = stock + _qty where id = _product_id returning stock into _new_stock;

  return jsonb_build_object(
    'entry_id', _entry_id,
    'message', 'Stock entry recorded',
    'new_stock', _new_stock
  );
end;
$$;

revoke execute on function public.add_stock_entry(uuid, integer, text) from public, anon;
grant  execute on function public.add_stock_entry(uuid, integer, text) to authenticated;
