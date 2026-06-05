
-- =============================================================================
-- Stock entry fixes + multi-unit columns
-- Only contains changes NOT in the original POS migrations.
-- =============================================================================

-- 1. Add unit columns to stock_entries (if not already there from product_units migration)
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES public.product_units(id);
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS unit_name text;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS qty_in_unit numeric;

-- 2. Add approval columns to stock_entries (if not already there)
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS approved_by_name text;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS rejected_by uuid;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS rejected_by_name text;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS rejection_reason text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_entries_status_check') THEN
    ALTER TABLE public.stock_entries ADD CONSTRAINT stock_entries_status_check
      CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- 3. FIX add_stock_entry_v2: change to use pending approval flow (no immediate stock update)
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

  -- Create stock entry in PENDING status — does NOT update product stock yet
  INSERT INTO public.stock_entries (product_id, cashier_id, cashier_name, qty, unit_id, unit_name, qty_in_unit, notes, status)
  VALUES (_product_id, _uid, COALESCE(_name,''), _qty_base, _unit_id, _unit_name, _qty, COALESCE(_notes,''), 'pending')
  RETURNING id INTO _entry_id;

  RETURN _entry_id;
END;
$$;

-- 4. approve_stock_entry — updates stock + records inventory movement
CREATE OR REPLACE FUNCTION public.approve_stock_entry(_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _status text;
  _approver text;
  _product_id uuid;
  _qty integer;
  _qty_in_unit numeric;
  _unit_id uuid;
  _unit_name text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can approve stock entries';
  END IF;

  SELECT status, product_id, qty, unit_id, unit_name, qty_in_unit
    INTO _status, _product_id, _qty, _unit_id, _unit_name, _qty_in_unit
  FROM public.stock_entries WHERE id = _entry_id FOR UPDATE;
  IF _status IS NULL THEN RAISE EXCEPTION 'Stock entry not found'; END IF;
  IF _status <> 'pending' THEN RAISE EXCEPTION 'Only pending entries can be approved'; END IF;

  SELECT coalesce(full_name, username, 'Admin') INTO _approver FROM public.profiles WHERE id = auth.uid();

  -- Update product stock
  UPDATE public.products SET stock = stock + _qty, updated_at = now() WHERE id = _product_id;

  -- Record inventory movement
  INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, ref_id, user_id, user_name, notes)
  VALUES (_product_id, _unit_id, COALESCE(_unit_name,'restock'), COALESCE(_qty_in_unit, _qty), _qty, 'restock', _entry_id, auth.uid(), _approver, 'Approved stock entry');

  UPDATE public.stock_entries
    SET status = 'approved', approved_by = auth.uid(), approved_by_name = coalesce(_approver, ''), approved_at = now()
    WHERE id = _entry_id;

  RETURN jsonb_build_object('entry_id', _entry_id, 'status', 'approved');
END;
$$;

-- 5. reject_stock_entry
CREATE OR REPLACE FUNCTION public.reject_stock_entry(_entry_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _status text;
  _rejecter text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can reject stock entries';
  END IF;

  SELECT status INTO _status FROM public.stock_entries WHERE id = _entry_id FOR UPDATE;
  IF _status IS NULL THEN RAISE EXCEPTION 'Stock entry not found'; END IF;
  IF _status <> 'pending' THEN RAISE EXCEPTION 'Only pending entries can be rejected'; END IF;

  SELECT coalesce(full_name, username, 'Admin') INTO _rejecter FROM public.profiles WHERE id = auth.uid();

  UPDATE public.stock_entries
    SET status = 'rejected', rejected_by = auth.uid(), rejected_by_name = coalesce(_rejecter, ''),
        rejected_at = now(), rejection_reason = coalesce(_reason, '')
    WHERE id = _entry_id;

  RETURN jsonb_build_object('entry_id', _entry_id, 'status', 'rejected');
END;
$$;

-- 6. Secure function permissions
REVOKE EXECUTE ON FUNCTION public.add_stock_entry_v2(uuid, uuid, integer, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.add_stock_entry_v2(uuid, uuid, integer, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_stock_entry(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.approve_stock_entry(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_stock_entry(uuid, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.reject_stock_entry(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
