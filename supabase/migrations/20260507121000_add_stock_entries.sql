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
