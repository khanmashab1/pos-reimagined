CREATE OR REPLACE FUNCTION public.update_product_prices(_product_id uuid, _purchase_price numeric, _sale_price numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change prices. Please submit a price change request.';
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

REVOKE ALL ON FUNCTION public.update_product_prices(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_prices(uuid, numeric, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_product_with_units(_product jsonb, _units jsonb, _initial_stock jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _pid uuid;
  _is_new boolean := false;
  _is_admin boolean;
  _base_id uuid;
  _u jsonb;
  _new_unit_id uuid;
  _bases_count int;
  _init_unit uuid;
  _init_qty int;
  _init_base int;
  _init_equals int;
  _name text;
BEGIN
  _is_admin := has_role(auth.uid(), 'admin'::app_role);
  IF NOT (_is_admin OR has_role(auth.uid(), 'cashier'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  _pid := NULLIF(_product->>'id','')::uuid;

  IF _units IS NULL OR jsonb_array_length(_units) = 0 THEN
    RAISE EXCEPTION 'At least one unit is required';
  END IF;
  SELECT count(*) INTO _bases_count FROM jsonb_array_elements(_units) u WHERE (u->>'is_base')::boolean = true;
  IF _bases_count <> 1 THEN RAISE EXCEPTION 'Exactly one base unit is required'; END IF;

  IF _pid IS NULL THEN
    _is_new := true;
    INSERT INTO public.products (name, barcode, category_id, purchase_price, sale_price, stock, min_stock_alert, is_active)
    VALUES (
      _product->>'name',
      _product->>'barcode',
      NULLIF(_product->>'category_id','')::uuid,
      COALESCE((_product->>'purchase_price')::numeric, 0),
      COALESCE((_product->>'sale_price')::numeric, 0),
      0,
      COALESCE((_product->>'min_stock_alert')::int, 5),
      COALESCE((_product->>'is_active')::boolean, true)
    ) RETURNING id INTO _pid;
  ELSE
    UPDATE public.products SET
      name = _product->>'name',
      barcode = _product->>'barcode',
      category_id = NULLIF(_product->>'category_id','')::uuid,
      -- Only admins may change prices on an existing product; cashiers must use price change requests
      purchase_price = CASE WHEN _is_admin THEN COALESCE((_product->>'purchase_price')::numeric, purchase_price) ELSE purchase_price END,
      sale_price = CASE WHEN _is_admin THEN COALESCE((_product->>'sale_price')::numeric, sale_price) ELSE sale_price END,
      min_stock_alert = COALESCE((_product->>'min_stock_alert')::int, min_stock_alert),
      is_active = COALESCE((_product->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = _pid;
  END IF;

  DELETE FROM public.product_units
  WHERE product_id = _pid
    AND id NOT IN (
      SELECT NULLIF(x->>'id','')::uuid FROM jsonb_array_elements(_units) x
      WHERE NULLIF(x->>'id','') IS NOT NULL
    );

  FOR _u IN SELECT * FROM jsonb_array_elements(_units) LOOP
    IF NULLIF(_u->>'id','') IS NOT NULL THEN
      UPDATE public.product_units SET
        name = _u->>'name',
        equals_base = (_u->>'equals_base')::int,
        is_base = (_u->>'is_base')::boolean,
        is_default_sale = COALESCE((_u->>'is_default_sale')::boolean, false),
        sku = NULLIF(_u->>'sku',''),
        barcode = NULLIF(_u->>'barcode',''),
        purchase_price = CASE WHEN _is_admin THEN COALESCE((_u->>'purchase_price')::numeric, 0) ELSE purchase_price END,
        sale_price = CASE WHEN _is_admin THEN COALESCE((_u->>'sale_price')::numeric, 0) ELSE sale_price END,
        sort_order = COALESCE((_u->>'sort_order')::int, 0),
        updated_at = now()
      WHERE id = (_u->>'id')::uuid AND product_id = _pid
      RETURNING id INTO _new_unit_id;
    ELSE
      INSERT INTO public.product_units(product_id, name, equals_base, is_base, is_default_sale, sku, barcode, purchase_price, sale_price, sort_order)
      VALUES (
        _pid, _u->>'name', (_u->>'equals_base')::int,
        (_u->>'is_base')::boolean, COALESCE((_u->>'is_default_sale')::boolean, false),
        NULLIF(_u->>'sku',''), NULLIF(_u->>'barcode',''),
        COALESCE((_u->>'purchase_price')::numeric, 0),
        COALESCE((_u->>'sale_price')::numeric, 0),
        COALESCE((_u->>'sort_order')::int, 0)
      ) RETURNING id INTO _new_unit_id;
    END IF;

    IF (_u->>'is_base')::boolean THEN _base_id := _new_unit_id; END IF;
  END LOOP;

  UPDATE public.products SET base_unit_id = _base_id WHERE id = _pid;

  IF _initial_stock IS NOT NULL AND (_initial_stock->>'qty') IS NOT NULL THEN
    _init_unit := (_initial_stock->>'unit_id')::uuid;
    _init_qty := (_initial_stock->>'qty')::int;
    IF _init_qty > 0 AND _init_unit IS NOT NULL THEN
      SELECT equals_base, name INTO _init_equals, _name FROM public.product_units WHERE id = _init_unit;
      IF _init_equals IS NULL THEN RAISE EXCEPTION 'Initial stock unit not found'; END IF;
      _init_base := _init_qty * _init_equals;
      UPDATE public.products SET stock = stock + _init_base, updated_at = now() WHERE id = _pid;
      INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, user_id, user_name)
      VALUES (_pid, _init_unit, _name, _init_qty, _init_base, 'initial', auth.uid(),
        COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), ''));
    END IF;
  END IF;

  RETURN _pid;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_product_with_units(jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_units(jsonb, jsonb, jsonb) TO authenticated;