CREATE TABLE IF NOT EXISTS public.price_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_name text NOT NULL DEFAULT '',
  current_purchase_price numeric NOT NULL DEFAULT 0,
  current_sale_price numeric NOT NULL DEFAULT 0,
  requested_purchase_price numeric NOT NULL,
  requested_sale_price numeric NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid,
  requested_by_name text NOT NULL DEFAULT '',
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_change_requests TO authenticated;
GRANT ALL ON public.price_change_requests TO service_role;

ALTER TABLE public.price_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pcr read" ON public.price_change_requests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR requested_by = auth.uid());

CREATE POLICY "pcr admin write" ON public.price_change_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER pcr_touch BEFORE UPDATE ON public.price_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Cashier/admin creates a request
CREATE OR REPLACE FUNCTION public.request_price_change(
  _product_id uuid,
  _requested_purchase numeric,
  _requested_sale numeric,
  _reason text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _name text; _pname text; _cp numeric; _cs numeric; _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid,'cashier'::app_role) OR public.has_role(_uid,'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized'; END IF;
  IF _requested_purchase IS NULL OR _requested_purchase < 0
     OR _requested_sale IS NULL OR _requested_sale < 0 THEN
    RAISE EXCEPTION 'Prices must be non-negative'; END IF;

  SELECT name, purchase_price, sale_price INTO _pname, _cp, _cs
    FROM public.products WHERE id = _product_id;
  IF _pname IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  SELECT coalesce(full_name, username, 'Cashier') INTO _name FROM public.profiles WHERE id = _uid;

  INSERT INTO public.price_change_requests(
    product_id, product_name,
    current_purchase_price, current_sale_price,
    requested_purchase_price, requested_sale_price,
    reason, requested_by, requested_by_name, status
  ) VALUES (
    _product_id, _pname, _cp, _cs,
    _requested_purchase, _requested_sale,
    coalesce(_reason,''), _uid, coalesce(_name,''), 'pending'
  ) RETURNING id INTO _id;

  RETURN _id;
END; $$;

GRANT EXECUTE ON FUNCTION public.request_price_change(uuid, numeric, numeric, text) TO authenticated;

-- Admin approves: applies new prices to product
CREATE OR REPLACE FUNCTION public.approve_price_change(_request_id uuid, _notes text DEFAULT '')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record; _reviewer text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Only admins can approve'; END IF;
  SELECT * INTO _r FROM public.price_change_requests WHERE id = _request_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Only pending requests can be approved'; END IF;

  SELECT coalesce(full_name, username, 'Admin') INTO _reviewer FROM public.profiles WHERE id = auth.uid();

  UPDATE public.products
     SET purchase_price = _r.requested_purchase_price,
         sale_price     = _r.requested_sale_price,
         updated_at     = now()
   WHERE id = _r.product_id;

  UPDATE public.price_change_requests
     SET status = 'approved', reviewed_by = auth.uid(),
         reviewed_by_name = _reviewer, reviewed_at = now(),
         review_notes = coalesce(_notes,'')
   WHERE id = _request_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.approve_price_change(uuid, text) TO authenticated;

-- Admin rejects
CREATE OR REPLACE FUNCTION public.reject_price_change(_request_id uuid, _notes text DEFAULT '')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _status text; _reviewer text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Only admins can reject'; END IF;
  SELECT status INTO _status FROM public.price_change_requests WHERE id = _request_id FOR UPDATE;
  IF _status IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF _status <> 'pending' THEN RAISE EXCEPTION 'Only pending requests can be rejected'; END IF;

  SELECT coalesce(full_name, username, 'Admin') INTO _reviewer FROM public.profiles WHERE id = auth.uid();

  UPDATE public.price_change_requests
     SET status = 'rejected', reviewed_by = auth.uid(),
         reviewed_by_name = _reviewer, reviewed_at = now(),
         review_notes = coalesce(_notes,'')
   WHERE id = _request_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.reject_price_change(uuid, text) TO authenticated;