
CREATE OR REPLACE FUNCTION public.change_sale_payment(_sale_id uuid, _new_payment text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  is_cash_old boolean;
  is_cash_new boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _new_payment NOT IN ('cash','card','easypasa','jazzcash') THEN
    RAISE EXCEPTION 'Invalid payment type: %', _new_payment;
  END IF;

  SELECT * INTO s FROM public.sales WHERE id = _sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  -- Only the cashier who made the sale (or an admin) can change it
  IF s.cashier_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not allowed to modify this sale';
  END IF;

  IF s.session_id IS NULL THEN
    RAISE EXCEPTION 'Sale is not linked to a shift';
  END IF;

  -- Must be one of the last 5 bills for this cashier in the same shift
  IF NOT EXISTS (
    SELECT 1 FROM (
      SELECT id FROM public.sales
      WHERE cashier_id = s.cashier_id
        AND session_id = s.session_id
      ORDER BY created_at DESC
      LIMIT 5
    ) t
    WHERE t.id = _sale_id
  ) THEN
    RAISE EXCEPTION 'Only the last 5 bills of this shift can be changed';
  END IF;

  is_cash_old := (s.payment_type = 'cash');
  is_cash_new := (_new_payment = 'cash');

  UPDATE public.sales
     SET payment_type   = _new_payment,
         payment_method = _new_payment,
         cash_received  = CASE WHEN is_cash_new THEN total ELSE 0 END,
         change_returned = 0
   WHERE id = _sale_id;

  IF is_cash_old <> is_cash_new THEN
    IF is_cash_new THEN
      UPDATE public.cash_sessions
         SET cash_sales    = cash_sales   + s.total,
             online_sales  = GREATEST(online_sales - s.total, 0),
             expected_cash = expected_cash + s.total
       WHERE id = s.session_id;
    ELSE
      UPDATE public.cash_sessions
         SET cash_sales    = GREATEST(cash_sales - s.total, 0),
             online_sales  = online_sales + s.total,
             expected_cash = GREATEST(expected_cash - s.total, 0)
       WHERE id = s.session_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'sale_id', _sale_id, 'payment_type', _new_payment);
END;
$$;

REVOKE ALL ON FUNCTION public.change_sale_payment(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_sale_payment(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.change_sale_payment(uuid, text) TO authenticated;
