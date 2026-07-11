CREATE OR REPLACE FUNCTION public.update_product_prices(_product_id uuid, _purchase_price numeric, _sale_price numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'cashier'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _purchase_price IS NULL OR _purchase_price < 0 OR _sale_price IS NULL OR _sale_price < 0 THEN
    RAISE EXCEPTION 'Prices must be non-negative';
  END IF;
  UPDATE public.products
     SET purchase_price = _purchase_price,
         sale_price = _sale_price,
         updated_at = now()
   WHERE id = _product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_product_prices(uuid, numeric, numeric) TO authenticated;