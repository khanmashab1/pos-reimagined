CREATE TABLE IF NOT EXISTS public.person_starting_balances (
  person_name text PRIMARY KEY,
  balance numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.person_starting_balances TO authenticated;
GRANT ALL ON public.person_starting_balances TO service_role;
ALTER TABLE public.person_starting_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage starting balances" ON public.person_starting_balances
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins read starting balances" ON public.person_starting_balances
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));