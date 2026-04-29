
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
