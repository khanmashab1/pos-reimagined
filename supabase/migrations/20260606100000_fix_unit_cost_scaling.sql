-- FIX: profit was hugely negative because process_sale_v2 stored sale_items.purchase_price
-- as the per-UNIT cost (e.g. a box = 242) while qty is stored in BASE pieces (20). So profit
-- math (qty x purchase_price) counted cost = 20 x 242 instead of 20 x 12.10. Divide
-- purchase_price by equals_base, exactly like unit_price already is. Re-runnable.

CREATE OR REPLACE FUNCTION public.process_sale_v2(
  _items jsonb, _subtotal numeric, _tax_amount numeric, _discount numeric, _total numeric,
  _cash_received numeric, _change_returned numeric, _payment_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _bill_no text;
  _sale_id uuid;
  _cashier_name text;
  _session_id uuid;
  _payment_method text;
  _item jsonb;
  _items_count int := 0;
  _unit_equals int;
  _unit_name text;
  _qty_base int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO _session_id FROM public.cash_sessions WHERE user_id = auth.uid() AND status = 'open' LIMIT 1;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'No open shift. Please start a shift before making sales.'; END IF;

  _payment_method := CASE WHEN lower(coalesce(_payment_type,'cash')) = 'card' THEN 'card' ELSE 'cash' END;
  SELECT coalesce(full_name, username, 'Cashier') INTO _cashier_name FROM public.profiles WHERE id = auth.uid();
  _bill_no := public.next_bill_no('ZIC');

  INSERT INTO public.sales(bill_no, cashier_id, cashier_name, subtotal, tax_amount, discount, total,
    cash_received, change_returned, payment_type, items_count, session_id, payment_method)
  VALUES (_bill_no, auth.uid(), coalesce(_cashier_name,''), _subtotal, _tax_amount, _discount, _total,
    _cash_received, _change_returned, _payment_type, 0, _session_id, _payment_method)
  RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    IF NULLIF(_item->>'unit_id','') IS NOT NULL THEN
      SELECT equals_base, name INTO _unit_equals, _unit_name
      FROM public.product_units WHERE id = (_item->>'unit_id')::uuid;
    END IF;
    IF _unit_equals IS NULL THEN
      SELECT pu.equals_base, pu.name INTO _unit_equals, _unit_name
      FROM public.products p LEFT JOIN public.product_units pu ON pu.id = p.base_unit_id
      WHERE p.id = (_item->>'product_id')::uuid;
      _unit_equals := COALESCE(_unit_equals, 1);
      _unit_name := COALESCE(_unit_name, 'Piece');
    END IF;
    _qty_base := (_item->>'qty')::int * _unit_equals;

    INSERT INTO public.sale_items(sale_id, product_id, product_name, barcode, qty, unit_price, purchase_price, subtotal,
                                  unit_id, unit_name, qty_in_unit)
    VALUES (
      _sale_id, (_item->>'product_id')::uuid, _item->>'product_name', coalesce(_item->>'barcode',''),
      _qty_base,
      (_item->>'unit_price')::numeric / _unit_equals,
      coalesce((_item->>'purchase_price')::numeric, 0) / _unit_equals,   -- FIX: store per-BASE cost
      (_item->>'subtotal')::numeric,
      NULLIF(_item->>'unit_id','')::uuid, _unit_name, (_item->>'qty')::numeric
    );

    UPDATE public.products SET stock = stock - _qty_base, updated_at = now()
    WHERE id = (_item->>'product_id')::uuid;

    INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, ref_id, user_id, user_name)
    VALUES ((_item->>'product_id')::uuid, NULLIF(_item->>'unit_id','')::uuid, _unit_name,
            (_item->>'qty')::numeric, -_qty_base, 'sale', _sale_id, auth.uid(), coalesce(_cashier_name,''));

    _items_count := _items_count + _qty_base;
    _unit_equals := NULL;
  END LOOP;

  UPDATE public.sales SET items_count = _items_count WHERE id = _sale_id;
  RETURN jsonb_build_object('sale_id', _sale_id, 'bill_no', _bill_no);
END;
$$;

-- Historical correction (idempotent): rescale past unit-sale rows to per-base cost using the
-- unit's current equals_base. Base-unit rows (equals_base = 1 / no unit) are already correct.
UPDATE public.sale_items si
SET purchase_price = pu.purchase_price / NULLIF(pu.equals_base, 0)
FROM public.product_units pu
WHERE si.unit_id = pu.id AND pu.equals_base > 1;

notify pgrst, 'reload schema';
