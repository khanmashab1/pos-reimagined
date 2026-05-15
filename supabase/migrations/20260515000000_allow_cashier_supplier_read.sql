-- Allow cashiers to read suppliers (but not write)
CREATE POLICY "suppliers cashier select" ON public.suppliers
  FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));

CREATE POLICY "supplier_purchases cashier select" ON public.supplier_purchases
  FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));

CREATE POLICY "supplier_payments cashier select" ON public.supplier_payments
  FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));

-- Update summary function to allow cashiers to see data
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
