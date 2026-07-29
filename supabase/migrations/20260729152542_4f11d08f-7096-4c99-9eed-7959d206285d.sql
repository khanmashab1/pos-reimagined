
-- bill_sequences
DROP POLICY "billseq admin read" ON public.bill_sequences;
CREATE POLICY "billseq admin read" ON public.bill_sequences FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- cash_sessions
DROP POLICY "sessions admin read" ON public.cash_sessions;
CREATE POLICY "sessions admin read" ON public.cash_sessions FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "sessions admin update" ON public.cash_sessions;
CREATE POLICY "sessions admin update" ON public.cash_sessions FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "sessions own read" ON public.cash_sessions;
CREATE POLICY "sessions own read" ON public.cash_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- categories
DROP POLICY "cat admin write" ON public.categories;
CREATE POLICY "cat admin write" ON public.categories FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- daily_expenses
DROP POLICY "daily_expenses admin all" ON public.daily_expenses;
CREATE POLICY "daily_expenses admin all" ON public.daily_expenses FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- inventory_movements
DROP POLICY "inv_mov admin read" ON public.inventory_movements;
CREATE POLICY "inv_mov admin read" ON public.inventory_movements FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "inv_mov own read" ON public.inventory_movements;
CREATE POLICY "inv_mov own read" ON public.inventory_movements FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- operating_expenses
DROP POLICY "operating_expenses admin all" ON public.operating_expenses;
CREATE POLICY "operating_expenses admin all" ON public.operating_expenses FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- person_payments
DROP POLICY "person_payments admin all" ON public.person_payments;
CREATE POLICY "person_payments admin all" ON public.person_payments FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- product_units
DROP POLICY "punits admin write" ON public.product_units;
CREATE POLICY "punits admin write" ON public.product_units FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- products
DROP POLICY "prod admin write" ON public.products;
CREATE POLICY "prod admin write" ON public.products FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- profiles
DROP POLICY "profiles admin manage" ON public.profiles;
CREATE POLICY "profiles admin manage" ON public.profiles FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "profiles admin read all" ON public.profiles;
CREATE POLICY "profiles admin read all" ON public.profiles FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "profiles self read" ON public.profiles;
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- return_items
DROP POLICY "return_items read own" ON public.return_items;
CREATE POLICY "return_items read own" ON public.return_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM returns r WHERE r.id = return_items.return_id AND (r.cashier_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));

-- returns
DROP POLICY "returns admin read" ON public.returns;
CREATE POLICY "returns admin read" ON public.returns FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "returns own read" ON public.returns;
CREATE POLICY "returns own read" ON public.returns FOR SELECT TO authenticated USING (auth.uid() = cashier_id);

-- sale_items
DROP POLICY "sale_items read own" ON public.sale_items;
CREATE POLICY "sale_items read own" ON public.sale_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND (s.cashier_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));

-- sales
DROP POLICY "sales admin read" ON public.sales;
CREATE POLICY "sales admin read" ON public.sales FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "sales own read" ON public.sales;
CREATE POLICY "sales own read" ON public.sales FOR SELECT TO authenticated USING (auth.uid() = cashier_id);

-- shift_expenses
DROP POLICY "shift_expenses admin all" ON public.shift_expenses;
CREATE POLICY "shift_expenses admin all" ON public.shift_expenses FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "shift_expenses select own" ON public.shift_expenses;
CREATE POLICY "shift_expenses select own" ON public.shift_expenses FOR SELECT TO authenticated USING (cashier_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

-- stock_entries
DROP POLICY "stock_entries admin read" ON public.stock_entries;
CREATE POLICY "stock_entries admin read" ON public.stock_entries FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "stock_entries cashier insert" ON public.stock_entries;
CREATE POLICY "stock_entries cashier insert" ON public.stock_entries FOR INSERT TO authenticated WITH CHECK (auth.uid() = cashier_id AND (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));
DROP POLICY "stock_entries own read" ON public.stock_entries;
CREATE POLICY "stock_entries own read" ON public.stock_entries FOR SELECT TO authenticated USING (auth.uid() = cashier_id);

-- store_settings
DROP POLICY "settings admin write" ON public.store_settings;
CREATE POLICY "settings admin write" ON public.store_settings FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- supplier_payments
DROP POLICY "supplier_payments admin all" ON public.supplier_payments;
CREATE POLICY "supplier_payments admin all" ON public.supplier_payments FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "supplier_payments cashier insert" ON public.supplier_payments;
CREATE POLICY "supplier_payments cashier insert" ON public.supplier_payments FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));
DROP POLICY "supplier_payments cashier update" ON public.supplier_payments;
CREATE POLICY "supplier_payments cashier update" ON public.supplier_payments FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'cashier'::app_role)) WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));

-- supplier_purchases
DROP POLICY "supplier_purchases admin all" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases admin all" ON public.supplier_purchases FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "supplier_purchases cashier insert" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases cashier insert" ON public.supplier_purchases FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));
DROP POLICY "supplier_purchases cashier update" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases cashier update" ON public.supplier_purchases FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'cashier'::app_role)) WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));

-- suppliers
DROP POLICY "suppliers admin all" ON public.suppliers;
CREATE POLICY "suppliers admin all" ON public.suppliers FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "suppliers cashier insert" ON public.suppliers;
CREATE POLICY "suppliers cashier insert" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));
DROP POLICY "suppliers cashier update" ON public.suppliers;
CREATE POLICY "suppliers cashier update" ON public.suppliers FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'cashier'::app_role)) WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));

-- user_audit_log
DROP POLICY "audit admin insert" ON public.user_audit_log;
CREATE POLICY "audit admin insert" ON public.user_audit_log FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "audit admin read" ON public.user_audit_log;
CREATE POLICY "audit admin read" ON public.user_audit_log FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- user_roles
DROP POLICY "roles admin manage" ON public.user_roles;
CREATE POLICY "roles admin manage" ON public.user_roles FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "roles admin read" ON public.user_roles;
CREATE POLICY "roles admin read" ON public.user_roles FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY "roles self read" ON public.user_roles;
CREATE POLICY "roles self read" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
