-- Fix missing tables from partial migration
-- Run this in Supabase SQL Editor if you already have the base schema

-- Cash sessions
CREATE TABLE IF NOT EXISTS public.cash_sessions (
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

CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_per_user
  ON public.cash_sessions(user_id) WHERE status = 'open';

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions own read" ON public.cash_sessions;
CREATE POLICY "sessions own read" ON public.cash_sessions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "sessions admin read" ON public.cash_sessions;
CREATE POLICY "sessions admin read" ON public.cash_sessions
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- Add columns to sales (safe to re-run)
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.cash_sessions(id);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash';

CREATE INDEX IF NOT EXISTS sales_session_id_idx ON public.sales(session_id);

-- Open shift function
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

-- Close shift function
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
  FROM public.cash_sessions WHERE user_id = auth.uid() AND status = 'open' FOR UPDATE;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'No open shift'; END IF;
  SELECT coalesce(sum(total), 0) INTO _cash_sales
  FROM public.sales WHERE session_id = _session_id AND payment_method = 'cash';
  _expected := _opening + _cash_sales;
  _diff := _closing_cash - _expected;
  UPDATE public.cash_sessions
  SET closing_cash = _closing_cash, cash_sales = _cash_sales,
      expected_cash = _expected, difference = _diff,
      status = 'closed', closed_at = now()
  WHERE id = _session_id;
  RETURN jsonb_build_object('session_id', _session_id, 'opening_cash', _opening,
    'cash_sales', _cash_sales, 'expected_cash', _expected,
    'closing_cash', _closing_cash, 'difference', _diff);
END;
$$;

-- Get open session function
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
  FROM public.sales WHERE session_id = _s.id AND payment_method = 'cash';
  RETURN jsonb_build_object('id', _s.id, 'opening_cash', _s.opening_cash,
    'cash_sales', _cash_sales, 'expected_cash', _s.opening_cash + _cash_sales, 'opened_at', _s.opened_at);
END;
$$;

-- Suppliers
CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  bill_no text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'cash',
  notes text NOT NULL DEFAULT '',
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_purchases_supplier ON public.supplier_purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments(supplier_id);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers admin all" ON public.suppliers;
CREATE POLICY "suppliers admin all" ON public.suppliers
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "supplier_purchases admin all" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases admin all" ON public.supplier_purchases
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "supplier_payments admin all" ON public.supplier_payments;
CREATE POLICY "supplier_payments admin all" ON public.supplier_payments
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "suppliers cashier select" ON public.suppliers;
CREATE POLICY "suppliers cashier select" ON public.suppliers
  FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));

DROP POLICY IF EXISTS "supplier_purchases cashier select" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases cashier select" ON public.supplier_purchases
  FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));

DROP POLICY IF EXISTS "supplier_payments cashier select" ON public.supplier_payments;
CREATE POLICY "supplier_payments cashier select" ON public.supplier_payments
  FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));

DROP TRIGGER IF EXISTS trg_suppliers_updated ON public.suppliers;
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.get_suppliers_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY t.name), '[]'::jsonb)
  FROM (
    SELECT s.id, s.name, s.phone, s.address, s.notes,
      coalesce((SELECT sum(amount) FROM public.supplier_purchases WHERE supplier_id = s.id), 0) AS total_purchases,
      coalesce((SELECT sum(amount) FROM public.supplier_payments WHERE supplier_id = s.id), 0) AS total_paid,
      coalesce((SELECT sum(amount) FROM public.supplier_purchases WHERE supplier_id = s.id), 0)
        - coalesce((SELECT sum(amount) FROM public.supplier_payments WHERE supplier_id = s.id), 0) AS balance
    FROM public.suppliers s
    WHERE s.is_active = true
  ) t;
$$;

-- Stock entries
CREATE TABLE IF NOT EXISTS public.stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES auth.users(id),
  cashier_name text NOT NULL DEFAULT '',
  qty integer NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_entries ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_stock_entries_product ON public.stock_entries(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_entries_cashier ON public.stock_entries(cashier_id);
CREATE INDEX IF NOT EXISTS idx_stock_entries_created ON public.stock_entries(created_at desc);

DROP POLICY IF EXISTS "Cashiers can create stock entries" ON public.stock_entries;
CREATE POLICY "Cashiers can create stock entries" ON public.stock_entries
  FOR INSERT WITH CHECK (auth.uid() = cashier_id);

DROP POLICY IF EXISTS "Admins can view all stock entries" ON public.stock_entries;
CREATE POLICY "Admins can view all stock entries" ON public.stock_entries
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Cashiers can view their own stock entries" ON public.stock_entries;
CREATE POLICY "Cashiers can view their own stock entries" ON public.stock_entries
  FOR SELECT USING (auth.uid() = cashier_id);

-- Function for cashiers to add stock
CREATE OR REPLACE FUNCTION public.add_stock_entry(
  _product_id uuid, _qty integer, _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cashier_name text;
  _entry_id uuid;
  _new_stock integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
  SELECT COALESCE(full_name, username, 'Cashier') INTO _cashier_name
  FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.stock_entries(product_id, cashier_id, cashier_name, qty, notes)
  VALUES (_product_id, auth.uid(), COALESCE(_cashier_name, ''), _qty, _notes)
  RETURNING id INTO _entry_id;
  UPDATE public.products SET stock = stock + _qty WHERE id = _product_id RETURNING stock INTO _new_stock;
  RETURN jsonb_build_object('entry_id', _entry_id, 'message', 'Stock entry recorded', 'new_stock', _new_stock);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_stock_entry(uuid, integer, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.add_stock_entry(uuid, integer, text) TO authenticated;
