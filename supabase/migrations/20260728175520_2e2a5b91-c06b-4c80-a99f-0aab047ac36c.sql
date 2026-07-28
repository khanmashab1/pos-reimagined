-- Backfill base unit prices from product row where base unit is zero
UPDATE public.product_units pu
SET purchase_price = p.purchase_price,
    sale_price = p.sale_price,
    updated_at = now()
FROM public.products p
WHERE pu.product_id = p.id
  AND pu.is_base = true
  AND (pu.sale_price = 0 OR pu.purchase_price = 0)
  AND (p.sale_price > 0 OR p.purchase_price > 0);

-- Update RPC to keep base unit in sync going forward
CREATE OR REPLACE FUNCTION public.update_product_prices(_product_id uuid, _purchase_price numeric, _sale_price numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  UPDATE public.product_units
     SET purchase_price = _purchase_price,
         sale_price     = _sale_price,
         updated_at     = now()
   WHERE product_id = _product_id AND is_base = true;
END;
$function$;