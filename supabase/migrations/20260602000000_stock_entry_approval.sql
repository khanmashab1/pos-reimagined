
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
