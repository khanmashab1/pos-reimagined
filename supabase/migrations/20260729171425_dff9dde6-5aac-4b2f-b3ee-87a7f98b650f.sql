UPDATE public.product_units u
SET purchase_price = p.purchase_price,
    sale_price = p.sale_price,
    updated_at = now()
FROM public.products p
WHERE u.product_id = p.id
  AND u.is_base = true
  AND (u.purchase_price <> p.purchase_price OR u.sale_price <> p.sale_price);

CREATE OR REPLACE FUNCTION public.sync_base_unit_prices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.purchase_price IS DISTINCT FROM OLD.purchase_price
     OR NEW.sale_price IS DISTINCT FROM OLD.sale_price THEN
    UPDATE public.product_units
       SET purchase_price = NEW.purchase_price,
           sale_price     = NEW.sale_price,
           updated_at     = now()
     WHERE product_id = NEW.id AND is_base = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_base_unit_prices ON public.products;
CREATE TRIGGER trg_sync_base_unit_prices
AFTER UPDATE OF purchase_price, sale_price ON public.products
FOR EACH ROW EXECUTE FUNCTION public.sync_base_unit_prices();