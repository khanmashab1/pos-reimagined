CREATE TABLE public.stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  cashier_id uuid NOT NULL,
  cashier_name text NOT NULL DEFAULT '',
  qty integer NOT NULL CHECK (qty > 0),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.stock_entries TO authenticated;
GRANT ALL ON public.stock_entries TO service_role;

ALTER TABLE public.stock_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_entries admin read" ON public.stock_entries
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "stock_entries own read" ON public.stock_entries
  FOR SELECT USING (auth.uid() = cashier_id);

CREATE POLICY "stock_entries cashier insert" ON public.stock_entries
  FOR INSERT WITH CHECK (
    auth.uid() = cashier_id AND
    (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE INDEX idx_stock_entries_product ON public.stock_entries(product_id);
CREATE INDEX idx_stock_entries_cashier ON public.stock_entries(cashier_id);
CREATE INDEX idx_stock_entries_created ON public.stock_entries(created_at DESC);

CREATE OR REPLACE FUNCTION public.add_stock_entry(
  _product_id uuid, _qty integer, _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _name text;
  _entry_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (has_role(_uid, 'cashier'::app_role) OR has_role(_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;

  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;

  INSERT INTO public.stock_entries (product_id, cashier_id, cashier_name, qty, notes)
  VALUES (_product_id, _uid, COALESCE(_name, ''), _qty, COALESCE(_notes, ''))
  RETURNING id INTO _entry_id;

  UPDATE public.products SET stock = stock + _qty, updated_at = now() WHERE id = _product_id;

  RETURN _entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_stock_entry(uuid, integer, text) TO authenticated;
