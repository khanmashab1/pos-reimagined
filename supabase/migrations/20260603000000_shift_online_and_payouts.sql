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
