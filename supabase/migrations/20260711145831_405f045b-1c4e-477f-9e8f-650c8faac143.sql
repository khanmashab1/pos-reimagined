-- Backfill zero purchase_price on sale_items from products.purchase_price
UPDATE public.sale_items si
SET purchase_price = p.purchase_price
FROM public.products p
WHERE si.product_id = p.id
  AND COALESCE(si.purchase_price, 0) = 0
  AND COALESCE(p.purchase_price, 0) > 0;

-- Same for return_items via product cost (no cost column here, but ensure future consistency handled elsewhere)