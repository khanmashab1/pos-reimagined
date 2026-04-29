
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
