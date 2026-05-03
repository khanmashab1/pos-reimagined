
-- Cash sessions table
CREATE TABLE public.cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text NOT NULL DEFAULT '',
  opening_cash numeric NOT NULL DEFAULT 0,
  closing_cash numeric,
  cash_sales numeric NOT NULL DEFAULT 0,
  expected_cash numeric NOT NULL DEFAULT 0,
  difference numeric,
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

-- Only one open session per user
CREATE UNIQUE INDEX cash_sessions_one_open_per_user
  ON public.cash_sessions(user_id) WHERE status = 'open';

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions own read" ON public.cash_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "sessions admin read" ON public.cash_sessions
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- Add columns to sales
ALTER TABLE public.sales
  ADD COLUMN session_id uuid REFERENCES public.cash_sessions(id),
  ADD COLUMN payment_method text NOT NULL DEFAULT 'cash';

CREATE INDEX sales_session_id_idx ON public.sales(session_id);

-- Open shift
CREATE OR REPLACE FUNCTION public.open_shift(_opening_cash numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_name text;
  _session_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF EXISTS (SELECT 1 FROM public.cash_sessions WHERE user_id = auth.uid() AND status = 'open') THEN
    RAISE EXCEPTION 'You already have an open shift';
  END IF;

  SELECT coalesce(full_name, username, 'Cashier') INTO _user_name
  FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.cash_sessions(user_id, user_name, opening_cash, expected_cash, status)
  VALUES (auth.uid(), coalesce(_user_name, ''), _opening_cash, _opening_cash, 'open')
  RETURNING id INTO _session_id;

  RETURN jsonb_build_object('session_id', _session_id);
END;
$$;

-- Close shift
CREATE OR REPLACE FUNCTION public.close_shift(_closing_cash numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _session_id uuid;
  _opening numeric;
  _cash_sales numeric;
  _expected numeric;
  _diff numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id, opening_cash INTO _session_id, _opening
  FROM public.cash_sessions
  WHERE user_id = auth.uid() AND status = 'open'
  FOR UPDATE;

  IF _session_id IS NULL THEN RAISE EXCEPTION 'No open shift'; END IF;

  SELECT coalesce(sum(total), 0) INTO _cash_sales
  FROM public.sales
  WHERE session_id = _session_id AND payment_method = 'cash';

  _expected := _opening + _cash_sales;
  _diff := _closing_cash - _expected;

  UPDATE public.cash_sessions
  SET closing_cash = _closing_cash,
      cash_sales = _cash_sales,
      expected_cash = _expected,
      difference = _diff,
      status = 'closed',
      closed_at = now()
  WHERE id = _session_id;

  RETURN jsonb_build_object(
    'session_id', _session_id,
    'opening_cash', _opening,
    'cash_sales', _cash_sales,
    'expected_cash', _expected,
    'closing_cash', _closing_cash,
    'difference', _diff
  );
END;
$$;

-- Get open session with live cash sales
CREATE OR REPLACE FUNCTION public.get_open_session()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s record;
  _cash_sales numeric;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _s FROM public.cash_sessions
  WHERE user_id = auth.uid() AND status = 'open' LIMIT 1;

  IF _s.id IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(sum(total), 0) INTO _cash_sales
  FROM public.sales
  WHERE session_id = _s.id AND payment_method = 'cash';

  RETURN jsonb_build_object(
    'id', _s.id,
    'opening_cash', _s.opening_cash,
    'cash_sales', _cash_sales,
    'expected_cash', _s.opening_cash + _cash_sales,
    'opened_at', _s.opened_at
  );
END;
$$;

-- Update process_sale to require open session and store session_id + payment_method
CREATE OR REPLACE FUNCTION public.process_sale(
  _items jsonb, _subtotal numeric, _tax_amount numeric, _discount numeric,
  _total numeric, _cash_received numeric, _change_returned numeric, _payment_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _bill_no text;
  _sale_id uuid;
  _cashier_name text;
  _session_id uuid;
  _payment_method text;
  _item jsonb;
  _items_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id INTO _session_id FROM public.cash_sessions
  WHERE user_id = auth.uid() AND status = 'open' LIMIT 1;

  IF _session_id IS NULL THEN
    RAISE EXCEPTION 'No open shift. Please start a shift before making sales.';
  END IF;

  _payment_method := CASE WHEN lower(coalesce(_payment_type,'cash')) = 'card' THEN 'card' ELSE 'cash' END;

  SELECT coalesce(full_name, username, 'Cashier') INTO _cashier_name
  FROM public.profiles WHERE id = auth.uid();

  _bill_no := public.next_bill_no('ZIC');

  INSERT INTO public.sales(bill_no, cashier_id, cashier_name, subtotal, tax_amount, discount, total,
    cash_received, change_returned, payment_type, items_count, session_id, payment_method)
  VALUES (_bill_no, auth.uid(), coalesce(_cashier_name,''), _subtotal, _tax_amount, _discount, _total,
    _cash_received, _change_returned, _payment_type, 0, _session_id, _payment_method)
  RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    INSERT INTO public.sale_items(sale_id, product_id, product_name, barcode, qty, unit_price, purchase_price, subtotal)
    VALUES (
      _sale_id,
      (_item->>'product_id')::uuid,
      _item->>'product_name',
      coalesce(_item->>'barcode',''),
      (_item->>'qty')::int,
      (_item->>'unit_price')::numeric,
      coalesce((_item->>'purchase_price')::numeric, 0),
      (_item->>'subtotal')::numeric
    );

    UPDATE public.products
      SET stock = stock - (_item->>'qty')::int, updated_at = now()
      WHERE id = (_item->>'product_id')::uuid;

    _items_count := _items_count + (_item->>'qty')::int;
  END LOOP;

  UPDATE public.sales SET items_count = _items_count WHERE id = _sale_id;

  RETURN jsonb_build_object('sale_id', _sale_id, 'bill_no', _bill_no);
END;
$$;
