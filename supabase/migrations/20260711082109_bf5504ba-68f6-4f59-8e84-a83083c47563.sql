
-- bill_sequences: cashiers need to read
CREATE POLICY "billseq authenticated read" ON public.bill_sequences
  FOR SELECT TO authenticated USING (true);

-- cash_sessions: cashier opens own session
CREATE POLICY "sessions own insert" ON public.cash_sessions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions own update" ON public.cash_sessions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- sales: cashier inserts own sale
CREATE POLICY "sales own insert" ON public.sales
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = cashier_id);

-- sale_items: cashier inserts items on their own sale
CREATE POLICY "sale_items own insert" ON public.sale_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id AND s.cashier_id = auth.uid()
  ));

-- returns: cashier creates + updates own return
CREATE POLICY "returns own insert" ON public.returns
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = cashier_id);
CREATE POLICY "returns own update" ON public.returns
  FOR UPDATE TO authenticated
  USING (auth.uid() = cashier_id)
  WITH CHECK (auth.uid() = cashier_id);

-- return_items: cashier inserts on own return
CREATE POLICY "return_items own insert" ON public.return_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.returns r
    WHERE r.id = return_items.return_id AND r.cashier_id = auth.uid()
  ));

-- shift_expenses: cashier inserts on own session
CREATE POLICY "shift_expenses own insert" ON public.shift_expenses
  FOR INSERT TO authenticated
  WITH CHECK (cashier_id = auth.uid());

-- suppliers: cashier can read
CREATE POLICY "suppliers authenticated read" ON public.suppliers
  FOR SELECT TO authenticated USING (true);

-- supplier_payments: cashier reads own
CREATE POLICY "supplier_payments own read" ON public.supplier_payments
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

-- supplier_purchases: cashier reads own
CREATE POLICY "supplier_purchases own read" ON public.supplier_purchases
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

-- Revoke EXECUTE from anon on SECURITY DEFINER functions (they are for signed-in users only).
REVOKE EXECUTE ON FUNCTION public.close_shift(numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.open_shift(numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_open_session() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.record_expense(numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.process_sale(jsonb, numeric, numeric, numeric, numeric, numeric, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.process_sale_v2(jsonb, numeric, numeric, numeric, numeric, numeric, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.process_return(uuid, jsonb, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.approve_return(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.void_return(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.approve_stock_entry(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reject_stock_entry(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.add_stock_entry(uuid, integer, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.add_stock_entry_v2(uuid, uuid, integer, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, date) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.save_product_with_units(jsonb, jsonb, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_update_shift(uuid, numeric, numeric, numeric, numeric, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_update_shift(uuid, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_summary(timestamptz, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_admin_inventory_summary() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_period_extras(timestamptz) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_online_by_method(timestamptz, timestamptz) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_profit_report(timestamptz, timestamptz) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_suppliers_summary() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM anon, public;
