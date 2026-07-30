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