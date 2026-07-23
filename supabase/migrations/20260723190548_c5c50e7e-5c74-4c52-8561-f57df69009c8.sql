
CREATE TABLE public.stock_reconciliations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.product_units(id) ON DELETE SET NULL,
  system_stock NUMERIC NOT NULL DEFAULT 0,
  physical_stock NUMERIC NOT NULL DEFAULT 0,
  difference NUMERIC NOT NULL DEFAULT 0,
  cost_price NUMERIC NOT NULL DEFAULT 0,
  cost_impact NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.stock_reconciliations TO authenticated;
GRANT ALL ON public.stock_reconciliations TO service_role;

ALTER TABLE public.stock_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own reconciliations"
  ON public.stock_reconciliations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can view their own reconciliations"
  ON public.stock_reconciliations FOR SELECT
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Admins can view all reconciliations"
  ON public.stock_reconciliations FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_stock_reconciliations_product ON public.stock_reconciliations(product_id);
CREATE INDEX idx_stock_reconciliations_created_at ON public.stock_reconciliations(created_at DESC);
