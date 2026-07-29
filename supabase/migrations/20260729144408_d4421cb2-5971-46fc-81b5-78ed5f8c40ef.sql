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