
ALTER TABLE public.stock_reconciliations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_by_name text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by_name text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

-- Backfill: any existing rows are treated as already applied/approved so they don't clutter pending.
UPDATE public.stock_reconciliations
   SET status = 'approved', applied_at = COALESCE(applied_at, created_at)
 WHERE status = 'pending' AND created_at < now() - interval '1 minute';

CREATE INDEX IF NOT EXISTS idx_stock_reconciliations_status ON public.stock_reconciliations(status);

-- Approve: sets product stock to the physical count, logs inventory movement.
CREATE OR REPLACE FUNCTION public.approve_stock_reconciliation(_id uuid, _notes text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r record;
  _reviewer text;
  _current_stock numeric;
  _delta numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can approve reconciliations';
  END IF;

  SELECT * INTO _r FROM public.stock_reconciliations WHERE id = _id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Reconciliation not found'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Only pending reconciliations can be approved'; END IF;

  SELECT COALESCE(full_name, username, 'Admin') INTO _reviewer FROM public.profiles WHERE id = auth.uid();

  SELECT stock INTO _current_stock FROM public.products WHERE id = _r.product_id FOR UPDATE;
  IF _current_stock IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  _delta := _r.physical_stock - _current_stock;

  UPDATE public.products
     SET stock = _r.physical_stock, updated_at = now()
   WHERE id = _r.product_id;

  INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, ref_id, user_id, user_name, notes)
  VALUES (_r.product_id, _r.unit_id, 'reconciliation', _delta, _delta, 'reconciliation', _r.id, auth.uid(), _reviewer,
          'Approved reconciliation: system=' || _current_stock || ' physical=' || _r.physical_stock ||
          CASE WHEN COALESCE(_notes,'') <> '' THEN ' — ' || _notes ELSE '' END);

  UPDATE public.stock_reconciliations
     SET status = 'approved', reviewed_by = auth.uid(), reviewed_by_name = _reviewer,
         reviewed_at = now(), review_notes = COALESCE(_notes,''), applied_at = now()
   WHERE id = _id;

  RETURN jsonb_build_object('id', _id, 'status', 'approved', 'delta', _delta);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_stock_reconciliation(_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _r record; _reviewer text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can reject reconciliations';
  END IF;
  SELECT * INTO _r FROM public.stock_reconciliations WHERE id = _id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Reconciliation not found'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Only pending reconciliations can be rejected'; END IF;

  SELECT COALESCE(full_name, username, 'Admin') INTO _reviewer FROM public.profiles WHERE id = auth.uid();

  UPDATE public.stock_reconciliations
     SET status = 'rejected', reviewed_by = auth.uid(), reviewed_by_name = _reviewer,
         reviewed_at = now(), review_notes = COALESCE(_reason,'')
   WHERE id = _id;

  RETURN jsonb_build_object('id', _id, 'status', 'rejected');
END;
$$;
