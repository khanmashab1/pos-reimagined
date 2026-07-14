
CREATE TABLE public.manual_sale_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL UNIQUE,
  cash_junaid numeric NOT NULL DEFAULT 0,
  cash_usama numeric NOT NULL DEFAULT 0,
  cash_zahid numeric NOT NULL DEFAULT 0,
  others numeric NOT NULL DEFAULT 0,
  counter_cash numeric NOT NULL DEFAULT 0,
  today_expenses_override numeric,
  previous_expense_override numeric,
  notes text NOT NULL DEFAULT '',
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_sale_days TO authenticated;
GRANT ALL ON public.manual_sale_days TO service_role;

ALTER TABLE public.manual_sale_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage manual sale days" ON public.manual_sale_days
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Cashiers can read manual sale days" ON public.manual_sale_days
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'cashier') OR public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_manual_sale_days_touch
  BEFORE UPDATE ON public.manual_sale_days
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
