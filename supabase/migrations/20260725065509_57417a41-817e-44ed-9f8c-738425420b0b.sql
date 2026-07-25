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