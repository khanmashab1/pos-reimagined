
-- Suppliers
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Purchases (free-text bills from supplier)
CREATE TABLE public.supplier_purchases (
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

-- Payments to supplier
CREATE TABLE public.supplier_payments (
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

CREATE INDEX idx_supplier_purchases_supplier ON public.supplier_purchases(supplier_id);
CREATE INDEX idx_supplier_payments_supplier ON public.supplier_payments(supplier_id);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

-- Admin only
CREATE POLICY "suppliers admin all" ON public.suppliers
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "supplier_purchases admin all" ON public.supplier_purchases
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "supplier_payments admin all" ON public.supplier_payments
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Summary function: returns suppliers with totals
CREATE OR REPLACE FUNCTION public.get_suppliers_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN NOT public.has_role(auth.uid(), 'admin') THEN '[]'::jsonb
    ELSE coalesce(jsonb_agg(row_to_json(t) ORDER BY t.name), '[]'::jsonb)
  END
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
