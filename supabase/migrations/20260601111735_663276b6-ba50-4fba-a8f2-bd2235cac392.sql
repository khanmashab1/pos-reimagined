CREATE POLICY "prod cashier insert"
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'cashier') OR public.has_role(auth.uid(), 'admin')
);