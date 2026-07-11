
DROP POLICY IF EXISTS "Authenticated can create own price requests" ON public.price_change_requests;
CREATE POLICY "Authenticated can create own price requests"
ON public.price_change_requests
FOR INSERT
TO authenticated
WITH CHECK (requested_by = auth.uid());

REVOKE EXECUTE ON FUNCTION public.approve_price_change(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_price_change(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reject_price_change(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reject_price_change(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_price_change(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_price_change(uuid, numeric, numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_product_prices(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_product_prices(uuid, numeric, numeric) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_summary(timestamptz, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_dashboard_summary(timestamptz, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_summary(timestamptz, integer, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_dashboard_summary(timestamptz, integer, timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_period_extras(timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_period_extras(timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_period_extras(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_period_extras(timestamptz, timestamptz) TO authenticated;
