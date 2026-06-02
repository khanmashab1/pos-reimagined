
-- ============ product_units ============
CREATE TABLE public.product_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name text NOT NULL,
  equals_base integer NOT NULL CHECK (equals_base > 0),
  is_base boolean NOT NULL DEFAULT false,
  is_default_sale boolean NOT NULL DEFAULT false,
  sku text,
  barcode text,
  purchase_price numeric NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  sale_price numeric NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_units_name_uniq ON public.product_units (product_id, lower(name));
CREATE UNIQUE INDEX product_units_barcode_uniq ON public.product_units (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX product_units_product_idx ON public.product_units (product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_units TO authenticated;
GRANT ALL ON public.product_units TO service_role;

ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "punits read" ON public.product_units FOR SELECT TO authenticated USING (true);
CREATE POLICY "punits admin write" ON public.product_units FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "punits cashier insert" ON public.product_units FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER product_units_touch BEFORE UPDATE ON public.product_units
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ products.base_unit_id ============
ALTER TABLE public.products ADD COLUMN base_unit_id uuid REFERENCES public.product_units(id);

-- ============ backfill: 1 base unit per existing product ============
WITH ins AS (
  INSERT INTO public.product_units (product_id, name, equals_base, is_base, is_default_sale, barcode, purchase_price, sale_price, sort_order)
  SELECT p.id, 'Piece', 1, true, true, p.barcode, p.purchase_price, p.sale_price, 0
  FROM public.products p
  RETURNING id, product_id
)
UPDATE public.products p SET base_unit_id = ins.id FROM ins WHERE ins.product_id = p.id;

-- The base unit's barcode duplicates the product barcode; clear it on the unit row to keep the
-- unique index on product_units.barcode happy. Product-level barcode remains the scan source.
UPDATE public.product_units SET barcode = NULL WHERE is_base = true;

-- ============ sale_items: unit columns ============
ALTER TABLE public.sale_items
  ADD COLUMN unit_id uuid REFERENCES public.product_units(id),
  ADD COLUMN unit_name text,
  ADD COLUMN qty_in_unit numeric;

-- ============ inventory_movements ============
CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.product_units(id),
  unit_name text NOT NULL DEFAULT '',
  qty_in_unit numeric NOT NULL,
  qty_in_base integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sale','return','restock','initial','adjustment')),
  ref_id uuid,
  user_id uuid,
  user_name text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inv_mov_product_idx ON public.inventory_movements (product_id, created_at DESC);

GRANT SELECT, INSERT ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inv_mov admin read" ON public.inventory_movements FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "inv_mov own read" ON public.inventory_movements FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "inv_mov insert" ON public.inventory_movements FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));

-- ============ save_product_with_units ============
CREATE OR REPLACE FUNCTION public.save_product_with_units(
  _product jsonb,
  _units jsonb,
  _initial_stock jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pid uuid;
  _is_new boolean := false;
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
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'cashier'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  _pid := NULLIF(_product->>'id','')::uuid;

  -- Validate units
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
      purchase_price = COALESCE((_product->>'purchase_price')::numeric, purchase_price),
      sale_price = COALESCE((_product->>'sale_price')::numeric, sale_price),
      min_stock_alert = COALESCE((_product->>'min_stock_alert')::int, min_stock_alert),
      is_active = COALESCE((_product->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = _pid;
  END IF;

  -- Replace units (delete those not in payload, upsert the rest)
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
        purchase_price = COALESCE((_u->>'purchase_price')::numeric, 0),
        sale_price = COALESCE((_u->>'sale_price')::numeric, 0),
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

  -- Initial stock (optional, only on create or when explicitly supplied)
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
$$;

-- ============ process_sale_v2 ============
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
    -- Resolve unit (fall back to product base unit if unit_id missing)
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
      _qty_base,  -- qty stored in base units for backward compat with reports
      (_item->>'unit_price')::numeric / _unit_equals,  -- per-base-unit price
      coalesce((_item->>'purchase_price')::numeric, 0),
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

-- ============ add_stock_entry_v2 ============
CREATE OR REPLACE FUNCTION public.add_stock_entry_v2(
  _product_id uuid, _unit_id uuid, _qty integer, _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _name text;
  _unit_equals int;
  _unit_name text;
  _entry_id uuid;
  _qty_base int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (has_role(_uid, 'cashier'::app_role) OR has_role(_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;

  IF _unit_id IS NOT NULL THEN
    SELECT equals_base, name INTO _unit_equals, _unit_name FROM public.product_units WHERE id = _unit_id AND product_id = _product_id;
  END IF;
  IF _unit_equals IS NULL THEN
    SELECT pu.equals_base, pu.name INTO _unit_equals, _unit_name
    FROM public.products p LEFT JOIN public.product_units pu ON pu.id = p.base_unit_id WHERE p.id = _product_id;
    _unit_equals := COALESCE(_unit_equals, 1); _unit_name := COALESCE(_unit_name, 'Piece');
  END IF;
  _qty_base := _qty * _unit_equals;

  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;

  INSERT INTO public.stock_entries (product_id, cashier_id, cashier_name, qty, notes)
  VALUES (_product_id, _uid, COALESCE(_name,''), _qty_base, COALESCE(_notes,''))
  RETURNING id INTO _entry_id;

  UPDATE public.products SET stock = stock + _qty_base, updated_at = now() WHERE id = _product_id;

  INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, ref_id, user_id, user_name, notes)
  VALUES (_product_id, _unit_id, _unit_name, _qty, _qty_base, 'restock', _entry_id, _uid, COALESCE(_name,''), COALESCE(_notes,''));

  RETURN _entry_id;
END;
$$;

-- ============ get_unit_breakdown ============
CREATE OR REPLACE FUNCTION public.get_unit_breakdown(_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  _stock int;
  _u record;
  _count int;
  _result jsonb := '[]'::jsonb;
BEGIN
  SELECT stock INTO _stock FROM public.products WHERE id = _product_id;
  IF _stock IS NULL THEN RETURN _result; END IF;
  FOR _u IN
    SELECT id, name, equals_base FROM public.product_units
    WHERE product_id = _product_id ORDER BY equals_base DESC, sort_order ASC
  LOOP
    _count := _stock / _u.equals_base;
    _stock := _stock - _count * _u.equals_base;
    IF _count > 0 OR _u.equals_base = 1 THEN
      _result := _result || jsonb_build_object('unit_id', _u.id, 'name', _u.name, 'equals_base', _u.equals_base, 'count', _count);
    END IF;
  END LOOP;
  RETURN _result;
END;
$$;
