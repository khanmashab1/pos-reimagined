REVOKE EXECUTE ON FUNCTION public.approve_stock_reconciliation(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_stock_reconciliation(uuid, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_stock_reconciliation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_stock_reconciliation(uuid, text) TO authenticated;