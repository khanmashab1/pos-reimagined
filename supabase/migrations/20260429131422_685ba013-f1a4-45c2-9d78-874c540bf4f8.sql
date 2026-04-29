
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
