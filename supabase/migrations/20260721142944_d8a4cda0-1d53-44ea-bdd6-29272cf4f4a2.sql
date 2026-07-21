CREATE OR REPLACE FUNCTION public.approve_price_change(_request_id uuid, _notes text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Also sync the base unit's prices so POS (which reads product_units) reflects the change
  UPDATE public.product_units
     SET purchase_price = _r.requested_purchase_price,
         sale_price     = _r.requested_sale_price,
         updated_at     = now()
   WHERE product_id = _r.product_id AND is_base = true;

  UPDATE public.price_change_requests
     SET status = 'approved', reviewed_by = auth.uid(),
         reviewed_by_name = _reviewer, reviewed_at = now(),
         review_notes = coalesce(_notes,'')
   WHERE id = _request_id;
END; $function$;