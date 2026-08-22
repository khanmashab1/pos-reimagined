-- POS Management — full schema (all migrations concatenated in order)
-- Run in the SQL editor of the target project, top to bottom.

-- ========================================
-- 20260429130710_791fb1f3-5e59-4a87-9610-0abf0fc43731.sql
-- ========================================

-- Roles enum
create type public.app_role as enum ('admin', 'cashier');

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  username text unique,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- User roles (separate table)
create table public.user_roles (
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
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;

-- Products
create table public.products (
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
create index idx_products_barcode on public.products(barcode);
create index idx_products_name on public.products(name);

-- Sales
create table public.sales (
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
create index idx_sales_created on public.sales(created_at desc);

-- Sale items
create table public.sale_items (
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
create index idx_sale_items_sale on public.sale_items(sale_id);

-- Store settings (single row)
create table public.store_settings (
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
insert into public.store_settings (id) values (1);

-- Bill sequence per day
create table public.bill_sequences (
  date_key text primary key,
  prefix text not null,
  last_seq integer not null default 0
);
alter table public.bill_sequences enable row level security;

-- Function to generate next bill no atomically
create or replace function public.next_bill_no(_prefix text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  _date_key text := to_char(now(), 'YYYYMMDD');
  _key text := _prefix || '-' || _date_key;
  _seq integer;
begin
  insert into public.bill_sequences(date_key, prefix, last_seq)
  values (_key, _prefix, 1)
  on conflict (date_key) do update set last_seq = bill_sequences.last_seq + 1
  returning last_seq into _seq;
  return _prefix || '-' || _date_key || '-' || lpad(_seq::text, 4, '0');
end;
$$;

-- Process sale RPC: creates sale + items + decrements stock atomically
create or replace function public.process_sale(
  _items jsonb,
  _subtotal numeric,
  _tax_amount numeric,
  _discount numeric,
  _total numeric,
  _cash_received numeric,
  _change_returned numeric,
  _payment_type text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  _bill_no text;
  _sale_id uuid;
  _cashier_name text;
  _item jsonb;
  _items_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select coalesce(full_name, username, 'Cashier') into _cashier_name
  from public.profiles where id = auth.uid();

  _bill_no := public.next_bill_no('ZIC');

  insert into public.sales(bill_no, cashier_id, cashier_name, subtotal, tax_amount, discount, total, cash_received, change_returned, payment_type, items_count)
  values (_bill_no, auth.uid(), coalesce(_cashier_name,''), _subtotal, _tax_amount, _discount, _total, _cash_received, _change_returned, _payment_type, 0)
  returning id into _sale_id;

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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Updated_at trigger for products
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

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
insert into public.categories (name) values ('General'), ('Beverages'), ('Snacks'), ('Groceries');


-- ========================================
-- 20260429131422_685ba013-f1a4-45c2-9d78-874c540bf4f8.sql
-- ========================================

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

-- Process return: restore stock, generate return_no, write rows
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

  insert into public.returns(return_no, original_sale_id, original_bill_no, cashier_id, cashier_name, reason, refund_amount, items_count)
  values (_return_no, _sale_id, _bill_no, auth.uid(), coalesce(_cashier_name,''), coalesce(_reason,''), 0, 0)
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

    if (_item->>'product_id') is not null and (_item->>'product_id') <> '' then
      update public.products
        set stock = stock + (_item->>'qty')::int, updated_at = now()
        where id = (_item->>'product_id')::uuid;
    end if;

    _items_count := _items_count + (_item->>'qty')::int;
    _refund := _refund + (_item->>'subtotal')::numeric;
  end loop;

  update public.returns set items_count = _items_count, refund_amount = _refund where id = _return_id;

  return jsonb_build_object('return_id', _return_id, 'return_no', _return_no, 'refund', _refund);
end;
$$;


-- ========================================
-- 20260429132121_b012ae1e-182d-4713-9387-85f602ea7493.sql
-- ========================================

-- 1. Add status & approval fields to returns
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

-- 2. Replace process_return: do NOT restore stock on create
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

-- 3. Approve return: restore stock now (admin only)
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

-- 4. Void return: reverse stock if approved, mark void (admin only)
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

-- 5. Lock down execute privileges on all SECURITY DEFINER functions.
-- Revoke from PUBLIC (which includes anon and authenticated) and only grant to authenticated.
revoke execute on function public.has_role(uuid, app_role) from public, anon;
grant  execute on function public.has_role(uuid, app_role) to authenticated;

revoke execute on function public.get_user_role(uuid) from public, anon;
grant  execute on function public.get_user_role(uuid) to authenticated;

revoke execute on function public.next_bill_no(text) from public, anon, authenticated;
-- next_bill_no is only called from other SECURITY DEFINER functions; nobody else needs it.

revoke execute on function public.process_sale(jsonb, numeric, numeric, numeric, numeric, numeric, numeric, text) from public, anon;
grant  execute on function public.process_sale(jsonb, numeric, numeric, numeric, numeric, numeric, numeric, text) to authenticated;

revoke execute on function public.process_return(uuid, jsonb, text) from public, anon;
grant  execute on function public.process_return(uuid, jsonb, text) to authenticated;

revoke execute on function public.approve_return(uuid) from public, anon;
grant  execute on function public.approve_return(uuid) to authenticated;

revoke execute on function public.void_return(uuid, text) from public, anon;
grant  execute on function public.void_return(uuid, text) to authenticated;

-- handle_new_user runs from trigger context, no API exposure needed
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- touch_updated_at is just a trigger helper
revoke execute on function public.touch_updated_at() from public, anon, authenticated;


-- ========================================
-- 20260429132306_3acc106f-74b4-4e2c-9d98-7f7bcb2fdf37.sql
-- ========================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin new.updated_at = now(); return new; end;
$$;


-- ========================================
-- 20260429133208_162ca84b-8d9d-4306-b52b-9dbb73b28619.sql
-- ========================================
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

revoke execute on function public.get_admin_dashboard_summary(timestamptz, integer) from public, anon;
grant execute on function public.get_admin_dashboard_summary(timestamptz, integer) to authenticated;
revoke execute on function public.get_admin_inventory_summary() from public, anon;
grant execute on function public.get_admin_inventory_summary() to authenticated;

-- ========================================
-- 20260429133232_fd3e1d35-7462-40a9-8a28-c3072ee49c28.sql
-- ========================================
alter function public.get_admin_dashboard_summary(timestamptz, integer) security invoker;
alter function public.get_admin_inventory_summary() security invoker;

revoke execute on function public.get_admin_dashboard_summary(timestamptz, integer) from public, anon;
grant execute on function public.get_admin_dashboard_summary(timestamptz, integer) to authenticated;
revoke execute on function public.get_admin_inventory_summary() from public, anon;
grant execute on function public.get_admin_inventory_summary() to authenticated;

-- ========================================
-- 20260503055344_48531182-0843-4af3-be71-071875aab128.sql
-- ========================================

-- Cash sessions table
CREATE TABLE public.cash_sessions (
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
CREATE UNIQUE INDEX cash_sessions_one_open_per_user
  ON public.cash_sessions(user_id) WHERE status = 'open';

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions own read" ON public.cash_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "sessions admin read" ON public.cash_sessions
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- Add columns to sales
ALTER TABLE public.sales
  ADD COLUMN session_id uuid REFERENCES public.cash_sessions(id),
  ADD COLUMN payment_method text NOT NULL DEFAULT 'cash';

CREATE INDEX sales_session_id_idx ON public.sales(session_id);

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

-- Update process_sale to require open session and store session_id + payment_method
CREATE OR REPLACE FUNCTION public.process_sale(
  _items jsonb, _subtotal numeric, _tax_amount numeric, _discount numeric,
  _total numeric, _cash_received numeric, _change_returned numeric, _payment_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _bill_no text;
  _sale_id uuid;
  _cashier_name text;
  _session_id uuid;
  _payment_method text;
  _item jsonb;
  _items_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id INTO _session_id FROM public.cash_sessions
  WHERE user_id = auth.uid() AND status = 'open' LIMIT 1;

  IF _session_id IS NULL THEN
    RAISE EXCEPTION 'No open shift. Please start a shift before making sales.';
  END IF;

  _payment_method := CASE WHEN lower(coalesce(_payment_type,'cash')) = 'card' THEN 'card' ELSE 'cash' END;

  SELECT coalesce(full_name, username, 'Cashier') INTO _cashier_name
  FROM public.profiles WHERE id = auth.uid();

  _bill_no := public.next_bill_no('ZIC');

  INSERT INTO public.sales(bill_no, cashier_id, cashier_name, subtotal, tax_amount, discount, total,
    cash_received, change_returned, payment_type, items_count, session_id, payment_method)
  VALUES (_bill_no, auth.uid(), coalesce(_cashier_name,''), _subtotal, _tax_amount, _discount, _total,
    _cash_received, _change_returned, _payment_type, 0, _session_id, _payment_method)
  RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    INSERT INTO public.sale_items(sale_id, product_id, product_name, barcode, qty, unit_price, purchase_price, subtotal)
    VALUES (
      _sale_id,
      (_item->>'product_id')::uuid,
      _item->>'product_name',
      coalesce(_item->>'barcode',''),
      (_item->>'qty')::int,
      (_item->>'unit_price')::numeric,
      coalesce((_item->>'purchase_price')::numeric, 0),
      (_item->>'subtotal')::numeric
    );

    UPDATE public.products
      SET stock = stock - (_item->>'qty')::int, updated_at = now()
      WHERE id = (_item->>'product_id')::uuid;

    _items_count := _items_count + (_item->>'qty')::int;
  END LOOP;

  UPDATE public.sales SET items_count = _items_count WHERE id = _sale_id;

  RETURN jsonb_build_object('sale_id', _sale_id, 'bill_no', _bill_no);
END;
$$;


-- ========================================
-- 20260504112840_0de8af9e-2b2f-4e02-b7d2-429a347d4e27.sql
-- ========================================
DELETE FROM public.return_items;
DELETE FROM public.returns;
DELETE FROM public.sale_items;
DELETE FROM public.sales;
DELETE FROM public.cash_sessions;
DELETE FROM public.products;
DELETE FROM public.categories;
DELETE FROM public.bill_sequences;

-- ========================================
-- 20260505040704_48fcf43d-93d1-4a9e-a9c4-80f0e8d98657.sql
-- ========================================
CREATE OR REPLACE FUNCTION public.next_bill_no(_prefix text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _date_key text := to_char(now(), 'YYYYMMDD');
  _key text := _prefix || '-' || _date_key;
  _seq integer;
  _max_existing integer;
begin
  -- Find max existing seq for today (handles imported data)
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
$function$;

-- ========================================
-- 20260506090247_4d83a1b3-402b-4b85-9b67-133dbeb79189.sql
-- ========================================

-- Suppliers
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Purchases (free-text bills from supplier)
CREATE TABLE public.supplier_purchases (
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

-- Payments to supplier
CREATE TABLE public.supplier_payments (
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

CREATE INDEX idx_supplier_purchases_supplier ON public.supplier_purchases(supplier_id);
CREATE INDEX idx_supplier_payments_supplier ON public.supplier_payments(supplier_id);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

-- Admin only
CREATE POLICY "suppliers admin all" ON public.suppliers
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "supplier_purchases admin all" ON public.supplier_purchases
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "supplier_payments admin all" ON public.supplier_payments
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Summary function: returns suppliers with totals
CREATE OR REPLACE FUNCTION public.get_suppliers_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN NOT public.has_role(auth.uid(), 'admin') THEN '[]'::jsonb
    ELSE coalesce(jsonb_agg(row_to_json(t) ORDER BY t.name), '[]'::jsonb)
  END
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


-- ========================================
-- 20260507121000_add_stock_entries.sql
-- ========================================
-- Stock entries table for tracking stock additions by cashiers
create table public.stock_entries (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  cashier_id uuid not null references auth.users(id),
  cashier_name text not null default '',
  qty integer not null,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.stock_entries enable row level security;
create index idx_stock_entries_product on public.stock_entries(product_id);
create index idx_stock_entries_cashier on public.stock_entries(cashier_id);
create index idx_stock_entries_created on public.stock_entries(created_at desc);

-- RLS for stock entries
create policy "Cashiers can create stock entries" on public.stock_entries
  for insert with check (auth.uid() = cashier_id);

create policy "Admins can view all stock entries" on public.stock_entries
  for select using (public.has_role(auth.uid(), 'admin'));

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

  -- Create stock entry record
  insert into public.stock_entries(product_id, cashier_id, cashier_name, qty, notes)
  values (_product_id, auth.uid(), coalesce(_cashier_name, ''), _qty, _notes)
  returning id into _entry_id;

  -- Update product stock
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


-- ========================================
-- 20260515000000_allow_cashier_supplier_read.sql
-- ========================================
-- Allow cashiers to read suppliers (but not write)
CREATE POLICY "suppliers cashier select" ON public.suppliers
  FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));

CREATE POLICY "supplier_purchases cashier select" ON public.supplier_purchases
  FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));

CREATE POLICY "supplier_payments cashier select" ON public.supplier_payments
  FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));

-- Update summary function to allow cashiers to see data
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


-- ========================================
-- 20260601111735_663276b6-ba50-4fba-a8f2-bd2235cac392.sql
-- ========================================
CREATE POLICY "prod cashier insert"
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'cashier') OR public.has_role(auth.uid(), 'admin')
);

-- ========================================
-- 20260601112602_a2d17eb3-4ad1-444d-84b6-5b8a5d4c3931.sql
-- ========================================
CREATE TABLE public.stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  cashier_id uuid NOT NULL,
  cashier_name text NOT NULL DEFAULT '',
  qty integer NOT NULL CHECK (qty > 0),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.stock_entries TO authenticated;
GRANT ALL ON public.stock_entries TO service_role;

ALTER TABLE public.stock_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_entries admin read" ON public.stock_entries
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "stock_entries own read" ON public.stock_entries
  FOR SELECT USING (auth.uid() = cashier_id);

CREATE POLICY "stock_entries cashier insert" ON public.stock_entries
  FOR INSERT WITH CHECK (
    auth.uid() = cashier_id AND
    (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE INDEX idx_stock_entries_product ON public.stock_entries(product_id);
CREATE INDEX idx_stock_entries_cashier ON public.stock_entries(cashier_id);
CREATE INDEX idx_stock_entries_created ON public.stock_entries(created_at DESC);

CREATE OR REPLACE FUNCTION public.add_stock_entry(
  _product_id uuid, _qty integer, _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _name text;
  _entry_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (has_role(_uid, 'cashier'::app_role) OR has_role(_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;

  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;

  INSERT INTO public.stock_entries (product_id, cashier_id, cashier_name, qty, notes)
  VALUES (_product_id, _uid, COALESCE(_name, ''), _qty, COALESCE(_notes, ''))
  RETURNING id INTO _entry_id;

  UPDATE public.products SET stock = stock + _qty, updated_at = now() WHERE id = _product_id;

  RETURN _entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_stock_entry(uuid, integer, text) TO authenticated;


-- ========================================
-- 20260602000000_stock_entry_approval.sql
-- ========================================

-- 1. Add status & approval fields to stock_entries
alter table public.stock_entries add column if not exists status text not null default 'pending';
alter table public.stock_entries add column if not exists approved_by uuid;
alter table public.stock_entries add column if not exists approved_by_name text;
alter table public.stock_entries add column if not exists approved_at timestamptz;
alter table public.stock_entries add column if not exists rejected_by uuid;
alter table public.stock_entries add column if not exists rejected_by_name text;
alter table public.stock_entries add column if not exists rejected_at timestamptz;
alter table public.stock_entries add column if not exists rejection_reason text;

-- Constrain status values
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stock_entries_status_check') then
    alter table public.stock_entries add constraint stock_entries_status_check
      check (status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

-- 2. Replace add_stock_entry: do NOT update stock on create, set pending
drop function if exists public.add_stock_entry(uuid, integer, text);
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
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if _qty <= 0 then raise exception 'Quantity must be positive'; end if;

  select coalesce(full_name, username, 'Cashier') into _cashier_name
  from public.profiles where id = auth.uid();

  -- Create stock entry record (pending approval, no stock change yet)
  insert into public.stock_entries(product_id, cashier_id, cashier_name, qty, notes, status)
  values (_product_id, auth.uid(), coalesce(_cashier_name, ''), _qty, _notes, 'pending')
  returning id into _entry_id;

  return jsonb_build_object(
    'entry_id', _entry_id,
    'message', 'Stock entry submitted for admin approval',
    'status', 'pending'
  );
end;
$$;

-- 3. Approve stock entry: update product stock now (admin only)
create or replace function public.approve_stock_entry(_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _status text;
  _approver text;
  _product_id uuid;
  _qty integer;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can approve stock entries';
  end if;

  select status, product_id, qty into _status, _product_id, _qty
  from public.stock_entries where id = _entry_id for update;
  if _status is null then raise exception 'Stock entry not found'; end if;
  if _status <> 'pending' then raise exception 'Only pending entries can be approved'; end if;

  select coalesce(full_name, username, 'Admin') into _approver
  from public.profiles where id = auth.uid();

  -- Update product stock
  update public.products set stock = stock + _qty, updated_at = now() where id = _product_id;

  -- Mark as approved
  update public.stock_entries
    set status = 'approved',
        approved_by = auth.uid(),
        approved_by_name = coalesce(_approver, ''),
        approved_at = now()
    where id = _entry_id;

  return jsonb_build_object('entry_id', _entry_id, 'status', 'approved');
end;
$$;

-- 4. Reject stock entry: mark rejected, no stock change (admin only)
create or replace function public.reject_stock_entry(_entry_id uuid, _reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _status text;
  _rejecter text;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can reject stock entries';
  end if;

  select status into _status from public.stock_entries where id = _entry_id for update;
  if _status is null then raise exception 'Stock entry not found'; end if;
  if _status <> 'pending' then raise exception 'Only pending entries can be rejected'; end if;

  select coalesce(full_name, username, 'Admin') into _rejecter
  from public.profiles where id = auth.uid();

  update public.stock_entries
    set status = 'rejected',
        rejected_by = auth.uid(),
        rejected_by_name = coalesce(_rejecter, ''),
        rejected_at = now(),
        rejection_reason = coalesce(_reason, '')
    where id = _entry_id;

  return jsonb_build_object('entry_id', _entry_id, 'status', 'rejected');
end;
$$;

-- 5. Lock down execute privileges
revoke execute on function public.add_stock_entry(uuid, integer, text) from public, anon;
grant  execute on function public.add_stock_entry(uuid, integer, text) to authenticated;

revoke execute on function public.approve_stock_entry(uuid) from public, anon;
grant  execute on function public.approve_stock_entry(uuid) to authenticated;

revoke execute on function public.reject_stock_entry(uuid, text) from public, anon;
grant  execute on function public.reject_stock_entry(uuid, text) to authenticated;


-- ========================================
-- 20260602150322_aa2d566c-7ead-4f31-94fa-73497409a39f.sql
-- ========================================

-- ============ product_units ============
CREATE TABLE public.product_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name text NOT NULL,
  equals_base integer NOT NULL CHECK (equals_base > 0),
  is_base boolean NOT NULL DEFAULT false,
  is_default_sale boolean NOT NULL DEFAULT false,
  sku text,
  barcode text,
  purchase_price numeric NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  sale_price numeric NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_units_name_uniq ON public.product_units (product_id, lower(name));
CREATE UNIQUE INDEX product_units_barcode_uniq ON public.product_units (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX product_units_product_idx ON public.product_units (product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_units TO authenticated;
GRANT ALL ON public.product_units TO service_role;

ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "punits read" ON public.product_units FOR SELECT TO authenticated USING (true);
CREATE POLICY "punits admin write" ON public.product_units FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "punits cashier insert" ON public.product_units FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER product_units_touch BEFORE UPDATE ON public.product_units
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ products.base_unit_id ============
ALTER TABLE public.products ADD COLUMN base_unit_id uuid REFERENCES public.product_units(id);

-- ============ backfill: 1 base unit per existing product ============
WITH ins AS (
  INSERT INTO public.product_units (product_id, name, equals_base, is_base, is_default_sale, barcode, purchase_price, sale_price, sort_order)
  SELECT p.id, 'Piece', 1, true, true, p.barcode, p.purchase_price, p.sale_price, 0
  FROM public.products p
  RETURNING id, product_id
)
UPDATE public.products p SET base_unit_id = ins.id FROM ins WHERE ins.product_id = p.id;

-- The base unit's barcode duplicates the product barcode; clear it on the unit row to keep the
-- unique index on product_units.barcode happy. Product-level barcode remains the scan source.
UPDATE public.product_units SET barcode = NULL WHERE is_base = true;

-- ============ sale_items: unit columns ============
ALTER TABLE public.sale_items
  ADD COLUMN unit_id uuid REFERENCES public.product_units(id),
  ADD COLUMN unit_name text,
  ADD COLUMN qty_in_unit numeric;

-- ============ inventory_movements ============
CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.product_units(id),
  unit_name text NOT NULL DEFAULT '',
  qty_in_unit numeric NOT NULL,
  qty_in_base integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sale','return','restock','initial','adjustment')),
  ref_id uuid,
  user_id uuid,
  user_name text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inv_mov_product_idx ON public.inventory_movements (product_id, created_at DESC);

GRANT SELECT, INSERT ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inv_mov admin read" ON public.inventory_movements FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "inv_mov own read" ON public.inventory_movements FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "inv_mov insert" ON public.inventory_movements FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));

-- ============ save_product_with_units ============
CREATE OR REPLACE FUNCTION public.save_product_with_units(
  _product jsonb,
  _units jsonb,
  _initial_stock jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pid uuid;
  _is_new boolean := false;
  _base_id uuid;
  _u jsonb;
  _new_unit_id uuid;
  _bases_count int;
  _init_unit uuid;
  _init_qty int;
  _init_base int;
  _init_equals int;
  _name text;
BEGIN
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'cashier'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  _pid := NULLIF(_product->>'id','')::uuid;

  -- Validate units
  IF _units IS NULL OR jsonb_array_length(_units) = 0 THEN
    RAISE EXCEPTION 'At least one unit is required';
  END IF;
  SELECT count(*) INTO _bases_count FROM jsonb_array_elements(_units) u WHERE (u->>'is_base')::boolean = true;
  IF _bases_count <> 1 THEN RAISE EXCEPTION 'Exactly one base unit is required'; END IF;

  IF _pid IS NULL THEN
    _is_new := true;
    INSERT INTO public.products (name, barcode, category_id, purchase_price, sale_price, stock, min_stock_alert, is_active)
    VALUES (
      _product->>'name',
      _product->>'barcode',
      NULLIF(_product->>'category_id','')::uuid,
      COALESCE((_product->>'purchase_price')::numeric, 0),
      COALESCE((_product->>'sale_price')::numeric, 0),
      0,
      COALESCE((_product->>'min_stock_alert')::int, 5),
      COALESCE((_product->>'is_active')::boolean, true)
    ) RETURNING id INTO _pid;
  ELSE
    UPDATE public.products SET
      name = _product->>'name',
      barcode = _product->>'barcode',
      category_id = NULLIF(_product->>'category_id','')::uuid,
      purchase_price = COALESCE((_product->>'purchase_price')::numeric, purchase_price),
      sale_price = COALESCE((_product->>'sale_price')::numeric, sale_price),
      min_stock_alert = COALESCE((_product->>'min_stock_alert')::int, min_stock_alert),
      is_active = COALESCE((_product->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = _pid;
  END IF;

  -- Replace units (delete those not in payload, upsert the rest)
  DELETE FROM public.product_units
  WHERE product_id = _pid
    AND id NOT IN (
      SELECT NULLIF(x->>'id','')::uuid FROM jsonb_array_elements(_units) x
      WHERE NULLIF(x->>'id','') IS NOT NULL
    );

  FOR _u IN SELECT * FROM jsonb_array_elements(_units) LOOP
    IF NULLIF(_u->>'id','') IS NOT NULL THEN
      UPDATE public.product_units SET
        name = _u->>'name',
        equals_base = (_u->>'equals_base')::int,
        is_base = (_u->>'is_base')::boolean,
        is_default_sale = COALESCE((_u->>'is_default_sale')::boolean, false),
        sku = NULLIF(_u->>'sku',''),
        barcode = NULLIF(_u->>'barcode',''),
        purchase_price = COALESCE((_u->>'purchase_price')::numeric, 0),
        sale_price = COALESCE((_u->>'sale_price')::numeric, 0),
        sort_order = COALESCE((_u->>'sort_order')::int, 0),
        updated_at = now()
      WHERE id = (_u->>'id')::uuid AND product_id = _pid
      RETURNING id INTO _new_unit_id;
    ELSE
      INSERT INTO public.product_units(product_id, name, equals_base, is_base, is_default_sale, sku, barcode, purchase_price, sale_price, sort_order)
      VALUES (
        _pid, _u->>'name', (_u->>'equals_base')::int,
        (_u->>'is_base')::boolean, COALESCE((_u->>'is_default_sale')::boolean, false),
        NULLIF(_u->>'sku',''), NULLIF(_u->>'barcode',''),
        COALESCE((_u->>'purchase_price')::numeric, 0),
        COALESCE((_u->>'sale_price')::numeric, 0),
        COALESCE((_u->>'sort_order')::int, 0)
      ) RETURNING id INTO _new_unit_id;
    END IF;

    IF (_u->>'is_base')::boolean THEN _base_id := _new_unit_id; END IF;
  END LOOP;

  UPDATE public.products SET base_unit_id = _base_id WHERE id = _pid;

  -- Initial stock (optional, only on create or when explicitly supplied)
  IF _initial_stock IS NOT NULL AND (_initial_stock->>'qty') IS NOT NULL THEN
    _init_unit := (_initial_stock->>'unit_id')::uuid;
    _init_qty := (_initial_stock->>'qty')::int;
    IF _init_qty > 0 AND _init_unit IS NOT NULL THEN
      SELECT equals_base, name INTO _init_equals, _name FROM public.product_units WHERE id = _init_unit;
      IF _init_equals IS NULL THEN RAISE EXCEPTION 'Initial stock unit not found'; END IF;
      _init_base := _init_qty * _init_equals;
      UPDATE public.products SET stock = stock + _init_base, updated_at = now() WHERE id = _pid;
      INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, user_id, user_name)
      VALUES (_pid, _init_unit, _name, _init_qty, _init_base, 'initial', auth.uid(),
        COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), ''));
    END IF;
  END IF;

  RETURN _pid;
END;
$$;

-- ============ process_sale_v2 ============
CREATE OR REPLACE FUNCTION public.process_sale_v2(
  _items jsonb, _subtotal numeric, _tax_amount numeric, _discount numeric, _total numeric,
  _cash_received numeric, _change_returned numeric, _payment_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _bill_no text;
  _sale_id uuid;
  _cashier_name text;
  _session_id uuid;
  _payment_method text;
  _item jsonb;
  _items_count int := 0;
  _unit_equals int;
  _unit_name text;
  _qty_base int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO _session_id FROM public.cash_sessions WHERE user_id = auth.uid() AND status = 'open' LIMIT 1;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'No open shift. Please start a shift before making sales.'; END IF;

  _payment_method := CASE WHEN lower(coalesce(_payment_type,'cash')) = 'card' THEN 'card' ELSE 'cash' END;
  SELECT coalesce(full_name, username, 'Cashier') INTO _cashier_name FROM public.profiles WHERE id = auth.uid();
  _bill_no := public.next_bill_no('ZIC');

  INSERT INTO public.sales(bill_no, cashier_id, cashier_name, subtotal, tax_amount, discount, total,
    cash_received, change_returned, payment_type, items_count, session_id, payment_method)
  VALUES (_bill_no, auth.uid(), coalesce(_cashier_name,''), _subtotal, _tax_amount, _discount, _total,
    _cash_received, _change_returned, _payment_type, 0, _session_id, _payment_method)
  RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    -- Resolve unit (fall back to product base unit if unit_id missing)
    IF NULLIF(_item->>'unit_id','') IS NOT NULL THEN
      SELECT equals_base, name INTO _unit_equals, _unit_name
      FROM public.product_units WHERE id = (_item->>'unit_id')::uuid;
    END IF;
    IF _unit_equals IS NULL THEN
      SELECT pu.equals_base, pu.name INTO _unit_equals, _unit_name
      FROM public.products p LEFT JOIN public.product_units pu ON pu.id = p.base_unit_id
      WHERE p.id = (_item->>'product_id')::uuid;
      _unit_equals := COALESCE(_unit_equals, 1);
      _unit_name := COALESCE(_unit_name, 'Piece');
    END IF;
    _qty_base := (_item->>'qty')::int * _unit_equals;

    INSERT INTO public.sale_items(sale_id, product_id, product_name, barcode, qty, unit_price, purchase_price, subtotal,
                                  unit_id, unit_name, qty_in_unit)
    VALUES (
      _sale_id, (_item->>'product_id')::uuid, _item->>'product_name', coalesce(_item->>'barcode',''),
      _qty_base,  -- qty stored in base units for backward compat with reports
      (_item->>'unit_price')::numeric / _unit_equals,  -- per-base-unit price
      coalesce((_item->>'purchase_price')::numeric, 0),
      (_item->>'subtotal')::numeric,
      NULLIF(_item->>'unit_id','')::uuid, _unit_name, (_item->>'qty')::numeric
    );

    UPDATE public.products SET stock = stock - _qty_base, updated_at = now()
    WHERE id = (_item->>'product_id')::uuid;

    INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, ref_id, user_id, user_name)
    VALUES ((_item->>'product_id')::uuid, NULLIF(_item->>'unit_id','')::uuid, _unit_name,
            (_item->>'qty')::numeric, -_qty_base, 'sale', _sale_id, auth.uid(), coalesce(_cashier_name,''));

    _items_count := _items_count + _qty_base;
    _unit_equals := NULL;
  END LOOP;

  UPDATE public.sales SET items_count = _items_count WHERE id = _sale_id;
  RETURN jsonb_build_object('sale_id', _sale_id, 'bill_no', _bill_no);
END;
$$;

-- ============ add_stock_entry_v2 ============
CREATE OR REPLACE FUNCTION public.add_stock_entry_v2(
  _product_id uuid, _unit_id uuid, _qty integer, _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _name text;
  _unit_equals int;
  _unit_name text;
  _entry_id uuid;
  _qty_base int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (has_role(_uid, 'cashier'::app_role) OR has_role(_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;

  IF _unit_id IS NOT NULL THEN
    SELECT equals_base, name INTO _unit_equals, _unit_name FROM public.product_units WHERE id = _unit_id AND product_id = _product_id;
  END IF;
  IF _unit_equals IS NULL THEN
    SELECT pu.equals_base, pu.name INTO _unit_equals, _unit_name
    FROM public.products p LEFT JOIN public.product_units pu ON pu.id = p.base_unit_id WHERE p.id = _product_id;
    _unit_equals := COALESCE(_unit_equals, 1); _unit_name := COALESCE(_unit_name, 'Piece');
  END IF;
  _qty_base := _qty * _unit_equals;

  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;

  INSERT INTO public.stock_entries (product_id, cashier_id, cashier_name, qty, notes)
  VALUES (_product_id, _uid, COALESCE(_name,''), _qty_base, COALESCE(_notes,''))
  RETURNING id INTO _entry_id;

  UPDATE public.products SET stock = stock + _qty_base, updated_at = now() WHERE id = _product_id;

  INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, ref_id, user_id, user_name, notes)
  VALUES (_product_id, _unit_id, _unit_name, _qty, _qty_base, 'restock', _entry_id, _uid, COALESCE(_name,''), COALESCE(_notes,''));

  RETURN _entry_id;
END;
$$;

-- ============ get_unit_breakdown ============
CREATE OR REPLACE FUNCTION public.get_unit_breakdown(_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  _stock int;
  _u record;
  _count int;
  _result jsonb := '[]'::jsonb;
BEGIN
  SELECT stock INTO _stock FROM public.products WHERE id = _product_id;
  IF _stock IS NULL THEN RETURN _result; END IF;
  FOR _u IN
    SELECT id, name, equals_base FROM public.product_units
    WHERE product_id = _product_id ORDER BY equals_base DESC, sort_order ASC
  LOOP
    _count := _stock / _u.equals_base;
    _stock := _stock - _count * _u.equals_base;
    IF _count > 0 OR _u.equals_base = 1 THEN
      _result := _result || jsonb_build_object('unit_id', _u.id, 'name', _u.name, 'equals_base', _u.equals_base, 'count', _count);
    END IF;
  END LOOP;
  RETURN _result;
END;
$$;


-- ========================================
-- 20260602200000_admin_edit_shifts.sql
-- ========================================

-- Allow admins to update cash sessions (edit shift details)
CREATE POLICY "sessions admin update" ON public.cash_sessions
  FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Admin function to update shift fields
create or replace function public.admin_update_shift(
  _session_id uuid,
  _opening_cash numeric default null,
  _closing_cash numeric default null,
  _cash_sales numeric default null,
  _expected_cash numeric default null,
  _difference numeric default null,
  _user_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _existing record;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can edit shifts';
  end if;

  select * into _existing from public.cash_sessions where id = _session_id;
  if _existing.id is null then raise exception 'Shift not found'; end if;

  update public.cash_sessions
    set opening_cash = coalesce(_opening_cash, _existing.opening_cash),
        closing_cash = coalesce(_closing_cash, _existing.closing_cash),
        cash_sales = coalesce(_cash_sales, _existing.cash_sales),
        expected_cash = coalesce(_expected_cash, _existing.expected_cash),
        difference = coalesce(_difference, _existing.difference),
        user_name = coalesce(_user_name, _existing.user_name)
    where id = _session_id;

  return jsonb_build_object('session_id', _session_id, 'status', 'updated');
end;
$$;

revoke execute on function public.admin_update_shift(uuid, numeric, numeric, numeric, numeric, numeric, text) from public, anon;
grant  execute on function public.admin_update_shift(uuid, numeric, numeric, numeric, numeric, numeric, text) to authenticated;


-- ========================================
-- 20260603000000_shift_online_and_payouts.sql
-- ========================================
-- Shift online totals (grouped) + supplier cash payouts affecting the drawer.
-- Re-runnable. NOTE: card 2% surcharge is NOT in sales.total (display-only),
-- so online_sales is intentionally surcharge-free, matching the cash drawer.

ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS online_sales  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_paid_out numeric NOT NULL DEFAULT 0;

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.cash_sessions(id);
CREATE INDEX IF NOT EXISTS supplier_payments_session_id_idx
  ON public.supplier_payments(session_id);

-- get_open_session: live cash + online + paid-out + expected
CREATE OR REPLACE FUNCTION public.get_open_session()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s record; _cash_sales numeric; _online_sales numeric; _paid_out numeric;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _s FROM public.cash_sessions
   WHERE user_id = auth.uid() AND status = 'open' LIMIT 1;
  IF _s.id IS NULL THEN RETURN NULL; END IF;

  SELECT
    coalesce(sum(total) FILTER (WHERE lower(trim(coalesce(payment_type,'cash'))) =  'cash'), 0),
    coalesce(sum(total) FILTER (WHERE lower(trim(coalesce(payment_type,'cash'))) <> 'cash'), 0)
  INTO _cash_sales, _online_sales
  FROM public.sales WHERE session_id = _s.id;

  SELECT coalesce(sum(amount), 0) INTO _paid_out
  FROM public.supplier_payments
   WHERE session_id = _s.id AND lower(trim(coalesce(method,'cash'))) = 'cash';

  RETURN jsonb_build_object(
    'id', _s.id, 'opening_cash', _s.opening_cash,
    'cash_sales', _cash_sales, 'online_sales', _online_sales,
    'cash_paid_out', _paid_out,
    'expected_cash', _s.opening_cash + _cash_sales - _paid_out,
    'opened_at', _s.opened_at);
END; $$;

-- close_shift: compute + persist all
CREATE OR REPLACE FUNCTION public.close_shift(_closing_cash numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _session_id uuid; _opening numeric; _cash_sales numeric;
        _online_sales numeric; _paid_out numeric; _expected numeric; _diff numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id, opening_cash INTO _session_id, _opening FROM public.cash_sessions
   WHERE user_id = auth.uid() AND status = 'open' FOR UPDATE;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'No open shift'; END IF;

  SELECT
    coalesce(sum(total) FILTER (WHERE lower(trim(coalesce(payment_type,'cash'))) =  'cash'), 0),
    coalesce(sum(total) FILTER (WHERE lower(trim(coalesce(payment_type,'cash'))) <> 'cash'), 0)
  INTO _cash_sales, _online_sales
  FROM public.sales WHERE session_id = _session_id;

  SELECT coalesce(sum(amount), 0) INTO _paid_out
  FROM public.supplier_payments
   WHERE session_id = _session_id AND lower(trim(coalesce(method,'cash'))) = 'cash';

  _expected := _opening + _cash_sales - _paid_out;
  _diff     := _closing_cash - _expected;

  UPDATE public.cash_sessions
     SET closing_cash=_closing_cash, cash_sales=_cash_sales, online_sales=_online_sales,
         cash_paid_out=_paid_out, expected_cash=_expected, difference=_diff,
         status='closed', closed_at=now()
   WHERE id = _session_id;

  RETURN jsonb_build_object('session_id',_session_id,'opening_cash',_opening,
    'cash_sales',_cash_sales,'online_sales',_online_sales,'cash_paid_out',_paid_out,
    'expected_cash',_expected,'closing_cash',_closing_cash,'difference',_diff);
END; $$;

-- record_supplier_payment: definer insert, stamps caller + open session
CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  _supplier_id uuid, _amount numeric, _method text default 'cash',
  _notes text default '', _payment_date date default CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _name text; _session_id uuid; _payment_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (has_role(_uid,'cashier'::app_role) OR has_role(_uid,'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = _supplier_id) THEN
    RAISE EXCEPTION 'Supplier not found'; END IF;

  SELECT coalesce(full_name, username, 'Cashier') INTO _name FROM public.profiles WHERE id = _uid;
  SELECT id INTO _session_id FROM public.cash_sessions
   WHERE user_id = _uid AND status = 'open' LIMIT 1;

  INSERT INTO public.supplier_payments
    (supplier_id, amount, method, notes, payment_date, created_by, created_by_name, session_id)
  VALUES (_supplier_id, _amount, coalesce(_method,'cash'), coalesce(_notes,''),
          coalesce(_payment_date,CURRENT_DATE), _uid, coalesce(_name,''), _session_id)
  RETURNING id INTO _payment_id;

  RETURN jsonb_build_object('payment_id',_payment_id,'session_id',_session_id);
END; $$;

-- admin_update_shift: extend with _online_sales, _cash_paid_out (additive 9-arg overload)
CREATE OR REPLACE FUNCTION public.admin_update_shift(
  _session_id uuid, _opening_cash numeric default null, _closing_cash numeric default null,
  _cash_sales numeric default null, _expected_cash numeric default null,
  _difference numeric default null, _user_name text default null,
  _online_sales numeric default null, _cash_paid_out numeric default null)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _existing record;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Only admins can edit shifts'; END IF;
  SELECT * INTO _existing FROM public.cash_sessions WHERE id = _session_id;
  IF _existing.id IS NULL THEN RAISE EXCEPTION 'Shift not found'; END IF;
  UPDATE public.cash_sessions
     SET opening_cash =coalesce(_opening_cash,_existing.opening_cash),
         closing_cash =coalesce(_closing_cash,_existing.closing_cash),
         cash_sales   =coalesce(_cash_sales,_existing.cash_sales),
         online_sales =coalesce(_online_sales,_existing.online_sales),
         cash_paid_out=coalesce(_cash_paid_out,_existing.cash_paid_out),
         expected_cash=coalesce(_expected_cash,_existing.expected_cash),
         difference   =coalesce(_difference,_existing.difference),
         user_name    =coalesce(_user_name,_existing.user_name)
   WHERE id = _session_id;
  RETURN jsonb_build_object('session_id',_session_id,'status','updated');
END; $$;

REVOKE EXECUTE ON FUNCTION public.record_supplier_payment(uuid,numeric,text,text,date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.record_supplier_payment(uuid,numeric,text,text,date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_shift(uuid,numeric,numeric,numeric,numeric,numeric,text,numeric,numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.admin_update_shift(uuid,numeric,numeric,numeric,numeric,numeric,text,numeric,numeric) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_open_session() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.close_shift(numeric) TO authenticated;

notify pgrst, 'reload schema';


-- ========================================
-- 20260603100000_profit_report.sql
-- ========================================
-- Server-side aggregation for the Profit Calculator.
-- Replaces pulling every sale + sale_item to the browser: this computes the
-- totals, per-product breakdown, and daily trend in one query and returns a
-- compact JSON payload. Re-runnable (CREATE OR REPLACE only).
--
-- Revenue/cost match the prior client logic exactly:
--   revenue = qty * unit_price,  cost = qty * purchase_price,  zero_count = items with purchase_price = 0.
-- Daily buckets use the UTC date to match the old `new Date(created_at).toISOString()` behavior.

CREATE OR REPLACE FUNCTION public.get_profit_report(_from timestamptz, _to timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH li AS (
    SELECT
      coalesce(nullif(si.product_name, ''), 'Unknown')        AS name,
      ((s.created_at AT TIME ZONE 'UTC')::date)               AS d,
      coalesce(si.qty, 0)                                     AS qty,
      coalesce(si.qty, 0) * coalesce(si.unit_price, 0)        AS revenue,
      coalesce(si.qty, 0) * coalesce(si.purchase_price, 0)    AS cost,
      (coalesce(si.purchase_price, 0) = 0)                    AS zero_cost
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.created_at >= _from AND s.created_at <= _to
  ),
  by_product AS (
    SELECT name, sum(qty) AS qty, sum(revenue) AS revenue, sum(cost) AS cost,
           sum(revenue) - sum(cost) AS profit
    FROM li GROUP BY name
  ),
  by_day AS (
    SELECT d, sum(revenue) - sum(cost) AS profit, sum(revenue) AS sales
    FROM li GROUP BY d
  ),
  tot AS (
    SELECT coalesce(sum(revenue), 0) AS revenue,
           coalesce(sum(cost), 0)    AS cost,
           coalesce(sum(CASE WHEN zero_cost THEN 1 ELSE 0 END), 0) AS zero_count
    FROM li
  )
  SELECT jsonb_build_object(
    'total_revenue', (SELECT revenue FROM tot),
    'total_cost',    (SELECT cost FROM tot),
    'total_profit',  (SELECT revenue - cost FROM tot),
    'zero_count',    (SELECT zero_count FROM tot),
    'by_product', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'name', name, 'qty', qty, 'revenue', revenue, 'cost', cost, 'profit', profit,
        'margin', CASE WHEN revenue > 0 THEN (profit / revenue) * 100 ELSE 0 END
      ) ORDER BY profit DESC)
      FROM by_product), '[]'::jsonb),
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(d, 'YYYY-MM-DD'), 'profit', round(profit), 'sales', round(sales)
      ) ORDER BY d)
      FROM by_day), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_profit_report(timestamptz, timestamptz) TO authenticated;

notify pgrst, 'reload schema';


-- ========================================
-- 20260603110000_dashboard_v2.sql
-- ========================================
-- Dashboard v2: extend get_admin_dashboard_summary with cash/online split, gross
-- profit, top cashiers, hourly sales, and a previous-period comparison for trends.
-- Same signature (timestamptz, integer) => clean CREATE OR REPLACE. Re-runnable.

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_summary(_start_at timestamptz, _days integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  _gross numeric := 0;
  _bills integer := 0;
  _refunds numeric := 0;
  _returns_count integer := 0;
  _cash numeric := 0;
  _online numeric := 0;
  _profit numeric := 0;
  _daily jsonb := '[]'::jsonb;
  _top_products jsonb := '[]'::jsonb;
  _margin jsonb := '[]'::jsonb;
  _top_cashiers jsonb := '[]'::jsonb;
  _hourly jsonb := '[]'::jsonb;
  -- previous equal-length window
  _prev_start timestamptz;
  _p_gross numeric := 0;
  _p_bills integer := 0;
  _p_refunds numeric := 0;
  _p_profit numeric := 0;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view dashboard analytics';
  end if;

  _days := greatest(1, least(coalesce(_days, 7), 90));
  _prev_start := _start_at - (now() - _start_at);  -- exact elapsed duration before _start_at

  -- Current-period sales totals + cash/online split
  select coalesce(sum(total), 0), count(*)::int,
         coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) = 'cash'), 0),
         coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) <> 'cash'), 0)
  into _gross, _bills, _cash, _online
  from public.sales
  where created_at >= _start_at;

  select coalesce(sum(refund_amount), 0), count(*)::int
  into _refunds, _returns_count
  from public.returns
  where status = 'approved'
    and coalesce(approved_at, created_at) >= _start_at;

  -- Current-period gross profit (revenue - cost), same basis as margin buckets below
  select coalesce(sum(si.subtotal - (si.purchase_price * si.qty)), 0)
  into _profit
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.created_at >= _start_at;

  -- Daily sales vs refunds
  with day_series as (
    select generate_series(date_trunc('day', _start_at), date_trunc('day', now()), interval '1 day')::date as day
  ), sales_by_day as (
    select date_trunc('day', created_at)::date as day, sum(total) as sales
    from public.sales where created_at >= _start_at group by 1
  ), returns_by_day as (
    select date_trunc('day', coalesce(approved_at, created_at))::date as day, sum(refund_amount) as refunds
    from public.returns
    where status = 'approved' and coalesce(approved_at, created_at) >= _start_at group by 1
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

  -- Top products by qty
  with product_totals as (
    select si.product_name as name, sum(si.qty)::int as qty, sum(si.subtotal) as revenue
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where s.created_at >= _start_at
    group by si.product_name order by sum(si.qty) desc limit 7
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'revenue', revenue)), '[]'::jsonb)
  into _top_products from product_totals;

  -- Margin distribution buckets
  with margin_buckets as (
    select case
      when si.subtotal > 0 and (((si.subtotal - (si.purchase_price * si.qty)) / si.subtotal) * 100) < 10 then 'Low (<10%)'
      when si.subtotal > 0 and (((si.subtotal - (si.purchase_price * si.qty)) / si.subtotal) * 100) < 30 then 'Mid (10-30%)'
      else 'High (>30%)'
    end as name,
    round(sum(si.subtotal)) as value
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where s.created_at >= _start_at and si.subtotal > 0
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'value', value)), '[]'::jsonb)
  into _margin from margin_buckets where value > 0;

  -- Top cashiers by sales
  with cashier_totals as (
    select coalesce(nullif(cashier_name,''), 'Unknown') as name,
           sum(total) as sales, count(*)::int as bills
    from public.sales where created_at >= _start_at
    group by 1 order by sum(total) desc limit 5
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'sales', round(sales), 'bills', bills)
    order by sales desc), '[]'::jsonb)
  into _top_cashiers from cashier_totals;

  -- Sales by hour of day (local Karachi time), zero-filled 0..23
  with hours as (
    select generate_series(0, 23) as hour
  ), sales_by_hour as (
    select extract(hour from (created_at at time zone 'Asia/Karachi'))::int as hour, sum(total) as sales
    from public.sales where created_at >= _start_at group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('hour', h.hour, 'sales', round(coalesce(sh.sales, 0)))
    order by h.hour), '[]'::jsonb)
  into _hourly
  from hours h left join sales_by_hour sh on sh.hour = h.hour;

  -- Previous-period comparison (gross, bills, refunds->net, profit)
  select coalesce(sum(total), 0), count(*)::int
  into _p_gross, _p_bills
  from public.sales where created_at >= _prev_start and created_at < _start_at;

  select coalesce(sum(refund_amount), 0)
  into _p_refunds
  from public.returns
  where status = 'approved'
    and coalesce(approved_at, created_at) >= _prev_start
    and coalesce(approved_at, created_at) < _start_at;

  select coalesce(sum(si.subtotal - (si.purchase_price * si.qty)), 0)
  into _p_profit
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where s.created_at >= _prev_start and s.created_at < _start_at;

  return jsonb_build_object(
    'grossSales', _gross,
    'bills', _bills,
    'refunds', _refunds,
    'net', _gross - _refunds,
    'rate', case when _gross > 0 then (_refunds / _gross) * 100 else 0 end,
    'returnsCount', _returns_count,
    'cashSales', _cash,
    'onlineSales', _online,
    'grossProfit', _profit,
    'daily', _daily,
    'topProducts', _top_products,
    'margin', _margin,
    'topCashiers', _top_cashiers,
    'hourly', _hourly,
    'prev', jsonb_build_object(
      'grossSales', _p_gross,
      'bills', _p_bills,
      'net', _p_gross - _p_refunds,
      'grossProfit', _p_profit
    )
  );
end;
$$;

revoke execute on function public.get_admin_dashboard_summary(timestamptz, integer) from public, anon;
grant  execute on function public.get_admin_dashboard_summary(timestamptz, integer) to authenticated;

notify pgrst, 'reload schema';


-- ========================================
-- 20260603120000_daily_expenses.sql
-- ========================================
-- Daily Expenses Report.
-- Stores only the RAW daily inputs; the derived fields (Previous Expense, Grand
-- Expenses, Total Cash, Grand Total, Previous Total, Profit, Sale) are computed in
-- the app from the date-ordered rows so editing a past date recalculates the chain.

create table if not exists public.daily_expenses (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  cash_junaid numeric not null default 0,
  cash_usama numeric not null default 0,
  others numeric not null default 0,
  counter_cash numeric not null default 0,
  today_expenses numeric not null default 0,
  created_by uuid,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Drop the cash_zahid_ali column if an earlier version of this table was created with it.
alter table public.daily_expenses drop column if exists cash_zahid_ali;

create index if not exists daily_expenses_entry_date_idx on public.daily_expenses(entry_date);

alter table public.daily_expenses enable row level security;

-- Admin-only (this is an admin report page)
drop policy if exists "daily_expenses admin all" on public.daily_expenses;
create policy "daily_expenses admin all" on public.daily_expenses
  for all using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

notify pgrst, 'reload schema';


-- ========================================
-- 20260603130000_cashier_expenses.sql
-- ========================================
-- Cashier expenses: cash handed out from the drawer during a shift (someone
-- receives cash from the cashier). Subtracts from the drawer's expected cash at
-- close, exactly like supplier cash payouts. Re-runnable.

create table if not exists public.shift_expenses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.cash_sessions(id),
  cashier_id uuid,
  cashier_name text not null default '',
  amount numeric not null default 0,
  description text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists shift_expenses_session_id_idx on public.shift_expenses(session_id);

alter table public.shift_expenses enable row level security;

drop policy if exists "shift_expenses select own" on public.shift_expenses;
create policy "shift_expenses select own" on public.shift_expenses
  for select using (cashier_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "shift_expenses admin all" on public.shift_expenses;
create policy "shift_expenses admin all" on public.shift_expenses
  for all using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

-- Persisted snapshot column on the session (like cash_paid_out)
alter table public.cash_sessions add column if not exists expenses numeric not null default 0;

-- Record an expense against the caller's OPEN shift (definer => bypasses RLS on insert)
create or replace function public.record_expense(_amount numeric, _description text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _name text; _session_id uuid; _id uuid;
begin
  if _uid is null then raise exception 'Not authenticated'; end if;
  if not (has_role(_uid, 'cashier'::app_role) or has_role(_uid, 'admin'::app_role)) then
    raise exception 'Not authorized'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Amount must be positive'; end if;

  select id into _session_id from public.cash_sessions
   where user_id = _uid and status = 'open' limit 1;
  if _session_id is null then raise exception 'No open shift — start a shift first'; end if;

  select coalesce(full_name, username, 'Cashier') into _name from public.profiles where id = _uid;

  insert into public.shift_expenses(session_id, cashier_id, cashier_name, amount, description)
  values (_session_id, _uid, coalesce(_name, ''), _amount, coalesce(_description, ''))
  returning id into _id;

  return jsonb_build_object('expense_id', _id, 'session_id', _session_id);
end; $$;

revoke execute on function public.record_expense(numeric, text) from public, anon;
grant  execute on function public.record_expense(numeric, text) to authenticated;

-- get_open_session: also subtract live expenses from expected drawer cash
create or replace function public.get_open_session()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare _s record; _cash_sales numeric; _online_sales numeric; _paid_out numeric; _expenses numeric;
begin
  if auth.uid() is null then return null; end if;
  select * into _s from public.cash_sessions where user_id = auth.uid() and status = 'open' limit 1;
  if _s.id is null then return null; end if;

  select
    coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) =  'cash'), 0),
    coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) <> 'cash'), 0)
  into _cash_sales, _online_sales
  from public.sales where session_id = _s.id;

  select coalesce(sum(amount), 0) into _paid_out
  from public.supplier_payments
   where session_id = _s.id and lower(trim(coalesce(method,'cash'))) = 'cash';

  select coalesce(sum(amount), 0) into _expenses
  from public.shift_expenses where session_id = _s.id;

  return jsonb_build_object(
    'id', _s.id, 'opening_cash', _s.opening_cash,
    'cash_sales', _cash_sales, 'online_sales', _online_sales,
    'cash_paid_out', _paid_out, 'expenses', _expenses,
    'expected_cash', _s.opening_cash + _cash_sales - _paid_out - _expenses,
    'opened_at', _s.opened_at);
end; $$;

-- close_shift: compute + persist expenses, subtract from expected cash
create or replace function public.close_shift(_closing_cash numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _session_id uuid; _opening numeric; _cash_sales numeric;
        _online_sales numeric; _paid_out numeric; _expenses numeric; _expected numeric; _diff numeric;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select id, opening_cash into _session_id, _opening from public.cash_sessions
   where user_id = auth.uid() and status = 'open' for update;
  if _session_id is null then raise exception 'No open shift'; end if;

  select
    coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) =  'cash'), 0),
    coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) <> 'cash'), 0)
  into _cash_sales, _online_sales
  from public.sales where session_id = _session_id;

  select coalesce(sum(amount), 0) into _paid_out
  from public.supplier_payments
   where session_id = _session_id and lower(trim(coalesce(method,'cash'))) = 'cash';

  select coalesce(sum(amount), 0) into _expenses
  from public.shift_expenses where session_id = _session_id;

  _expected := _opening + _cash_sales - _paid_out - _expenses;
  _diff     := _closing_cash - _expected;

  update public.cash_sessions
     set closing_cash=_closing_cash, cash_sales=_cash_sales, online_sales=_online_sales,
         cash_paid_out=_paid_out, expenses=_expenses, expected_cash=_expected, difference=_diff,
         status='closed', closed_at=now()
   where id = _session_id;

  return jsonb_build_object('session_id',_session_id,'opening_cash',_opening,
    'cash_sales',_cash_sales,'online_sales',_online_sales,'cash_paid_out',_paid_out,
    'expenses',_expenses,'expected_cash',_expected,'closing_cash',_closing_cash,'difference',_diff);
end; $$;

grant execute on function public.get_open_session() to authenticated;
grant execute on function public.close_shift(numeric) to authenticated;

notify pgrst, 'reload schema';


-- ========================================
-- 20260603140000_online_by_method.sql
-- ========================================
-- Sum of sales by payment method over a date range, for attributing online
-- payments to people on the Daily Expenses Report (card + easypasa -> Junaid,
-- jazzcash -> Usama). Admin-only. Re-runnable.

create or replace function public.get_online_by_method(_from timestamptz, _to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare _r jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view sales analytics';
  end if;
  select coalesce(jsonb_object_agg(pt, amt), '{}'::jsonb) into _r
  from (
    select lower(trim(coalesce(payment_type, 'cash'))) as pt, sum(total) as amt
    from public.sales
    where created_at >= _from and created_at <= _to
    group by 1
  ) s;
  return _r;
end;
$$;

revoke execute on function public.get_online_by_method(timestamptz, timestamptz) from public, anon;
grant  execute on function public.get_online_by_method(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';


-- ========================================
-- 20260604090629_07d31806-8538-4f5f-b893-5e081e383c49.sql
-- ========================================
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_unit_id_fkey;
ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_unit_id_fkey
  FOREIGN KEY (unit_id) REFERENCES public.product_units(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_unit_id_fkey;
ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_unit_id_fkey
  FOREIGN KEY (unit_id) REFERENCES public.product_units(id) ON DELETE SET NULL;

-- ========================================
-- 20260605154620_ece421bf-02a0-48a6-8e2f-77aa0c6313b2.sql
-- ========================================
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES public.product_units(id);
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS unit_name text;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS qty_in_unit numeric;

ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS approved_by_name text;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS rejected_by uuid;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS rejected_by_name text;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS rejection_reason text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_entries_status_check') THEN
    ALTER TABLE public.stock_entries ADD CONSTRAINT stock_entries_status_check
      CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.add_stock_entry_v2(
  _product_id uuid, _unit_id uuid, _qty integer, _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _name text;
  _unit_equals int;
  _unit_name text;
  _entry_id uuid;
  _qty_base int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (has_role(_uid, 'cashier'::app_role) OR has_role(_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;

  IF _unit_id IS NOT NULL THEN
    SELECT equals_base, name INTO _unit_equals, _unit_name FROM public.product_units WHERE id = _unit_id AND product_id = _product_id;
  END IF;
  IF _unit_equals IS NULL THEN
    SELECT pu.equals_base, pu.name INTO _unit_equals, _unit_name
    FROM public.products p LEFT JOIN public.product_units pu ON pu.id = p.base_unit_id WHERE p.id = _product_id;
    _unit_equals := COALESCE(_unit_equals, 1); _unit_name := COALESCE(_unit_name, 'Piece');
  END IF;
  _qty_base := _qty * _unit_equals;

  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;

  INSERT INTO public.stock_entries (product_id, cashier_id, cashier_name, qty, unit_id, unit_name, qty_in_unit, notes, status)
  VALUES (_product_id, _uid, COALESCE(_name,''), _qty_base, _unit_id, _unit_name, _qty, COALESCE(_notes,''), 'pending')
  RETURNING id INTO _entry_id;

  RETURN _entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_stock_entry(_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _status text;
  _approver text;
  _product_id uuid;
  _qty integer;
  _qty_in_unit numeric;
  _unit_id uuid;
  _unit_name text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can approve stock entries';
  END IF;

  SELECT status, product_id, qty, unit_id, unit_name, qty_in_unit
    INTO _status, _product_id, _qty, _unit_id, _unit_name, _qty_in_unit
  FROM public.stock_entries WHERE id = _entry_id FOR UPDATE;
  IF _status IS NULL THEN RAISE EXCEPTION 'Stock entry not found'; END IF;
  IF _status <> 'pending' THEN RAISE EXCEPTION 'Only pending entries can be approved'; END IF;

  SELECT coalesce(full_name, username, 'Admin') INTO _approver FROM public.profiles WHERE id = auth.uid();

  UPDATE public.products SET stock = stock + _qty, updated_at = now() WHERE id = _product_id;

  INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, ref_id, user_id, user_name, notes)
  VALUES (_product_id, _unit_id, COALESCE(_unit_name,'restock'), COALESCE(_qty_in_unit, _qty), _qty, 'restock', _entry_id, auth.uid(), _approver, 'Approved stock entry');

  UPDATE public.stock_entries
    SET status = 'approved', approved_by = auth.uid(), approved_by_name = coalesce(_approver, ''), approved_at = now()
    WHERE id = _entry_id;

  RETURN jsonb_build_object('entry_id', _entry_id, 'status', 'approved');
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_stock_entry(_entry_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _status text;
  _rejecter text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can reject stock entries';
  END IF;

  SELECT status INTO _status FROM public.stock_entries WHERE id = _entry_id FOR UPDATE;
  IF _status IS NULL THEN RAISE EXCEPTION 'Stock entry not found'; END IF;
  IF _status <> 'pending' THEN RAISE EXCEPTION 'Only pending entries can be rejected'; END IF;

  SELECT coalesce(full_name, username, 'Admin') INTO _rejecter FROM public.profiles WHERE id = auth.uid();

  UPDATE public.stock_entries
    SET status = 'rejected', rejected_by = auth.uid(), rejected_by_name = coalesce(_rejecter, ''),
        rejected_at = now(), rejection_reason = coalesce(_reason, '')
    WHERE id = _entry_id;

  RETURN jsonb_build_object('entry_id', _entry_id, 'status', 'rejected');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_stock_entry_v2(uuid, uuid, integer, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.add_stock_entry_v2(uuid, uuid, integer, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_stock_entry(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.approve_stock_entry(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_stock_entry(uuid, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.reject_stock_entry(uuid, text) TO authenticated;

-- ========================================
-- 20260606000000_stock_entry_fixes.sql
-- ========================================

-- =============================================================================
-- Stock entry fixes + multi-unit columns
-- Only contains changes NOT in the original POS migrations.
-- =============================================================================

-- 1. Add unit columns to stock_entries (if not already there from product_units migration)
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES public.product_units(id);
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS unit_name text;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS qty_in_unit numeric;

-- 2. Add approval columns to stock_entries (if not already there)
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS approved_by_name text;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS rejected_by uuid;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS rejected_by_name text;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS rejection_reason text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_entries_status_check') THEN
    ALTER TABLE public.stock_entries ADD CONSTRAINT stock_entries_status_check
      CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- 3. FIX add_stock_entry_v2: change to use pending approval flow (no immediate stock update)
CREATE OR REPLACE FUNCTION public.add_stock_entry_v2(
  _product_id uuid, _unit_id uuid, _qty integer, _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _name text;
  _unit_equals int;
  _unit_name text;
  _entry_id uuid;
  _qty_base int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (has_role(_uid, 'cashier'::app_role) OR has_role(_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;

  IF _unit_id IS NOT NULL THEN
    SELECT equals_base, name INTO _unit_equals, _unit_name FROM public.product_units WHERE id = _unit_id AND product_id = _product_id;
  END IF;
  IF _unit_equals IS NULL THEN
    SELECT pu.equals_base, pu.name INTO _unit_equals, _unit_name
    FROM public.products p LEFT JOIN public.product_units pu ON pu.id = p.base_unit_id WHERE p.id = _product_id;
    _unit_equals := COALESCE(_unit_equals, 1); _unit_name := COALESCE(_unit_name, 'Piece');
  END IF;
  _qty_base := _qty * _unit_equals;

  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;

  -- Create stock entry in PENDING status — does NOT update product stock yet
  INSERT INTO public.stock_entries (product_id, cashier_id, cashier_name, qty, unit_id, unit_name, qty_in_unit, notes, status)
  VALUES (_product_id, _uid, COALESCE(_name,''), _qty_base, _unit_id, _unit_name, _qty, COALESCE(_notes,''), 'pending')
  RETURNING id INTO _entry_id;

  RETURN _entry_id;
END;
$$;

-- 4. approve_stock_entry — updates stock + records inventory movement
CREATE OR REPLACE FUNCTION public.approve_stock_entry(_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _status text;
  _approver text;
  _product_id uuid;
  _qty integer;
  _qty_in_unit numeric;
  _unit_id uuid;
  _unit_name text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can approve stock entries';
  END IF;

  SELECT status, product_id, qty, unit_id, unit_name, qty_in_unit
    INTO _status, _product_id, _qty, _unit_id, _unit_name, _qty_in_unit
  FROM public.stock_entries WHERE id = _entry_id FOR UPDATE;
  IF _status IS NULL THEN RAISE EXCEPTION 'Stock entry not found'; END IF;
  IF _status <> 'pending' THEN RAISE EXCEPTION 'Only pending entries can be approved'; END IF;

  SELECT coalesce(full_name, username, 'Admin') INTO _approver FROM public.profiles WHERE id = auth.uid();

  -- Update product stock
  UPDATE public.products SET stock = stock + _qty, updated_at = now() WHERE id = _product_id;

  -- Record inventory movement
  INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, ref_id, user_id, user_name, notes)
  VALUES (_product_id, _unit_id, COALESCE(_unit_name,'restock'), COALESCE(_qty_in_unit, _qty), _qty, 'restock', _entry_id, auth.uid(), _approver, 'Approved stock entry');

  UPDATE public.stock_entries
    SET status = 'approved', approved_by = auth.uid(), approved_by_name = coalesce(_approver, ''), approved_at = now()
    WHERE id = _entry_id;

  RETURN jsonb_build_object('entry_id', _entry_id, 'status', 'approved');
END;
$$;

-- 5. reject_stock_entry
CREATE OR REPLACE FUNCTION public.reject_stock_entry(_entry_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _status text;
  _rejecter text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can reject stock entries';
  END IF;

  SELECT status INTO _status FROM public.stock_entries WHERE id = _entry_id FOR UPDATE;
  IF _status IS NULL THEN RAISE EXCEPTION 'Stock entry not found'; END IF;
  IF _status <> 'pending' THEN RAISE EXCEPTION 'Only pending entries can be rejected'; END IF;

  SELECT coalesce(full_name, username, 'Admin') INTO _rejecter FROM public.profiles WHERE id = auth.uid();

  UPDATE public.stock_entries
    SET status = 'rejected', rejected_by = auth.uid(), rejected_by_name = coalesce(_rejecter, ''),
        rejected_at = now(), rejection_reason = coalesce(_reason, '')
    WHERE id = _entry_id;

  RETURN jsonb_build_object('entry_id', _entry_id, 'status', 'rejected');
END;
$$;

-- 6. Secure function permissions
REVOKE EXECUTE ON FUNCTION public.add_stock_entry_v2(uuid, uuid, integer, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.add_stock_entry_v2(uuid, uuid, integer, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_stock_entry(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.approve_stock_entry(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_stock_entry(uuid, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.reject_stock_entry(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ========================================
-- 20260606100000_fix_unit_cost_scaling.sql
-- ========================================
-- FIX: profit was hugely negative because process_sale_v2 stored sale_items.purchase_price
-- as the per-UNIT cost (e.g. a box = 242) while qty is stored in BASE pieces (20). So profit
-- math (qty x purchase_price) counted cost = 20 x 242 instead of 20 x 12.10. Divide
-- purchase_price by equals_base, exactly like unit_price already is. Re-runnable.

CREATE OR REPLACE FUNCTION public.process_sale_v2(
  _items jsonb, _subtotal numeric, _tax_amount numeric, _discount numeric, _total numeric,
  _cash_received numeric, _change_returned numeric, _payment_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _bill_no text;
  _sale_id uuid;
  _cashier_name text;
  _session_id uuid;
  _payment_method text;
  _item jsonb;
  _items_count int := 0;
  _unit_equals int;
  _unit_name text;
  _qty_base int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO _session_id FROM public.cash_sessions WHERE user_id = auth.uid() AND status = 'open' LIMIT 1;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'No open shift. Please start a shift before making sales.'; END IF;

  _payment_method := CASE WHEN lower(coalesce(_payment_type,'cash')) = 'card' THEN 'card' ELSE 'cash' END;
  SELECT coalesce(full_name, username, 'Cashier') INTO _cashier_name FROM public.profiles WHERE id = auth.uid();
  _bill_no := public.next_bill_no('ZIC');

  INSERT INTO public.sales(bill_no, cashier_id, cashier_name, subtotal, tax_amount, discount, total,
    cash_received, change_returned, payment_type, items_count, session_id, payment_method)
  VALUES (_bill_no, auth.uid(), coalesce(_cashier_name,''), _subtotal, _tax_amount, _discount, _total,
    _cash_received, _change_returned, _payment_type, 0, _session_id, _payment_method)
  RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    IF NULLIF(_item->>'unit_id','') IS NOT NULL THEN
      SELECT equals_base, name INTO _unit_equals, _unit_name
      FROM public.product_units WHERE id = (_item->>'unit_id')::uuid;
    END IF;
    IF _unit_equals IS NULL THEN
      SELECT pu.equals_base, pu.name INTO _unit_equals, _unit_name
      FROM public.products p LEFT JOIN public.product_units pu ON pu.id = p.base_unit_id
      WHERE p.id = (_item->>'product_id')::uuid;
      _unit_equals := COALESCE(_unit_equals, 1);
      _unit_name := COALESCE(_unit_name, 'Piece');
    END IF;
    _qty_base := (_item->>'qty')::int * _unit_equals;

    INSERT INTO public.sale_items(sale_id, product_id, product_name, barcode, qty, unit_price, purchase_price, subtotal,
                                  unit_id, unit_name, qty_in_unit)
    VALUES (
      _sale_id, (_item->>'product_id')::uuid, _item->>'product_name', coalesce(_item->>'barcode',''),
      _qty_base,
      (_item->>'unit_price')::numeric / _unit_equals,
      coalesce((_item->>'purchase_price')::numeric, 0) / _unit_equals,   -- FIX: store per-BASE cost
      (_item->>'subtotal')::numeric,
      NULLIF(_item->>'unit_id','')::uuid, _unit_name, (_item->>'qty')::numeric
    );

    UPDATE public.products SET stock = stock - _qty_base, updated_at = now()
    WHERE id = (_item->>'product_id')::uuid;

    INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, ref_id, user_id, user_name)
    VALUES ((_item->>'product_id')::uuid, NULLIF(_item->>'unit_id','')::uuid, _unit_name,
            (_item->>'qty')::numeric, -_qty_base, 'sale', _sale_id, auth.uid(), coalesce(_cashier_name,''));

    _items_count := _items_count + _qty_base;
    _unit_equals := NULL;
  END LOOP;

  UPDATE public.sales SET items_count = _items_count WHERE id = _sale_id;
  RETURN jsonb_build_object('sale_id', _sale_id, 'bill_no', _bill_no);
END;
$$;

-- Historical correction (idempotent): rescale past unit-sale rows to per-base cost using the
-- unit's current equals_base. Base-unit rows (equals_base = 1 / no unit) are already correct.
UPDATE public.sale_items si
SET purchase_price = pu.purchase_price / NULLIF(pu.equals_base, 0)
FROM public.product_units pu
WHERE si.unit_id = pu.id AND pu.equals_base > 1;

notify pgrst, 'reload schema';


-- ========================================
-- 20260606110000_operating_expenses.sql
-- ========================================
-- Operating expenses (rent, bills, salaries, etc.) — distinct from supplier purchases
-- (which are inventory investment, not operating cost). Admin-only. Re-runnable.

create table if not exists public.operating_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null default 'Miscellaneous',
  description text not null default '',
  amount numeric not null default 0,
  paid_to text not null default '',
  payment_method text not null default 'cash',
  recorded_by uuid,
  recorded_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists operating_expenses_date_idx on public.operating_expenses(expense_date);

alter table public.operating_expenses enable row level security;
drop policy if exists "operating_expenses admin all" on public.operating_expenses;
create policy "operating_expenses admin all" on public.operating_expenses
  for all using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

notify pgrst, 'reload schema';


-- ========================================
-- 20260606120000_person_payments.sql
-- ========================================
-- Person payments (money paid to / handled by Junaid, Usama, etc.) with method,
-- so the "By Person" totals are an auditable ledger instead of a manual number.
-- Admin-only. Re-runnable.

create table if not exists public.person_payments (
  id uuid primary key default gen_random_uuid(),
  payment_date date not null,
  person_name text not null default '',
  amount numeric not null default 0,
  payment_method text not null default 'cash',
  notes text not null default '',
  recorded_by uuid,
  recorded_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists person_payments_date_idx on public.person_payments(payment_date);

alter table public.person_payments enable row level security;
drop policy if exists "person_payments admin all" on public.person_payments;
create policy "person_payments admin all" on public.person_payments
  for all using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

notify pgrst, 'reload schema';


-- ========================================
-- 20260606200000_period_extras.sql
-- ========================================
-- Extra period figures for the Dashboard: discounts given, stock purchased
-- (supplier payments — inventory investment, NOT an operating cost), and
-- operating expenses. Isolated RPC so it doesn't touch the larger summary fn.

create or replace function public.get_period_extras(_from timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare _r jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view dashboard analytics';
  end if;
  select jsonb_build_object(
    'discounts',          coalesce((select sum(discount) from public.sales where created_at >= _from), 0),
    'stockPurchased',     coalesce((select sum(amount)   from public.supplier_payments where created_at >= _from), 0),
    'operatingExpenses',  coalesce((select sum(amount)   from public.operating_expenses where created_at >= _from), 0)
  ) into _r;
  return _r;
end;
$$;

revoke execute on function public.get_period_extras(timestamptz) from public, anon;
grant  execute on function public.get_period_extras(timestamptz) to authenticated;

notify pgrst, 'reload schema';


-- ========================================
-- 20260711082109_bf5504ba-68f6-4f59-8e84-a83083c47563.sql
-- ========================================

-- bill_sequences: cashiers need to read
CREATE POLICY "billseq authenticated read" ON public.bill_sequences
  FOR SELECT TO authenticated USING (true);

-- cash_sessions: cashier opens own session
CREATE POLICY "sessions own insert" ON public.cash_sessions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions own update" ON public.cash_sessions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- sales: cashier inserts own sale
CREATE POLICY "sales own insert" ON public.sales
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = cashier_id);

-- sale_items: cashier inserts items on their own sale
CREATE POLICY "sale_items own insert" ON public.sale_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id AND s.cashier_id = auth.uid()
  ));

-- returns: cashier creates + updates own return
CREATE POLICY "returns own insert" ON public.returns
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = cashier_id);
CREATE POLICY "returns own update" ON public.returns
  FOR UPDATE TO authenticated
  USING (auth.uid() = cashier_id)
  WITH CHECK (auth.uid() = cashier_id);

-- return_items: cashier inserts on own return
CREATE POLICY "return_items own insert" ON public.return_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.returns r
    WHERE r.id = return_items.return_id AND r.cashier_id = auth.uid()
  ));

-- shift_expenses: cashier inserts on own session
CREATE POLICY "shift_expenses own insert" ON public.shift_expenses
  FOR INSERT TO authenticated
  WITH CHECK (cashier_id = auth.uid());

-- suppliers: cashier can read
CREATE POLICY "suppliers authenticated read" ON public.suppliers
  FOR SELECT TO authenticated USING (true);

-- supplier_payments: cashier reads own
CREATE POLICY "supplier_payments own read" ON public.supplier_payments
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

-- supplier_purchases: cashier reads own
CREATE POLICY "supplier_purchases own read" ON public.supplier_purchases
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

-- Revoke EXECUTE from anon on SECURITY DEFINER functions (they are for signed-in users only).
REVOKE EXECUTE ON FUNCTION public.close_shift(numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.open_shift(numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_open_session() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.record_expense(numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.process_sale(jsonb, numeric, numeric, numeric, numeric, numeric, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.process_sale_v2(jsonb, numeric, numeric, numeric, numeric, numeric, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.process_return(uuid, jsonb, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.approve_return(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.void_return(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.approve_stock_entry(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reject_stock_entry(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.add_stock_entry(uuid, integer, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.add_stock_entry_v2(uuid, uuid, integer, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, date) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.save_product_with_units(jsonb, jsonb, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_update_shift(uuid, numeric, numeric, numeric, numeric, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_update_shift(uuid, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_summary(timestamptz, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_admin_inventory_summary() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_period_extras(timestamptz) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_online_by_method(timestamptz, timestamptz) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_profit_report(timestamptz, timestamptz) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_suppliers_summary() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM anon, public;


-- ========================================
-- 20260711121534_2f770717-a7b5-4375-a61b-b8501076c81e.sql
-- ========================================
CREATE OR REPLACE FUNCTION public.get_admin_dashboard_summary(_start_at timestamp with time zone, _days integer, _end_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _end timestamptz;
  _gross numeric := 0; _bills integer := 0; _refunds numeric := 0; _returns_count integer := 0;
  _cash numeric := 0; _online numeric := 0; _profit numeric := 0;
  _daily jsonb := '[]'::jsonb; _top_products jsonb := '[]'::jsonb;
  _margin jsonb := '[]'::jsonb; _top_cashiers jsonb := '[]'::jsonb; _hourly jsonb := '[]'::jsonb;
  _prev_start timestamptz; _prev_end timestamptz;
  _p_gross numeric := 0; _p_bills integer := 0; _p_refunds numeric := 0; _p_profit numeric := 0;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view dashboard analytics';
  end if;

  _end := coalesce(_end_at, now());
  _days := greatest(1, least(coalesce(_days, 7), 366));
  _prev_end := _start_at;
  _prev_start := _start_at - (_end - _start_at);

  select coalesce(sum(total),0), count(*)::int,
         coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) =  'cash'), 0),
         coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) <> 'cash'), 0)
  into _gross, _bills, _cash, _online
  from public.sales where created_at >= _start_at and created_at <= _end;

  select coalesce(sum(refund_amount),0), count(*)::int
  into _refunds, _returns_count
  from public.returns
  where status='approved'
    and coalesce(approved_at, created_at) >= _start_at
    and coalesce(approved_at, created_at) <= _end;

  select coalesce(sum(si.subtotal - (si.purchase_price * si.qty)), 0)
  into _profit
  from public.sale_items si join public.sales s on s.id=si.sale_id
  where s.created_at >= _start_at and s.created_at <= _end;

  with day_series as (
    select generate_series(date_trunc('day',_start_at), date_trunc('day',_end), interval '1 day')::date as day
  ), sales_by_day as (
    select date_trunc('day',created_at)::date as day, sum(total) as sales
    from public.sales where created_at >= _start_at and created_at <= _end group by 1
  ), returns_by_day as (
    select date_trunc('day', coalesce(approved_at, created_at))::date as day, sum(refund_amount) as refunds
    from public.returns
    where status='approved' and coalesce(approved_at, created_at) >= _start_at and coalesce(approved_at, created_at) <= _end
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', case when _days = 1 then 'Today' else to_char(ds.day, 'MM-DD') end,
    'sales', round(coalesce(s.sales,0)),
    'refunds', round(coalesce(r.refunds,0))
  ) order by ds.day), '[]'::jsonb)
  into _daily
  from day_series ds left join sales_by_day s on s.day=ds.day left join returns_by_day r on r.day=ds.day;

  with product_totals as (
    select si.product_name as name, sum(si.qty)::int as qty, sum(si.subtotal) as revenue
    from public.sale_items si join public.sales s on s.id=si.sale_id
    where s.created_at >= _start_at and s.created_at <= _end
    group by si.product_name order by sum(si.qty) desc limit 7
  )
  select coalesce(jsonb_agg(jsonb_build_object('name',name,'qty',qty,'revenue',revenue)), '[]'::jsonb)
  into _top_products from product_totals;

  with margin_buckets as (
    select case
      when si.subtotal>0 and (((si.subtotal-(si.purchase_price*si.qty))/si.subtotal)*100) < 10 then 'Low (<10%)'
      when si.subtotal>0 and (((si.subtotal-(si.purchase_price*si.qty))/si.subtotal)*100) < 30 then 'Mid (10-30%)'
      else 'High (>30%)' end as name,
      round(sum(si.subtotal)) as value
    from public.sale_items si join public.sales s on s.id=si.sale_id
    where s.created_at >= _start_at and s.created_at <= _end and si.subtotal>0
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('name',name,'value',value)), '[]'::jsonb)
  into _margin from margin_buckets where value>0;

  with cashier_totals as (
    select coalesce(nullif(cashier_name,''),'Unknown') as name, sum(total) as sales, count(*)::int as bills
    from public.sales where created_at >= _start_at and created_at <= _end
    group by 1 order by sum(total) desc limit 5
  )
  select coalesce(jsonb_agg(jsonb_build_object('name',name,'sales',round(sales),'bills',bills) order by sales desc), '[]'::jsonb)
  into _top_cashiers from cashier_totals;

  with hours as (select generate_series(0,23) as hour),
  sales_by_hour as (
    select extract(hour from (created_at at time zone 'Asia/Karachi'))::int as hour, sum(total) as sales
    from public.sales where created_at >= _start_at and created_at <= _end group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('hour',h.hour,'sales',round(coalesce(sh.sales,0))) order by h.hour), '[]'::jsonb)
  into _hourly from hours h left join sales_by_hour sh on sh.hour=h.hour;

  select coalesce(sum(total),0), count(*)::int
  into _p_gross, _p_bills
  from public.sales where created_at >= _prev_start and created_at < _prev_end;

  select coalesce(sum(refund_amount),0) into _p_refunds
  from public.returns where status='approved'
    and coalesce(approved_at, created_at) >= _prev_start and coalesce(approved_at, created_at) < _prev_end;

  select coalesce(sum(si.subtotal-(si.purchase_price*si.qty)),0) into _p_profit
  from public.sale_items si join public.sales s on s.id=si.sale_id
  where s.created_at >= _prev_start and s.created_at < _prev_end;

  return jsonb_build_object(
    'grossSales',_gross,'bills',_bills,'refunds',_refunds,
    'net', _gross - _refunds, 'rate', case when _gross>0 then (_refunds/_gross)*100 else 0 end,
    'returnsCount',_returns_count,'cashSales',_cash,'onlineSales',_online,'grossProfit',_profit,
    'daily',_daily,'topProducts',_top_products,'margin',_margin,'topCashiers',_top_cashiers,'hourly',_hourly,
    'prev', jsonb_build_object('grossSales',_p_gross,'bills',_p_bills,'net',_p_gross-_p_refunds,'grossProfit',_p_profit)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_period_extras(_from timestamp with time zone, _to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _r jsonb; _end timestamptz;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view dashboard analytics';
  end if;
  _end := coalesce(_to, now());
  select jsonb_build_object(
    'discounts',         coalesce((select sum(discount) from public.sales where created_at >= _from and created_at <= _end), 0),
    'stockPurchased',    coalesce((select sum(amount)   from public.supplier_payments where created_at >= _from and created_at <= _end), 0),
    'operatingExpenses', coalesce((select sum(amount)   from public.operating_expenses where created_at >= _from and created_at <= _end), 0)
  ) into _r;
  return _r;
end;
$function$;

-- ========================================
-- 20260711123955_09b5f5ac-552a-4f5b-b23e-5b0afb231b20.sql
-- ========================================
CREATE OR REPLACE FUNCTION public.update_product_prices(_product_id uuid, _purchase_price numeric, _sale_price numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'cashier'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _purchase_price IS NULL OR _purchase_price < 0 OR _sale_price IS NULL OR _sale_price < 0 THEN
    RAISE EXCEPTION 'Prices must be non-negative';
  END IF;
  UPDATE public.products
     SET purchase_price = _purchase_price,
         sale_price = _sale_price,
         updated_at = now()
   WHERE id = _product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_product_prices(uuid, numeric, numeric) TO authenticated;

-- ========================================
-- 20260711124332_4f430a51-e939-4d3a-b2d0-5a62577f4262.sql
-- ========================================
CREATE TABLE IF NOT EXISTS public.price_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_name text NOT NULL DEFAULT '',
  current_purchase_price numeric NOT NULL DEFAULT 0,
  current_sale_price numeric NOT NULL DEFAULT 0,
  requested_purchase_price numeric NOT NULL,
  requested_sale_price numeric NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid,
  requested_by_name text NOT NULL DEFAULT '',
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_change_requests TO authenticated;
GRANT ALL ON public.price_change_requests TO service_role;

ALTER TABLE public.price_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pcr read" ON public.price_change_requests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR requested_by = auth.uid());

CREATE POLICY "pcr admin write" ON public.price_change_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER pcr_touch BEFORE UPDATE ON public.price_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Cashier/admin creates a request
CREATE OR REPLACE FUNCTION public.request_price_change(
  _product_id uuid,
  _requested_purchase numeric,
  _requested_sale numeric,
  _reason text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _name text; _pname text; _cp numeric; _cs numeric; _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid,'cashier'::app_role) OR public.has_role(_uid,'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized'; END IF;
  IF _requested_purchase IS NULL OR _requested_purchase < 0
     OR _requested_sale IS NULL OR _requested_sale < 0 THEN
    RAISE EXCEPTION 'Prices must be non-negative'; END IF;

  SELECT name, purchase_price, sale_price INTO _pname, _cp, _cs
    FROM public.products WHERE id = _product_id;
  IF _pname IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  SELECT coalesce(full_name, username, 'Cashier') INTO _name FROM public.profiles WHERE id = _uid;

  INSERT INTO public.price_change_requests(
    product_id, product_name,
    current_purchase_price, current_sale_price,
    requested_purchase_price, requested_sale_price,
    reason, requested_by, requested_by_name, status
  ) VALUES (
    _product_id, _pname, _cp, _cs,
    _requested_purchase, _requested_sale,
    coalesce(_reason,''), _uid, coalesce(_name,''), 'pending'
  ) RETURNING id INTO _id;

  RETURN _id;
END; $$;

GRANT EXECUTE ON FUNCTION public.request_price_change(uuid, numeric, numeric, text) TO authenticated;

-- Admin approves: applies new prices to product
CREATE OR REPLACE FUNCTION public.approve_price_change(_request_id uuid, _notes text DEFAULT '')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record; _reviewer text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Only admins can approve'; END IF;
  SELECT * INTO _r FROM public.price_change_requests WHERE id = _request_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Only pending requests can be approved'; END IF;

  SELECT coalesce(full_name, username, 'Admin') INTO _reviewer FROM public.profiles WHERE id = auth.uid();

  UPDATE public.products
     SET purchase_price = _r.requested_purchase_price,
         sale_price     = _r.requested_sale_price,
         updated_at     = now()
   WHERE id = _r.product_id;

  UPDATE public.price_change_requests
     SET status = 'approved', reviewed_by = auth.uid(),
         reviewed_by_name = _reviewer, reviewed_at = now(),
         review_notes = coalesce(_notes,'')
   WHERE id = _request_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.approve_price_change(uuid, text) TO authenticated;

-- Admin rejects
CREATE OR REPLACE FUNCTION public.reject_price_change(_request_id uuid, _notes text DEFAULT '')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _status text; _reviewer text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Only admins can reject'; END IF;
  SELECT status INTO _status FROM public.price_change_requests WHERE id = _request_id FOR UPDATE;
  IF _status IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF _status <> 'pending' THEN RAISE EXCEPTION 'Only pending requests can be rejected'; END IF;

  SELECT coalesce(full_name, username, 'Admin') INTO _reviewer FROM public.profiles WHERE id = auth.uid();

  UPDATE public.price_change_requests
     SET status = 'rejected', reviewed_by = auth.uid(),
         reviewed_by_name = _reviewer, reviewed_at = now(),
         review_notes = coalesce(_notes,'')
   WHERE id = _request_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.reject_price_change(uuid, text) TO authenticated;

-- ========================================
-- 20260711131050_67bea23d-50f3-4f88-87da-c5c0e3c0ad06.sql
-- ========================================

DROP POLICY IF EXISTS "Authenticated can create own price requests" ON public.price_change_requests;
CREATE POLICY "Authenticated can create own price requests"
ON public.price_change_requests
FOR INSERT
TO authenticated
WITH CHECK (requested_by = auth.uid());

REVOKE EXECUTE ON FUNCTION public.approve_price_change(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_price_change(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reject_price_change(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reject_price_change(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_price_change(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_price_change(uuid, numeric, numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_product_prices(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_product_prices(uuid, numeric, numeric) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_summary(timestamptz, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_dashboard_summary(timestamptz, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_summary(timestamptz, integer, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_dashboard_summary(timestamptz, integer, timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_period_extras(timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_period_extras(timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_period_extras(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_period_extras(timestamptz, timestamptz) TO authenticated;


-- ========================================
-- 20260711143055_deb9881e-16e3-499f-a6fb-c9e2c61fe9e0.sql
-- ========================================

CREATE OR REPLACE FUNCTION public.get_profit_report(_from timestamptz, _to timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH sale_line AS (
    SELECT
      si.sale_id,
      coalesce(nullif(si.product_name,''),'Unknown') AS name,
      ((s.created_at AT TIME ZONE 'UTC')::date)     AS d,
      coalesce(si.qty,0)                             AS qty,
      coalesce(si.qty,0) * coalesce(si.unit_price,0) AS gross_revenue,
      coalesce(si.qty,0) * coalesce(si.purchase_price,0) AS cost,
      (coalesce(si.purchase_price,0) = 0)            AS zero_cost,
      coalesce(s.subtotal,0)                         AS sale_subtotal,
      coalesce(s.discount,0)                         AS sale_discount
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.created_at >= _from AND s.created_at <= _to
  ),
  li AS (
    SELECT
      name, d, qty,
      gross_revenue
        - CASE WHEN sale_subtotal > 0
               THEN sale_discount * (gross_revenue / sale_subtotal)
               ELSE 0 END AS revenue,
      cost, zero_cost
    FROM sale_line
  ),
  ret AS (
    SELECT
      coalesce(nullif(ri.product_name,''),'Unknown')                        AS name,
      ((coalesce(r.approved_at, r.created_at) AT TIME ZONE 'UTC')::date)    AS d,
      coalesce(ri.qty,0)                                                    AS qty,
      coalesce(ri.qty,0) * coalesce(ri.unit_price,0)                        AS revenue_ret,
      coalesce(ri.qty,0) * coalesce(si.purchase_price,0)                    AS cost_ret
    FROM public.returns r
    JOIN public.return_items ri ON ri.return_id = r.id
    LEFT JOIN public.sale_items si
      ON si.sale_id = r.original_sale_id AND si.product_id = ri.product_id
    WHERE r.status = 'approved'
      AND coalesce(r.approved_at, r.created_at) >= _from
      AND coalesce(r.approved_at, r.created_at) <= _to
  ),
  combined AS (
    SELECT name, d, qty, revenue, cost, zero_cost FROM li
    UNION ALL
    SELECT name, d, -qty, -revenue_ret, -cost_ret, false FROM ret
  ),
  by_product AS (
    SELECT name,
           sum(qty)     AS qty,
           sum(revenue) AS revenue,
           sum(cost)    AS cost,
           sum(revenue) - sum(cost) AS profit,
           bool_or(zero_cost) AS has_zero_cost
    FROM combined
    GROUP BY name
  ),
  by_day AS (
    SELECT d,
           sum(revenue) - sum(cost) AS profit,
           sum(revenue)             AS sales
    FROM combined
    GROUP BY d
  ),
  tot AS (
    SELECT coalesce(sum(revenue),0) AS revenue,
           coalesce(sum(cost),0)    AS cost,
           coalesce(sum(CASE WHEN zero_cost THEN 1 ELSE 0 END),0) AS zero_count
    FROM combined
  )
  SELECT jsonb_build_object(
    'total_revenue', (SELECT revenue FROM tot),
    'total_cost',    (SELECT cost FROM tot),
    'total_profit',  (SELECT revenue - cost FROM tot),
    'zero_count',    (SELECT zero_count FROM tot),
    'by_product', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'name',      name,
        'qty',       qty,
        'revenue',   revenue,
        'cost',      cost,
        'profit',    profit,
        'margin',    CASE WHEN revenue > 0 THEN (profit / revenue) * 100 ELSE NULL END,
        'zero_cost', has_zero_cost
      ) ORDER BY profit DESC)
      FROM by_product), '[]'::jsonb),
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'date',   to_char(d,'YYYY-MM-DD'),
        'profit', round(profit),
        'sales',  round(sales)
      ) ORDER BY d)
      FROM by_day), '[]'::jsonb)
  );
$$;


-- ========================================
-- 20260711145831_405f045b-1c4e-477f-9e8f-650c8faac143.sql
-- ========================================
-- Backfill zero purchase_price on sale_items from products.purchase_price
UPDATE public.sale_items si
SET purchase_price = p.purchase_price
FROM public.products p
WHERE si.product_id = p.id
  AND COALESCE(si.purchase_price, 0) = 0
  AND COALESCE(p.purchase_price, 0) > 0;

-- Same for return_items via product cost (no cost column here, but ensure future consistency handled elsewhere)

-- ========================================
-- 20260711152648_c9e6ee4c-9922-4eb5-9ac8-380d2c54c3c7.sql
-- ========================================

CREATE TABLE public.customer_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  contact TEXT,
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  category TEXT NOT NULL DEFAULT 'general',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_feedback TO authenticated;
GRANT INSERT ON public.customer_feedback TO anon;
GRANT ALL ON public.customer_feedback TO service_role;

ALTER TABLE public.customer_feedback ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous customers) can submit feedback
CREATE POLICY "Anyone can submit feedback"
  ON public.customer_feedback FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    char_length(message) BETWEEN 1 AND 2000
    AND (name IS NULL OR char_length(name) <= 100)
    AND (contact IS NULL OR char_length(contact) <= 150)
    AND category IN ('general','suggestion','complaint','compliment','product','service')
  );

-- Only admins can read/update/delete
CREATE POLICY "Admins can view all feedback"
  ON public.customer_feedback FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update feedback"
  ON public.customer_feedback FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete feedback"
  ON public.customer_feedback FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX customer_feedback_created_at_idx ON public.customer_feedback (created_at DESC);
CREATE INDEX customer_feedback_status_idx ON public.customer_feedback (status);


-- ========================================
-- 20260712052328_75efc651-255c-42cf-a951-3644180217a2.sql
-- ========================================
CREATE OR REPLACE FUNCTION public.record_supplier_payment(_supplier_id uuid, _amount numeric, _method text DEFAULT 'cash'::text, _notes text DEFAULT ''::text, _payment_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _name text; _session_id uuid; _payment_id uuid; _supplier_name text; _m text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (has_role(_uid,'cashier'::app_role) OR has_role(_uid,'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  SELECT name INTO _supplier_name FROM public.suppliers WHERE id = _supplier_id;
  IF _supplier_name IS NULL THEN RAISE EXCEPTION 'Supplier not found'; END IF;

  SELECT coalesce(full_name, username, 'Cashier') INTO _name FROM public.profiles WHERE id = _uid;
  SELECT id INTO _session_id FROM public.cash_sessions
   WHERE user_id = _uid AND status = 'open' LIMIT 1;

  _m := coalesce(_method,'cash');

  INSERT INTO public.supplier_payments
    (supplier_id, amount, method, notes, payment_date, created_by, created_by_name, session_id)
  VALUES (_supplier_id, _amount, _m, coalesce(_notes,''),
          coalesce(_payment_date,CURRENT_DATE), _uid, coalesce(_name,''), _session_id)
  RETURNING id INTO _payment_id;

  -- If the payment was handed via Junaid or Usama, mirror it in the person_payments
  -- ledger so it shows up in the Daily Expenses report and is deducted there.
  IF _m IN ('Junaid','Usama') THEN
    INSERT INTO public.person_payments
      (payment_date, person_name, amount, payment_method, notes, recorded_by, recorded_by_name)
    VALUES (coalesce(_payment_date,CURRENT_DATE), _m, _amount, 'cash',
            'Supplier payment: ' || _supplier_name || CASE WHEN coalesce(_notes,'') <> '' THEN ' — ' || _notes ELSE '' END,
            _uid, coalesce(_name,''));
  END IF;

  RETURN jsonb_build_object('payment_id',_payment_id,'session_id',_session_id);
END; $function$;

-- ========================================
-- 20260714132013_e8bd05b4-f185-46ab-80eb-e24189538ca2.sql
-- ========================================

CREATE TABLE public.manual_sale_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL UNIQUE,
  cash_junaid numeric NOT NULL DEFAULT 0,
  cash_usama numeric NOT NULL DEFAULT 0,
  cash_zahid numeric NOT NULL DEFAULT 0,
  others numeric NOT NULL DEFAULT 0,
  counter_cash numeric NOT NULL DEFAULT 0,
  today_expenses_override numeric,
  previous_expense_override numeric,
  notes text NOT NULL DEFAULT '',
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_sale_days TO authenticated;
GRANT ALL ON public.manual_sale_days TO service_role;

ALTER TABLE public.manual_sale_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage manual sale days" ON public.manual_sale_days
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Cashiers can read manual sale days" ON public.manual_sale_days
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'cashier') OR public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_manual_sale_days_touch
  BEFORE UPDATE ON public.manual_sale_days
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ========================================
-- 20260714132453_023d3d45-622e-41da-8ae7-c2b40cc0cc83.sql
-- ========================================

CREATE TABLE public.manual_sale_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_sale_persons TO authenticated;
GRANT ALL ON public.manual_sale_persons TO service_role;

ALTER TABLE public.manual_sale_persons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage persons" ON public.manual_sale_persons
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Authenticated read persons" ON public.manual_sale_persons
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.manual_sale_persons (name, sort_order) VALUES
  ('Junaid', 1), ('Usama', 2), ('Zahid Ali', 3)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.manual_sale_days
  ADD COLUMN IF NOT EXISTS cash_by_person jsonb NOT NULL DEFAULT '{}'::jsonb;


-- ========================================
-- 20260718204433_964c9bae-50be-40e0-9e44-4fd91d25b2d1.sql
-- ========================================
CREATE POLICY "Cashiers can enter counter cash" ON public.manual_sale_days FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Cashiers can update counter cash" ON public.manual_sale_days FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- ========================================
-- 20260721142944_d8a4cda0-1d53-44ea-bdd6-29272cf4f4a2.sql
-- ========================================
CREATE OR REPLACE FUNCTION public.approve_price_change(_request_id uuid, _notes text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r record; _reviewer text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Only admins can approve'; END IF;
  SELECT * INTO _r FROM public.price_change_requests WHERE id = _request_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Only pending requests can be approved'; END IF;

  SELECT coalesce(full_name, username, 'Admin') INTO _reviewer FROM public.profiles WHERE id = auth.uid();

  UPDATE public.products
     SET purchase_price = _r.requested_purchase_price,
         sale_price     = _r.requested_sale_price,
         updated_at     = now()
   WHERE id = _r.product_id;

  -- Also sync the base unit's prices so POS (which reads product_units) reflects the change
  UPDATE public.product_units
     SET purchase_price = _r.requested_purchase_price,
         sale_price     = _r.requested_sale_price,
         updated_at     = now()
   WHERE product_id = _r.product_id AND is_base = true;

  UPDATE public.price_change_requests
     SET status = 'approved', reviewed_by = auth.uid(),
         reviewed_by_name = _reviewer, reviewed_at = now(),
         review_notes = coalesce(_notes,'')
   WHERE id = _request_id;
END; $function$;

-- ========================================
-- 20260723143143_85f27e1d-86bc-489d-a847-51c3d907961e.sql
-- ========================================
ALTER TABLE public.manual_sale_days ADD COLUMN IF NOT EXISTS counter_cash_by text;

-- ========================================
-- 20260723153352_cacb1581-c1ab-4563-90af-e32da861bb2f.sql
-- ========================================
DELETE FROM public.manual_sale_days WHERE entry_date = '2026-06-30';
UPDATE public.manual_sale_days SET entry_date = '2026-06-30' WHERE entry_date = '2025-06-30';

-- ========================================
-- 20260723153758_2f60ae7e-0f92-458b-a811-f7d9dadfa821.sql
-- ========================================
CREATE POLICY "stock_entries admin update" ON public.stock_entries FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "stock_entries admin delete" ON public.stock_entries FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- ========================================
-- 20260723162423_192bc06d-03f9-43d9-ae14-4cd2418ce29c.sql
-- ========================================
ALTER TABLE public.manual_sale_days ADD COLUMN IF NOT EXISTS cash_with_junaid numeric NOT NULL DEFAULT 0;

-- ========================================
-- 20260723190548_c5c50e7e-5c74-4c52-8561-f57df69009c8.sql
-- ========================================

CREATE TABLE public.stock_reconciliations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.product_units(id) ON DELETE SET NULL,
  system_stock NUMERIC NOT NULL DEFAULT 0,
  physical_stock NUMERIC NOT NULL DEFAULT 0,
  difference NUMERIC NOT NULL DEFAULT 0,
  cost_price NUMERIC NOT NULL DEFAULT 0,
  cost_impact NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.stock_reconciliations TO authenticated;
GRANT ALL ON public.stock_reconciliations TO service_role;

ALTER TABLE public.stock_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own reconciliations"
  ON public.stock_reconciliations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can view their own reconciliations"
  ON public.stock_reconciliations FOR SELECT
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Admins can view all reconciliations"
  ON public.stock_reconciliations FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_stock_reconciliations_product ON public.stock_reconciliations(product_id);
CREATE INDEX idx_stock_reconciliations_created_at ON public.stock_reconciliations(created_at DESC);


-- ========================================
-- 20260724064449_e53f2f71-dbc9-43f9-afd7-792848ec83b2.sql
-- ========================================

ALTER TABLE public.stock_reconciliations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_by_name text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by_name text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

-- Backfill: any existing rows are treated as already applied/approved so they don't clutter pending.
UPDATE public.stock_reconciliations
   SET status = 'approved', applied_at = COALESCE(applied_at, created_at)
 WHERE status = 'pending' AND created_at < now() - interval '1 minute';

CREATE INDEX IF NOT EXISTS idx_stock_reconciliations_status ON public.stock_reconciliations(status);

-- Approve: sets product stock to the physical count, logs inventory movement.
CREATE OR REPLACE FUNCTION public.approve_stock_reconciliation(_id uuid, _notes text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r record;
  _reviewer text;
  _current_stock numeric;
  _delta numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can approve reconciliations';
  END IF;

  SELECT * INTO _r FROM public.stock_reconciliations WHERE id = _id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Reconciliation not found'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Only pending reconciliations can be approved'; END IF;

  SELECT COALESCE(full_name, username, 'Admin') INTO _reviewer FROM public.profiles WHERE id = auth.uid();

  SELECT stock INTO _current_stock FROM public.products WHERE id = _r.product_id FOR UPDATE;
  IF _current_stock IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  _delta := _r.physical_stock - _current_stock;

  UPDATE public.products
     SET stock = _r.physical_stock, updated_at = now()
   WHERE id = _r.product_id;

  INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, ref_id, user_id, user_name, notes)
  VALUES (_r.product_id, _r.unit_id, 'reconciliation', _delta, _delta, 'reconciliation', _r.id, auth.uid(), _reviewer,
          'Approved reconciliation: system=' || _current_stock || ' physical=' || _r.physical_stock ||
          CASE WHEN COALESCE(_notes,'') <> '' THEN ' — ' || _notes ELSE '' END);

  UPDATE public.stock_reconciliations
     SET status = 'approved', reviewed_by = auth.uid(), reviewed_by_name = _reviewer,
         reviewed_at = now(), review_notes = COALESCE(_notes,''), applied_at = now()
   WHERE id = _id;

  RETURN jsonb_build_object('id', _id, 'status', 'approved', 'delta', _delta);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_stock_reconciliation(_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _r record; _reviewer text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can reject reconciliations';
  END IF;
  SELECT * INTO _r FROM public.stock_reconciliations WHERE id = _id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Reconciliation not found'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Only pending reconciliations can be rejected'; END IF;

  SELECT COALESCE(full_name, username, 'Admin') INTO _reviewer FROM public.profiles WHERE id = auth.uid();

  UPDATE public.stock_reconciliations
     SET status = 'rejected', reviewed_by = auth.uid(), reviewed_by_name = _reviewer,
         reviewed_at = now(), review_notes = COALESCE(_reason,'')
   WHERE id = _id;

  RETURN jsonb_build_object('id', _id, 'status', 'rejected');
END;
$$;


-- ========================================
-- 20260725052711_5ae09b1e-0237-4f8e-a623-d11b01cf0ca2.sql
-- ========================================
REVOKE EXECUTE ON FUNCTION public.approve_stock_reconciliation(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_stock_reconciliation(uuid, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_stock_reconciliation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_stock_reconciliation(uuid, text) TO authenticated;

-- ========================================
-- 20260725053643_e95b305f-8a77-4e96-bbc2-a7fd01d49490.sql
-- ========================================
CREATE OR REPLACE FUNCTION public.approve_stock_reconciliation(_id uuid, _notes text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r record;
  _reviewer text;
  _current_stock numeric;
  _delta numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can approve reconciliations';
  END IF;

  SELECT * INTO _r FROM public.stock_reconciliations WHERE id = _id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Reconciliation not found'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Only pending reconciliations can be approved'; END IF;

  SELECT COALESCE(full_name, username, 'Admin') INTO _reviewer FROM public.profiles WHERE id = auth.uid();

  SELECT stock INTO _current_stock FROM public.products WHERE id = _r.product_id FOR UPDATE;
  IF _current_stock IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  _delta := _r.physical_stock - _current_stock;

  UPDATE public.products
     SET stock = _r.physical_stock, updated_at = now()
   WHERE id = _r.product_id;

  INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, ref_id, user_id, user_name, notes)
  VALUES (_r.product_id, _r.unit_id, 'reconciliation', _delta, _delta, 'adjustment', _r.id, auth.uid(), _reviewer,
          'Approved reconciliation: system=' || _current_stock || ' physical=' || _r.physical_stock ||
          CASE WHEN COALESCE(_notes,'') <> '' THEN ' — ' || _notes ELSE '' END);

  UPDATE public.stock_reconciliations
     SET status = 'approved', reviewed_by = auth.uid(), reviewed_by_name = _reviewer,
         reviewed_at = now(), review_notes = COALESCE(_notes,''), applied_at = now()
   WHERE id = _id;

  RETURN jsonb_build_object('id', _id, 'status', 'approved', 'delta', _delta);
END;
$function$;

-- ========================================
-- 20260725061507_acd68668-dd4e-42f7-a35c-d7122eee42f4.sql
-- ========================================
update public.manual_sale_days
set cash_by_person = jsonb_set(cash_by_person, '{Junaid,paid}', '0'::jsonb)
where entry_date = '2026-06-30';

-- ========================================
-- 20260725065509_57417a41-817e-44ed-9f8c-738425420b0b.sql
-- ========================================
CREATE OR REPLACE FUNCTION public.record_supplier_payment(_supplier_id uuid, _amount numeric, _method text DEFAULT 'cash'::text, _notes text DEFAULT ''::text, _payment_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _name text; _session_id uuid; _payment_id uuid; _supplier_name text; _m text; _ml text; _person text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (has_role(_uid,'cashier'::app_role) OR has_role(_uid,'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  SELECT name INTO _supplier_name FROM public.suppliers WHERE id = _supplier_id;
  IF _supplier_name IS NULL THEN RAISE EXCEPTION 'Supplier not found'; END IF;

  SELECT coalesce(full_name, username, 'Cashier') INTO _name FROM public.profiles WHERE id = _uid;
  SELECT id INTO _session_id FROM public.cash_sessions
   WHERE user_id = _uid AND status = 'open' LIMIT 1;

  _m := coalesce(_method,'cash');
  _ml := lower(trim(_m));

  INSERT INTO public.supplier_payments
    (supplier_id, amount, method, notes, payment_date, created_by, created_by_name, session_id)
  VALUES (_supplier_id, _amount, _m, coalesce(_notes,''),
          coalesce(_payment_date,CURRENT_DATE), _uid, coalesce(_name,''), _session_id)
  RETURNING id INTO _payment_id;

  -- Map payment methods to person ledgers:
  --  Junaid, easypaisa, online -> Junaid
  --  Usama, jazzcash            -> Usama
  --  Others                     -> Others
  _person := CASE
    WHEN _m = 'Junaid' OR _ml IN ('easypaisa','online') THEN 'Junaid'
    WHEN _m = 'Usama'  OR _ml = 'jazzcash'              THEN 'Usama'
    WHEN _m = 'Others'                                  THEN 'Others'
    ELSE NULL
  END;

  IF _person IS NOT NULL THEN
    INSERT INTO public.person_payments
      (payment_date, person_name, amount, payment_method, notes, recorded_by, recorded_by_name)
    VALUES (coalesce(_payment_date,CURRENT_DATE), _person, _amount, _m,
            'Supplier payment: ' || _supplier_name || CASE WHEN coalesce(_notes,'') <> '' THEN ' — ' || _notes ELSE '' END,
            _uid, coalesce(_name,''));
  END IF;

  RETURN jsonb_build_object('payment_id',_payment_id,'session_id',_session_id);
END; $function$;

-- ========================================
-- 20260725065858_47ad3ed6-333d-44e7-a429-edcd71429aa5.sql
-- ========================================
CREATE TABLE IF NOT EXISTS public.person_starting_balances (
  person_name text PRIMARY KEY,
  balance numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.person_starting_balances TO authenticated;
GRANT ALL ON public.person_starting_balances TO service_role;
ALTER TABLE public.person_starting_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage starting balances" ON public.person_starting_balances
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins read starting balances" ON public.person_starting_balances
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- ========================================
-- 20260725173801_9dd5e3e7-22d6-4973-bf77-8c8af235bc3e.sql
-- ========================================
CREATE OR REPLACE FUNCTION public.get_profit_report(_from timestamptz, _to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can access the profit report';
  END IF;

  RETURN (
    WITH sale_line AS (
      SELECT
        si.sale_id,
        coalesce(nullif(si.product_name,''),'Unknown') AS name,
        ((s.created_at AT TIME ZONE 'UTC')::date)     AS d,
        coalesce(si.qty,0)                             AS qty,
        coalesce(si.qty,0) * coalesce(si.unit_price,0) AS gross_revenue,
        coalesce(si.qty,0) * coalesce(si.purchase_price,0) AS cost,
        (coalesce(si.purchase_price,0) = 0)            AS zero_cost,
        coalesce(s.subtotal,0)                         AS sale_subtotal,
        coalesce(s.discount,0)                         AS sale_discount
      FROM public.sale_items si
      JOIN public.sales s ON s.id = si.sale_id
      WHERE s.created_at >= _from AND s.created_at <= _to
    ),
    li AS (
      SELECT
        name, d, qty,
        gross_revenue
          - CASE WHEN sale_subtotal > 0
                 THEN sale_discount * (gross_revenue / sale_subtotal)
                 ELSE 0 END AS revenue,
        cost, zero_cost
      FROM sale_line
    ),
    ret AS (
      SELECT
        coalesce(nullif(ri.product_name,''),'Unknown')                        AS name,
        ((coalesce(r.approved_at, r.created_at) AT TIME ZONE 'UTC')::date)    AS d,
        coalesce(ri.qty,0)                                                    AS qty,
        coalesce(ri.qty,0) * coalesce(ri.unit_price,0)                        AS revenue_ret,
        coalesce(ri.qty,0) * coalesce(si.purchase_price,0)                    AS cost_ret
      FROM public.returns r
      JOIN public.return_items ri ON ri.return_id = r.id
      LEFT JOIN public.sale_items si
        ON si.sale_id = r.original_sale_id AND si.product_id = ri.product_id
      WHERE r.status = 'approved'
        AND coalesce(r.approved_at, r.created_at) >= _from
        AND coalesce(r.approved_at, r.created_at) <= _to
    ),
    combined AS (
      SELECT name, d, qty, revenue, cost, zero_cost FROM li
      UNION ALL
      SELECT name, d, -qty, -revenue_ret, -cost_ret, false FROM ret
    ),
    by_product AS (
      SELECT name,
             sum(qty)     AS qty,
             sum(revenue) AS revenue,
             sum(cost)    AS cost,
             sum(revenue) - sum(cost) AS profit,
             bool_or(zero_cost) AS has_zero_cost
      FROM combined
      GROUP BY name
    ),
    by_day AS (
      SELECT d,
             sum(revenue) - sum(cost) AS profit,
             sum(revenue)             AS sales
      FROM combined
      GROUP BY d
    ),
    tot AS (
      SELECT coalesce(sum(revenue),0) AS revenue,
             coalesce(sum(cost),0)    AS cost,
             coalesce(sum(CASE WHEN zero_cost THEN 1 ELSE 0 END),0) AS zero_count
      FROM combined
    )
    SELECT jsonb_build_object(
      'total_revenue', (SELECT revenue FROM tot),
      'total_cost',    (SELECT cost FROM tot),
      'total_profit',  (SELECT revenue - cost FROM tot),
      'zero_count',    (SELECT zero_count FROM tot),
      'by_product', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'name',      name,
          'qty',       qty,
          'revenue',   revenue,
          'cost',      cost,
          'profit',    profit,
          'margin',    CASE WHEN revenue > 0 THEN (profit / revenue) * 100 ELSE NULL END,
          'zero_cost', has_zero_cost
        ) ORDER BY profit DESC)
        FROM by_product), '[]'::jsonb),
      'daily', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'date',   to_char(d,'YYYY-MM-DD'),
          'profit', round(profit),
          'sales',  round(sales)
        ) ORDER BY d)
        FROM by_day), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_profit_report(timestamptz, timestamptz) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profit_report(timestamptz, timestamptz) TO authenticated;

-- ========================================
-- 20260726065850_16052edf-9436-4bee-b184-bdb8e99a7f75.sql
-- ========================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.person_starting_balances TO authenticated;
GRANT ALL ON public.person_starting_balances TO service_role;

-- ========================================
-- 20260728092401_d7f8a6dc-cbf0-4006-ab89-9b0473dfb04a.sql
-- ========================================

CREATE OR REPLACE FUNCTION public.change_sale_payment(_sale_id uuid, _new_payment text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  is_cash_old boolean;
  is_cash_new boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _new_payment NOT IN ('cash','card','easypasa','jazzcash') THEN
    RAISE EXCEPTION 'Invalid payment type: %', _new_payment;
  END IF;

  SELECT * INTO s FROM public.sales WHERE id = _sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  -- Only the cashier who made the sale (or an admin) can change it
  IF s.cashier_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not allowed to modify this sale';
  END IF;

  IF s.session_id IS NULL THEN
    RAISE EXCEPTION 'Sale is not linked to a shift';
  END IF;

  -- Must be one of the last 5 bills for this cashier in the same shift
  IF NOT EXISTS (
    SELECT 1 FROM (
      SELECT id FROM public.sales
      WHERE cashier_id = s.cashier_id
        AND session_id = s.session_id
      ORDER BY created_at DESC
      LIMIT 5
    ) t
    WHERE t.id = _sale_id
  ) THEN
    RAISE EXCEPTION 'Only the last 5 bills of this shift can be changed';
  END IF;

  is_cash_old := (s.payment_type = 'cash');
  is_cash_new := (_new_payment = 'cash');

  UPDATE public.sales
     SET payment_type   = _new_payment,
         payment_method = _new_payment,
         cash_received  = CASE WHEN is_cash_new THEN total ELSE 0 END,
         change_returned = 0
   WHERE id = _sale_id;

  IF is_cash_old <> is_cash_new THEN
    IF is_cash_new THEN
      UPDATE public.cash_sessions
         SET cash_sales    = cash_sales   + s.total,
             online_sales  = GREATEST(online_sales - s.total, 0),
             expected_cash = expected_cash + s.total
       WHERE id = s.session_id;
    ELSE
      UPDATE public.cash_sessions
         SET cash_sales    = GREATEST(cash_sales - s.total, 0),
             online_sales  = online_sales + s.total,
             expected_cash = GREATEST(expected_cash - s.total, 0)
       WHERE id = s.session_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'sale_id', _sale_id, 'payment_type', _new_payment);
END;
$$;

REVOKE ALL ON FUNCTION public.change_sale_payment(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_sale_payment(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.change_sale_payment(uuid, text) TO authenticated;


-- ========================================
-- 20260728175520_2e2a5b91-c06b-4c80-a99f-0aab047ac36c.sql
-- ========================================
-- Backfill base unit prices from product row where base unit is zero
UPDATE public.product_units pu
SET purchase_price = p.purchase_price,
    sale_price = p.sale_price,
    updated_at = now()
FROM public.products p
WHERE pu.product_id = p.id
  AND pu.is_base = true
  AND (pu.sale_price = 0 OR pu.purchase_price = 0)
  AND (p.sale_price > 0 OR p.purchase_price > 0);

-- Update RPC to keep base unit in sync going forward
CREATE OR REPLACE FUNCTION public.update_product_prices(_product_id uuid, _purchase_price numeric, _sale_price numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'cashier'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _purchase_price IS NULL OR _purchase_price < 0 OR _sale_price IS NULL OR _sale_price < 0 THEN
    RAISE EXCEPTION 'Prices must be non-negative';
  END IF;
  UPDATE public.products
     SET purchase_price = _purchase_price,
         sale_price = _sale_price,
         updated_at = now()
   WHERE id = _product_id;

  UPDATE public.product_units
     SET purchase_price = _purchase_price,
         sale_price     = _sale_price,
         updated_at     = now()
   WHERE product_id = _product_id AND is_base = true;
END;
$function$;

-- ========================================
-- 20260729144408_d4421cb2-5971-46fc-81b5-78ed5f8c40ef.sql
-- ========================================
CREATE OR REPLACE FUNCTION public.record_credit_repayment(_amount numeric, _person text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _uid uuid := auth.uid(); _name text; _session_id uuid; _id uuid; _p text;
begin
  if _uid is null then raise exception 'Not authenticated'; end if;
  if not (has_role(_uid, 'cashier'::app_role) or has_role(_uid, 'admin'::app_role)) then
    raise exception 'Not authorized'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Amount must be positive'; end if;
  _p := coalesce(trim(_person), '');
  if _p = '' then raise exception 'Select who is paying back'; end if;

  select id into _session_id from public.cash_sessions
   where user_id = _uid and status = 'open' limit 1;
  if _session_id is null then raise exception 'No open shift — start a shift first'; end if;

  select coalesce(full_name, username, 'Cashier') into _name from public.profiles where id = _uid;

  -- Negative expense = cash returned to drawer; also reduces the person's
  -- outstanding "Received" total in the Person Balance Report.
  insert into public.shift_expenses(session_id, cashier_id, cashier_name, amount, description)
  values (_session_id, _uid, coalesce(_name, ''), -1 * _amount, _p)
  returning id into _id;

  return jsonb_build_object('expense_id', _id, 'session_id', _session_id);
end; $function$;

REVOKE ALL ON FUNCTION public.record_credit_repayment(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_credit_repayment(numeric, text) TO authenticated;

-- ========================================
-- 20260729152542_4f11d08f-7096-4c99-9eed-7959d206285d.sql
-- ========================================

-- bill_sequences
DROP POLICY "billseq admin read" ON public.bill_sequences;
CREATE POLICY "billseq admin read" ON public.bill_sequences FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- cash_sessions
DROP POLICY "sessions admin read" ON public.cash_sessions;
CREATE POLICY "sessions admin read" ON public.cash_sessions FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "sessions admin update" ON public.cash_sessions;
CREATE POLICY "sessions admin update" ON public.cash_sessions FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "sessions own read" ON public.cash_sessions;
CREATE POLICY "sessions own read" ON public.cash_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- categories
DROP POLICY "cat admin write" ON public.categories;
CREATE POLICY "cat admin write" ON public.categories FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- daily_expenses
DROP POLICY "daily_expenses admin all" ON public.daily_expenses;
CREATE POLICY "daily_expenses admin all" ON public.daily_expenses FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- inventory_movements
DROP POLICY "inv_mov admin read" ON public.inventory_movements;
CREATE POLICY "inv_mov admin read" ON public.inventory_movements FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "inv_mov own read" ON public.inventory_movements;
CREATE POLICY "inv_mov own read" ON public.inventory_movements FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- operating_expenses
DROP POLICY "operating_expenses admin all" ON public.operating_expenses;
CREATE POLICY "operating_expenses admin all" ON public.operating_expenses FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- person_payments
DROP POLICY "person_payments admin all" ON public.person_payments;
CREATE POLICY "person_payments admin all" ON public.person_payments FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- product_units
DROP POLICY "punits admin write" ON public.product_units;
CREATE POLICY "punits admin write" ON public.product_units FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- products
DROP POLICY "prod admin write" ON public.products;
CREATE POLICY "prod admin write" ON public.products FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- profiles
DROP POLICY "profiles admin manage" ON public.profiles;
CREATE POLICY "profiles admin manage" ON public.profiles FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "profiles admin read all" ON public.profiles;
CREATE POLICY "profiles admin read all" ON public.profiles FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "profiles self read" ON public.profiles;
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- return_items
DROP POLICY "return_items read own" ON public.return_items;
CREATE POLICY "return_items read own" ON public.return_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM returns r WHERE r.id = return_items.return_id AND (r.cashier_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));

-- returns
DROP POLICY "returns admin read" ON public.returns;
CREATE POLICY "returns admin read" ON public.returns FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "returns own read" ON public.returns;
CREATE POLICY "returns own read" ON public.returns FOR SELECT TO authenticated USING (auth.uid() = cashier_id);

-- sale_items
DROP POLICY "sale_items read own" ON public.sale_items;
CREATE POLICY "sale_items read own" ON public.sale_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND (s.cashier_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));

-- sales
DROP POLICY "sales admin read" ON public.sales;
CREATE POLICY "sales admin read" ON public.sales FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "sales own read" ON public.sales;
CREATE POLICY "sales own read" ON public.sales FOR SELECT TO authenticated USING (auth.uid() = cashier_id);

-- shift_expenses
DROP POLICY "shift_expenses admin all" ON public.shift_expenses;
CREATE POLICY "shift_expenses admin all" ON public.shift_expenses FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "shift_expenses select own" ON public.shift_expenses;
CREATE POLICY "shift_expenses select own" ON public.shift_expenses FOR SELECT TO authenticated USING (cashier_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

-- stock_entries
DROP POLICY "stock_entries admin read" ON public.stock_entries;
CREATE POLICY "stock_entries admin read" ON public.stock_entries FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "stock_entries cashier insert" ON public.stock_entries;
CREATE POLICY "stock_entries cashier insert" ON public.stock_entries FOR INSERT TO authenticated WITH CHECK (auth.uid() = cashier_id AND (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));
DROP POLICY "stock_entries own read" ON public.stock_entries;
CREATE POLICY "stock_entries own read" ON public.stock_entries FOR SELECT TO authenticated USING (auth.uid() = cashier_id);

-- store_settings
DROP POLICY "settings admin write" ON public.store_settings;
CREATE POLICY "settings admin write" ON public.store_settings FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- supplier_payments
DROP POLICY "supplier_payments admin all" ON public.supplier_payments;
CREATE POLICY "supplier_payments admin all" ON public.supplier_payments FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "supplier_payments cashier insert" ON public.supplier_payments;
CREATE POLICY "supplier_payments cashier insert" ON public.supplier_payments FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));
DROP POLICY "supplier_payments cashier update" ON public.supplier_payments;
CREATE POLICY "supplier_payments cashier update" ON public.supplier_payments FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'cashier'::app_role)) WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));

-- supplier_purchases
DROP POLICY "supplier_purchases admin all" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases admin all" ON public.supplier_purchases FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "supplier_purchases cashier insert" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases cashier insert" ON public.supplier_purchases FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));
DROP POLICY "supplier_purchases cashier update" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases cashier update" ON public.supplier_purchases FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'cashier'::app_role)) WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));

-- suppliers
DROP POLICY "suppliers admin all" ON public.suppliers;
CREATE POLICY "suppliers admin all" ON public.suppliers FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "suppliers cashier insert" ON public.suppliers;
CREATE POLICY "suppliers cashier insert" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));
DROP POLICY "suppliers cashier update" ON public.suppliers;
CREATE POLICY "suppliers cashier update" ON public.suppliers FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'cashier'::app_role)) WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));

-- user_audit_log
DROP POLICY "audit admin insert" ON public.user_audit_log;
CREATE POLICY "audit admin insert" ON public.user_audit_log FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "audit admin read" ON public.user_audit_log;
CREATE POLICY "audit admin read" ON public.user_audit_log FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- user_roles
DROP POLICY "roles admin manage" ON public.user_roles;
CREATE POLICY "roles admin manage" ON public.user_roles FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "roles admin read" ON public.user_roles;
CREATE POLICY "roles admin read" ON public.user_roles FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "roles self read" ON public.user_roles;
CREATE POLICY "roles self read" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);


-- ========================================
-- 20260729153054_eb85c10a-dd61-4d3c-9017-d84b822887da.sql
-- ========================================

CREATE OR REPLACE FUNCTION public.get_credit_customers()
RETURNS TABLE(person_name text, balance numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ledger_start AS (SELECT DATE '2026-06-30' AS d),
  received AS (
    SELECT btrim(description) AS name, SUM(amount)::numeric AS amt
    FROM public.shift_expenses, ledger_start
    WHERE created_at >= (d::text || 'T00:00:00+05:00')::timestamptz
      AND btrim(coalesce(description,'')) <> ''
    GROUP BY btrim(description)
  ),
  paid_pp AS (
    SELECT btrim(person_name) AS name, SUM(amount)::numeric AS amt
    FROM public.person_payments, ledger_start
    WHERE payment_date >= d
    GROUP BY btrim(person_name)
  ),
  paid_op AS (
    SELECT btrim(paid_to) AS name, SUM(amount)::numeric AS amt
    FROM public.operating_expenses, ledger_start
    WHERE expense_date >= d
      AND btrim(coalesce(paid_to,'')) <> ''
    GROUP BY btrim(paid_to)
  ),
  starting AS (
    SELECT btrim(person_name) AS name, balance::numeric AS amt
    FROM public.person_starting_balances
  ),
  all_names AS (
    SELECT name FROM received
    UNION SELECT name FROM paid_pp
    UNION SELECT name FROM paid_op
    UNION SELECT name FROM starting
  )
  SELECT
    n.name,
    (COALESCE((SELECT amt FROM starting s WHERE s.name = n.name), 0)
     + COALESCE((SELECT amt FROM received r WHERE r.name = n.name), 0)
     - COALESCE((SELECT amt FROM paid_pp p WHERE p.name = n.name), 0)
     - COALESCE((SELECT amt FROM paid_op o WHERE o.name = n.name), 0))::numeric AS balance
  FROM all_names n
  WHERE lower(n.name) NOT IN ('junaid','usama')
    AND n.name <> ''
  HAVING (COALESCE((SELECT amt FROM starting s WHERE s.name = n.name), 0)
        + COALESCE((SELECT amt FROM received r WHERE r.name = n.name), 0)
        - COALESCE((SELECT amt FROM paid_pp p WHERE p.name = n.name), 0)
        - COALESCE((SELECT amt FROM paid_op o WHERE o.name = n.name), 0)) > 0
  ORDER BY balance DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_credit_customers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_credit_customers() TO authenticated;


-- ========================================
-- 20260729154528_bae08337-8475-4558-b9ac-8ddf177e1a72.sql
-- ========================================

CREATE OR REPLACE FUNCTION public.get_credit_customers()
RETURNS TABLE(person_name text, balance numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ledger_start AS (SELECT DATE '2026-06-30' AS d),
  received AS (
    SELECT btrim(se.description) AS nm, SUM(se.amount)::numeric AS amt
    FROM public.shift_expenses se, ledger_start
    WHERE se.created_at >= (ledger_start.d::text || 'T00:00:00+05:00')::timestamptz
      AND btrim(coalesce(se.description,'')) <> ''
    GROUP BY btrim(se.description)
  ),
  paid_pp AS (
    SELECT btrim(pp.person_name) AS nm, SUM(pp.amount)::numeric AS amt
    FROM public.person_payments pp, ledger_start
    WHERE pp.payment_date >= ledger_start.d
    GROUP BY btrim(pp.person_name)
  ),
  paid_op AS (
    SELECT btrim(oe.paid_to) AS nm, SUM(oe.amount)::numeric AS amt
    FROM public.operating_expenses oe, ledger_start
    WHERE oe.expense_date >= ledger_start.d
      AND btrim(coalesce(oe.paid_to,'')) <> ''
    GROUP BY btrim(oe.paid_to)
  ),
  starting AS (
    SELECT btrim(psb.person_name) AS nm, psb.balance::numeric AS amt
    FROM public.person_starting_balances psb
  ),
  all_names AS (
    SELECT nm FROM received
    UNION SELECT nm FROM paid_pp
    UNION SELECT nm FROM paid_op
    UNION SELECT nm FROM starting
  ),
  computed AS (
    SELECT
      n.nm AS nm,
      (COALESCE((SELECT amt FROM starting s WHERE s.nm = n.nm), 0)
       + COALESCE((SELECT amt FROM received r WHERE r.nm = n.nm), 0)
       - COALESCE((SELECT amt FROM paid_pp p WHERE p.nm = n.nm), 0)
       - COALESCE((SELECT amt FROM paid_op o WHERE o.nm = n.nm), 0))::numeric AS bal
    FROM all_names n
    WHERE lower(n.nm) NOT IN ('junaid','usama')
      AND n.nm <> ''
  )
  SELECT c.nm AS person_name, c.bal AS balance
  FROM computed c
  WHERE c.bal > 0
  ORDER BY c.bal DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_credit_customers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_credit_customers() TO authenticated;


-- ========================================
-- 20260729171425_dff9dde6-5aac-4b2f-b3ee-87a7f98b650f.sql
-- ========================================
UPDATE public.product_units u
SET purchase_price = p.purchase_price,
    sale_price = p.sale_price,
    updated_at = now()
FROM public.products p
WHERE u.product_id = p.id
  AND u.is_base = true
  AND (u.purchase_price <> p.purchase_price OR u.sale_price <> p.sale_price);

CREATE OR REPLACE FUNCTION public.sync_base_unit_prices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.purchase_price IS DISTINCT FROM OLD.purchase_price
     OR NEW.sale_price IS DISTINCT FROM OLD.sale_price THEN
    UPDATE public.product_units
       SET purchase_price = NEW.purchase_price,
           sale_price     = NEW.sale_price,
           updated_at     = now()
     WHERE product_id = NEW.id AND is_base = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_base_unit_prices ON public.products;
CREATE TRIGGER trg_sync_base_unit_prices
AFTER UPDATE OF purchase_price, sale_price ON public.products
FOR EACH ROW EXECUTE FUNCTION public.sync_base_unit_prices();

-- ========================================
-- 20260730170126_feb6ed86-14d7-4385-9fed-00877eddb1dd.sql
-- ========================================
CREATE OR REPLACE FUNCTION public.close_shift(_closing_cash numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _session_id uuid; _opening numeric; _cash_sales numeric;
        _online_sales numeric; _paid_out numeric; _expenses numeric; _expected numeric; _diff numeric;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select id, opening_cash into _session_id, _opening from public.cash_sessions
   where user_id = auth.uid() and status = 'open' for update;
  if _session_id is null then raise exception 'No open shift'; end if;

  select
    coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) =  'cash'), 0),
    coalesce(sum(total) filter (where lower(trim(coalesce(payment_type,'cash'))) <> 'cash'), 0)
  into _cash_sales, _online_sales
  from public.sales where session_id = _session_id;

  select coalesce(sum(amount), 0) into _paid_out
  from public.supplier_payments
   where session_id = _session_id and lower(trim(coalesce(method,'cash'))) = 'cash';

  select coalesce(sum(amount), 0) into _expenses
  from public.shift_expenses where session_id = _session_id;

  _expected := _opening + _cash_sales - _paid_out - _expenses;
  _diff     := _closing_cash - _expected;

  if _closing_cash < _expected then
    raise exception 'Closing cash is short by Rs. %. It must be at least Rs. %.',
      round(_expected - _closing_cash, 2), round(_expected, 2);
  end if;

  update public.cash_sessions
     set closing_cash=_closing_cash, cash_sales=_cash_sales, online_sales=_online_sales,
         cash_paid_out=_paid_out, expenses=_expenses, expected_cash=_expected, difference=_diff,
         status='closed', closed_at=now()
   where id = _session_id;

  return jsonb_build_object('session_id',_session_id,'opening_cash',_opening,
    'cash_sales',_cash_sales,'online_sales',_online_sales,'cash_paid_out',_paid_out,
    'expenses',_expenses,'expected_cash',_expected,'closing_cash',_closing_cash,'difference',_diff);
end; $function$;

-- ========================================
-- 20260731144827_12ef11cb-3719-45e9-93d8-fe37f9ee9ce9.sql
-- ========================================
REVOKE ALL ON FUNCTION public.sync_base_unit_prices() FROM PUBLIC, anon, authenticated;

-- ========================================
-- 20260805083602_bbd4134a-0f60-4147-a976-fd740a550114.sql
-- ========================================
CREATE OR REPLACE FUNCTION public.update_product_prices(_product_id uuid, _purchase_price numeric, _sale_price numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change prices. Please submit a price change request.';
  END IF;
  IF _purchase_price IS NULL OR _purchase_price < 0 OR _sale_price IS NULL OR _sale_price < 0 THEN
    RAISE EXCEPTION 'Prices must be non-negative';
  END IF;
  UPDATE public.products
     SET purchase_price = _purchase_price,
         sale_price = _sale_price,
         updated_at = now()
   WHERE id = _product_id;

  UPDATE public.product_units
     SET purchase_price = _purchase_price,
         sale_price     = _sale_price,
         updated_at     = now()
   WHERE product_id = _product_id AND is_base = true;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_product_prices(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_prices(uuid, numeric, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_product_with_units(_product jsonb, _units jsonb, _initial_stock jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _pid uuid;
  _is_new boolean := false;
  _is_admin boolean;
  _base_id uuid;
  _u jsonb;
  _new_unit_id uuid;
  _bases_count int;
  _init_unit uuid;
  _init_qty int;
  _init_base int;
  _init_equals int;
  _name text;
BEGIN
  _is_admin := has_role(auth.uid(), 'admin'::app_role);
  IF NOT (_is_admin OR has_role(auth.uid(), 'cashier'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  _pid := NULLIF(_product->>'id','')::uuid;

  IF _units IS NULL OR jsonb_array_length(_units) = 0 THEN
    RAISE EXCEPTION 'At least one unit is required';
  END IF;
  SELECT count(*) INTO _bases_count FROM jsonb_array_elements(_units) u WHERE (u->>'is_base')::boolean = true;
  IF _bases_count <> 1 THEN RAISE EXCEPTION 'Exactly one base unit is required'; END IF;

  IF _pid IS NULL THEN
    _is_new := true;
    INSERT INTO public.products (name, barcode, category_id, purchase_price, sale_price, stock, min_stock_alert, is_active)
    VALUES (
      _product->>'name',
      _product->>'barcode',
      NULLIF(_product->>'category_id','')::uuid,
      COALESCE((_product->>'purchase_price')::numeric, 0),
      COALESCE((_product->>'sale_price')::numeric, 0),
      0,
      COALESCE((_product->>'min_stock_alert')::int, 5),
      COALESCE((_product->>'is_active')::boolean, true)
    ) RETURNING id INTO _pid;
  ELSE
    UPDATE public.products SET
      name = _product->>'name',
      barcode = _product->>'barcode',
      category_id = NULLIF(_product->>'category_id','')::uuid,
      -- Only admins may change prices on an existing product; cashiers must use price change requests
      purchase_price = CASE WHEN _is_admin THEN COALESCE((_product->>'purchase_price')::numeric, purchase_price) ELSE purchase_price END,
      sale_price = CASE WHEN _is_admin THEN COALESCE((_product->>'sale_price')::numeric, sale_price) ELSE sale_price END,
      min_stock_alert = COALESCE((_product->>'min_stock_alert')::int, min_stock_alert),
      is_active = COALESCE((_product->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = _pid;
  END IF;

  DELETE FROM public.product_units
  WHERE product_id = _pid
    AND id NOT IN (
      SELECT NULLIF(x->>'id','')::uuid FROM jsonb_array_elements(_units) x
      WHERE NULLIF(x->>'id','') IS NOT NULL
    );

  FOR _u IN SELECT * FROM jsonb_array_elements(_units) LOOP
    IF NULLIF(_u->>'id','') IS NOT NULL THEN
      UPDATE public.product_units SET
        name = _u->>'name',
        equals_base = (_u->>'equals_base')::int,
        is_base = (_u->>'is_base')::boolean,
        is_default_sale = COALESCE((_u->>'is_default_sale')::boolean, false),
        sku = NULLIF(_u->>'sku',''),
        barcode = NULLIF(_u->>'barcode',''),
        purchase_price = CASE WHEN _is_admin THEN COALESCE((_u->>'purchase_price')::numeric, 0) ELSE purchase_price END,
        sale_price = CASE WHEN _is_admin THEN COALESCE((_u->>'sale_price')::numeric, 0) ELSE sale_price END,
        sort_order = COALESCE((_u->>'sort_order')::int, 0),
        updated_at = now()
      WHERE id = (_u->>'id')::uuid AND product_id = _pid
      RETURNING id INTO _new_unit_id;
    ELSE
      INSERT INTO public.product_units(product_id, name, equals_base, is_base, is_default_sale, sku, barcode, purchase_price, sale_price, sort_order)
      VALUES (
        _pid, _u->>'name', (_u->>'equals_base')::int,
        (_u->>'is_base')::boolean, COALESCE((_u->>'is_default_sale')::boolean, false),
        NULLIF(_u->>'sku',''), NULLIF(_u->>'barcode',''),
        COALESCE((_u->>'purchase_price')::numeric, 0),
        COALESCE((_u->>'sale_price')::numeric, 0),
        COALESCE((_u->>'sort_order')::int, 0)
      ) RETURNING id INTO _new_unit_id;
    END IF;

    IF (_u->>'is_base')::boolean THEN _base_id := _new_unit_id; END IF;
  END LOOP;

  UPDATE public.products SET base_unit_id = _base_id WHERE id = _pid;

  IF _initial_stock IS NOT NULL AND (_initial_stock->>'qty') IS NOT NULL THEN
    _init_unit := (_initial_stock->>'unit_id')::uuid;
    _init_qty := (_initial_stock->>'qty')::int;
    IF _init_qty > 0 AND _init_unit IS NOT NULL THEN
      SELECT equals_base, name INTO _init_equals, _name FROM public.product_units WHERE id = _init_unit;
      IF _init_equals IS NULL THEN RAISE EXCEPTION 'Initial stock unit not found'; END IF;
      _init_base := _init_qty * _init_equals;
      UPDATE public.products SET stock = stock + _init_base, updated_at = now() WHERE id = _pid;
      INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, user_id, user_name)
      VALUES (_pid, _init_unit, _name, _init_qty, _init_base, 'initial', auth.uid(),
        COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), ''));
    END IF;
  END IF;

  RETURN _pid;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_product_with_units(jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_units(jsonb, jsonb, jsonb) TO authenticated;

