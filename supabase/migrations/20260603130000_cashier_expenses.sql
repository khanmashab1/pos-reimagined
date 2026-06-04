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
