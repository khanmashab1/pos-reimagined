ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_unit_id_fkey;
ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_unit_id_fkey
  FOREIGN KEY (unit_id) REFERENCES public.product_units(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_unit_id_fkey;
ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_unit_id_fkey
  FOREIGN KEY (unit_id) REFERENCES public.product_units(id) ON DELETE SET NULL;