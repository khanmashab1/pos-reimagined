
CREATE TABLE public.manual_sale_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_sale_persons TO authenticated;
GRANT ALL ON public.manual_sale_persons TO service_role;

ALTER TABLE public.manual_sale_persons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage persons" ON public.manual_sale_persons
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Authenticated read persons" ON public.manual_sale_persons
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.manual_sale_persons (name, sort_order) VALUES
  ('Junaid', 1), ('Usama', 2), ('Zahid Ali', 3)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.manual_sale_days
  ADD COLUMN IF NOT EXISTS cash_by_person jsonb NOT NULL DEFAULT '{}'::jsonb;
