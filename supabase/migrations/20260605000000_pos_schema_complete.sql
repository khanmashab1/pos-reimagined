
-- =============================================================================
-- POS Schema Complete — Idempotent, combines all POS migrations into one
-- =============================================================================
-- This migration:
--  1) Adds POS columns to the existing hospital profiles table
--  2) Creates POS auth infrastructure (app_role, user_roles, has_role)
--  3) Creates all POS tables (categories, products, sales, etc.)
--  4) Creates product_units + inventory_movements (multi-unit support)
--  5) Creates ALL POS functions with correct approval-flow behavior
--  6) Sets up RLS policies
--  7) Backfills base units for existing products
--  8) Seeds default data
-- =============================================================================

-- ===== PART 1: Extend existing profiles + POS auth ==========================

-- Add POS-required columns to the existing hospital profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

-- Populate full_name from first_name + last_name, username from email
UPDATE public.profiles
   SET full_name = coalesce(nullif(first_name,''),'') || ' ' || coalesce(nullif(last_name,''),''),
       username  = split_part(coalesce(email,'user@unknown.com'), '@', 1)
 WHERE full_name IS NULL OR full_name = '';

-- app_role enum (used by POS for role-based access)
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'cashier');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- user_roles table (separate from profiles.role to avoid conflicts)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

-- Backfill: existing profiles with role = 'admin' get POS admin role
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM public.profiles WHERE role = 'admin'
ON CONFLICT DO NOTHING;

-- Backfill: other profiles get cashier
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'cashier'::app_role
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id)
ON CONFLICT DO NOTHING;

-- has_role() — security definer to avoid RLS recursion
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

-- get_user_role()
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1 $$;

-- touch_updated_at() — trigger helper
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN new.updated_at = now(); RETURN new; END; $$;

-- Auto-create profile + role on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _is_first boolean;
BEGIN
  INSERT INTO public.profiles(id, email, first_name, last_name, full_name, username)
  VALUES (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(new.raw_user_meta_data->>'full_name', coalesce(new.raw_user_meta_data->>'first_name','') || ' ' || coalesce(new.raw_user_meta_data->>'last_name','')),
    coalesce(new.raw_user_meta_data->>'username', split_part(coalesce(new.email,''), '@', 1))
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = coalesce(EXCLUDED.full_name, profiles.full_name),
    username  = coalesce(EXCLUDED.username, profiles.username);

  SELECT count(*) = 0 INTO _is_first FROM public.user_roles;
  INSERT INTO public.user_roles(user_id, role)
  VALUES (new.id, CASE WHEN _is_first THEN 'admin'::app_role ELSE 'cashier'::app_role END)
  ON CONFLICT DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== PART 2: POS Core Tables ==============================================

-- Categories
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Products
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode text NOT NULL UNIQUE,
  name text NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  purchase_price numeric(12,2) NOT NULL DEFAULT 0,
  sale_price numeric(12,2) NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  min_stock_alert integer NOT NULL DEFAULT 5,
  is_active boolean NOT NULL DEFAULT true,
  image_url text,
  base_unit_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_name ON public.products(name);

-- Sales
CREATE TABLE IF NOT EXISTS public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no text NOT NULL UNIQUE,
  cashier_id uuid NOT NULL REFERENCES auth.users(id),
  cashier_name text NOT NULL DEFAULT '',
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  cash_received numeric(12,2) NOT NULL DEFAULT 0,
  change_returned numeric(12,2) NOT NULL DEFAULT 0,
  payment_type text NOT NULL DEFAULT 'cash',
  items_count integer NOT NULL DEFAULT 0,
  session_id uuid,
  payment_method text NOT NULL DEFAULT 'cash',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_created ON public.sales(created_at DESC);
CREATE INDEX IF NOT EXISTS sales_session_id_idx ON public.sales(session_id);

-- Sale items
CREATE TABLE IF NOT EXISTS public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  barcode text NOT NULL DEFAULT '',
  qty integer NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  purchase_price numeric(12,2) NOT NULL DEFAULT 0,
  subtotal numeric(12,2) NOT NULL,
  unit_id uuid,
  unit_name text,
  qty_in_unit numeric
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_name ON public.sale_items(product_name);

-- Store settings (single row)
CREATE TABLE IF NOT EXISTS public.store_settings (
  id integer PRIMARY KEY DEFAULT 1,
  store_name text NOT NULL DEFAULT 'ZIC Mart',
  address text NOT NULL DEFAULT 'ZIC Petrol Pump, Murree Road, Abbottabad',
  phone text NOT NULL DEFAULT '0313-5881633',
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'Rs.',
  footer_message text NOT NULL DEFAULT 'Thank you for shopping at ZIC Mart!',
  logo_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO public.store_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Bill sequences
CREATE TABLE IF NOT EXISTS public.bill_sequences (
  date_key text PRIMARY KEY,
  prefix text NOT NULL,
  last_seq integer NOT NULL DEFAULT 0
);

-- ===== PART 3: Returns (with approval flow) =================================

CREATE TABLE IF NOT EXISTS public.returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no text NOT NULL UNIQUE,
  original_sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  original_bill_no text NOT NULL,
  cashier_id uuid NOT NULL,
  cashier_name text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  refund_amount numeric NOT NULL DEFAULT 0,
  items_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  voided_by uuid,
  voided_by_name text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'returns_status_check') THEN
    ALTER TABLE public.returns ADD CONSTRAINT returns_status_check CHECK (status IN ('pending', 'approved', 'voided'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.returns(id) ON DELETE CASCADE,
  product_id uuid,
  product_name text NOT NULL,
  barcode text NOT NULL DEFAULT '',
  qty integer NOT NULL,
  unit_price numeric NOT NULL,
  subtotal numeric NOT NULL
);

-- ===== PART 4: Suppliers ====================================================

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  bill_no text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'cash',
  notes text NOT NULL DEFAULT '',
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_purchases_supplier ON public.supplier_purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS supplier_payments_session_id_idx ON public.supplier_payments(session_id);

-- ===== PART 5: Cash Sessions ================================================

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text NOT NULL DEFAULT '',
  opening_cash numeric NOT NULL DEFAULT 0,
  closing_cash numeric,
  cash_sales numeric NOT NULL DEFAULT 0,
  online_sales numeric NOT NULL DEFAULT 0,
  cash_paid_out numeric NOT NULL DEFAULT 0,
  expenses numeric NOT NULL DEFAULT 0,
  expected_cash numeric NOT NULL DEFAULT 0,
  difference numeric,
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_per_user
  ON public.cash_sessions(user_id) WHERE status = 'open';

-- ===== PART 6: Shift Expenses ===============================================

CREATE TABLE IF NOT EXISTS public.shift_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.cash_sessions(id),
  cashier_id uuid,
  cashier_name text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_expenses_session_id_idx ON public.shift_expenses(session_id);

-- ===== PART 7: Stock Entries (with unit support + approval flow) ============

CREATE TABLE IF NOT EXISTS public.stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES auth.users(id),
  cashier_name text NOT NULL DEFAULT '',
  qty integer NOT NULL CHECK (qty > 0),
  unit_id uuid,
  unit_name text,
  qty_in_unit numeric,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_by_name text,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_entries_status_check') THEN
    ALTER TABLE public.stock_entries ADD CONSTRAINT stock_entries_status_check
      CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_entries_product ON public.stock_entries(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_entries_cashier ON public.stock_entries(cashier_id);
CREATE INDEX IF NOT EXISTS idx_stock_entries_created ON public.stock_entries(created_at DESC);

-- ===== PART 8: Product Units (multi-unit support) ===========================

CREATE TABLE IF NOT EXISTS public.product_units (
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

CREATE UNIQUE INDEX IF NOT EXISTS product_units_name_uniq ON public.product_units (product_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS product_units_barcode_uniq ON public.product_units (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_units_product_idx ON public.product_units (product_id);

-- Backfill: 1 base unit per existing product
WITH ins AS (
  INSERT INTO public.product_units (product_id, name, equals_base, is_base, is_default_sale, barcode, purchase_price, sale_price, sort_order)
  SELECT p.id, 'Piece', 1, true, true, NULL, p.purchase_price, p.sale_price, 0
  FROM public.products p
  WHERE p.base_unit_id IS NULL
  RETURNING id, product_id
)
UPDATE public.products p SET base_unit_id = ins.id FROM ins WHERE ins.product_id = p.id;

-- ===== PART 9: Inventory Movements ==========================================

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_id uuid,
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

CREATE INDEX IF NOT EXISTS inv_mov_product_idx ON public.inventory_movements (product_id, created_at DESC);

-- Drop existing FK constraints on sale_items/inventory_movements if they point wrong
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_unit_id_fkey;
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_unit_id_fkey;

-- Add FK constraints
ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_unit_id_fkey
  FOREIGN KEY (unit_id) REFERENCES public.product_units(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_unit_id_fkey
  FOREIGN KEY (unit_id) REFERENCES public.product_units(id) ON DELETE SET NULL;

-- ===== PART 10: User Audit Log ==============================================

CREATE TABLE IF NOT EXISTS public.user_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_name text NOT NULL DEFAULT '',
  target_user_id uuid,
  target_user_name text NOT NULL DEFAULT '',
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== PART 11: Daily Expenses (admin report) ===============================

CREATE TABLE IF NOT EXISTS public.daily_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  cash_junaid numeric NOT NULL DEFAULT 0,
  cash_usama numeric NOT NULL DEFAULT 0,
  others numeric NOT NULL DEFAULT 0,
  counter_cash numeric NOT NULL DEFAULT 0,
  today_expenses numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_expenses DROP COLUMN IF EXISTS cash_zahid_ali;
CREATE INDEX IF NOT EXISTS daily_expenses_entry_date_idx ON public.daily_expenses(entry_date);

-- ===== PART 12: next_bill_no ================================================

CREATE OR REPLACE FUNCTION public.next_bill_no(_prefix text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _date_key text := to_char(now(), 'YYYYMMDD');
  _key text := _prefix || '-' || _date_key;
  _seq integer;
  _max_existing integer;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(bill_no, '^' || _prefix || '-' || _date_key || '-', ''), '')::int), 0)
    INTO _max_existing
  FROM public.sales
  WHERE bill_no LIKE _prefix || '-' || _date_key || '-%';

  INSERT INTO public.bill_sequences(date_key, prefix, last_seq)
  VALUES (_key, _prefix, _max_existing + 1)
  ON CONFLICT (date_key) DO UPDATE SET last_seq = GREATEST(bill_sequences.last_seq + 1, _max_existing + 1)
  RETURNING last_seq INTO _seq;

  RETURN _prefix || '-' || _date_key || '-' || lpad(_seq::text, 4, '0');
END;
$$;

-- ===== PART 13: process_sale_v2 (unit-aware sale) ===========================

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

-- ===== PART 14: add_stock_entry_v2 (with approval flow + unit support) ======

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

-- ===== PART 15: approve_stock_entry =========================================

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

  -- Update product stock (finally!)
  UPDATE public.products SET stock = stock + _qty, updated_at = now() WHERE id = _product_id;

  -- Record inventory movement
  INSERT INTO public.inventory_movements(product_id, unit_id, unit_name, qty_in_unit, qty_in_base, kind, ref_id, user_id, user_name, notes)
  VALUES (_product_id, _unit_id, COALESCE(_unit_name,'restock'), COALESCE(_qty_in_unit, _qty), _qty, 'restock', _entry_id, auth.uid(), _approver, 'Approved stock entry');

  -- Mark as approved
  UPDATE public.stock_entries
    SET status = 'approved',
        approved_by = auth.uid(),
        approved_by_name = coalesce(_approver, ''),
        approved_at = now()
    WHERE id = _entry_id;

  RETURN jsonb_build_object('entry_id', _entry_id, 'status', 'approved');
END;
$$;

-- ===== PART 16: reject_stock_entry ==========================================

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
    SET status = 'rejected',
        rejected_by = auth.uid(),
        rejected_by_name = coalesce(_rejecter, ''),
        rejected_at = now(),
        rejection_reason = coalesce(_reason, '')
    WHERE id = _entry_id;

  RETURN jsonb_build_object('entry_id', _entry_id, 'status', 'rejected');
END;
$$;

-- ===== PART 17: add_stock_entry (legacy, approval flow) =====================

DROP FUNCTION IF EXISTS public.add_stock_entry(uuid, integer, text);
CREATE OR REPLACE FUNCTION public.add_stock_entry(
  _product_id uuid, _qty integer, _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _cashier_name text;
  _entry_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
  SELECT coalesce(full_name, username, 'Cashier') INTO _cashier_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.stock_entries(product_id, cashier_id, cashier_name, qty, notes, status)
  VALUES (_product_id, auth.uid(), coalesce(_cashier_name, ''), _qty, _notes, 'pending')
  RETURNING id INTO _entry_id;
  RETURN jsonb_build_object('entry_id', _entry_id, 'message', 'Stock entry submitted for admin approval', 'status', 'pending');
END;
$$;

-- ===== PART 18: process_return (approval flow) ==============================

CREATE OR REPLACE FUNCTION public.process_return(
  _sale_id uuid, _items jsonb, _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _return_no text;
  _return_id uuid;
  _cashier_name text;
  _bill_no text;
  _item jsonb;
  _items_count integer := 0;
  _refund numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT coalesce(full_name, username, 'Cashier') INTO _cashier_name FROM public.profiles WHERE id = auth.uid();
  SELECT bill_no INTO _bill_no FROM public.sales WHERE id = _sale_id;
  IF _bill_no IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  _return_no := public.next_bill_no('RET');

  INSERT INTO public.returns(return_no, original_sale_id, original_bill_no, cashier_id, cashier_name, reason, refund_amount, items_count, status)
  VALUES (_return_no, _sale_id, _bill_no, auth.uid(), coalesce(_cashier_name,''), coalesce(_reason,''), 0, 0, 'pending')
  RETURNING id INTO _return_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    INSERT INTO public.return_items(return_id, product_id, product_name, barcode, qty, unit_price, subtotal)
    VALUES (_return_id, nullif(_item->>'product_id','')::uuid, _item->>'product_name', coalesce(_item->>'barcode',''), (_item->>'qty')::int, (_item->>'unit_price')::numeric, (_item->>'subtotal')::numeric);
    _items_count := _items_count + (_item->>'qty')::int;
    _refund := _refund + (_item->>'subtotal')::numeric;
  END LOOP;

  UPDATE public.returns SET items_count = _items_count, refund_amount = _refund WHERE id = _return_id;
  RETURN jsonb_build_object('return_id', _return_id, 'return_no', _return_no, 'refund', _refund, 'status', 'pending');
END;
$$;

-- ===== PART 19: approve_return ==============================================

CREATE OR REPLACE FUNCTION public.approve_return(_return_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _status text;
  _approver text;
  _it record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only admins can approve returns'; END IF;
  SELECT status INTO _status FROM public.returns WHERE id = _return_id FOR UPDATE;
  IF _status IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  IF _status <> 'pending' THEN RAISE EXCEPTION 'Only pending returns can be approved'; END IF;
  SELECT coalesce(full_name, username, 'Admin') INTO _approver FROM public.profiles WHERE id = auth.uid();

  FOR _it IN SELECT product_id, qty FROM public.return_items WHERE return_id = _return_id LOOP
    IF _it.product_id IS NOT NULL THEN
      UPDATE public.products SET stock = stock + _it.qty, updated_at = now() WHERE id = _it.product_id;
    END IF;
  END LOOP;

  UPDATE public.returns SET status = 'approved', approved_by = auth.uid(), approved_by_name = coalesce(_approver,''), approved_at = now() WHERE id = _return_id;
  RETURN jsonb_build_object('return_id', _return_id, 'status', 'approved');
END;
$$;

-- ===== PART 20: void_return =================================================

CREATE OR REPLACE FUNCTION public.void_return(_return_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _status text;
  _voider text;
  _it record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only admins can void returns'; END IF;
  SELECT status INTO _status FROM public.returns WHERE id = _return_id FOR UPDATE;
  IF _status IS NULL THEN RAISE EXCEPTION 'Return not found'; END IF;
  IF _status = 'voided' THEN RAISE EXCEPTION 'Return already voided'; END IF;
  SELECT coalesce(full_name, username, 'Admin') INTO _voider FROM public.profiles WHERE id = auth.uid();

  IF _status = 'approved' THEN
    FOR _it IN SELECT product_id, qty FROM public.return_items WHERE return_id = _return_id LOOP
      IF _it.product_id IS NOT NULL THEN
        UPDATE public.products SET stock = stock - _it.qty, updated_at = now() WHERE id = _it.product_id;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.returns SET status = 'voided', voided_by = auth.uid(), voided_by_name = coalesce(_voider,''), voided_at = now(), void_reason = coalesce(_reason,'') WHERE id = _return_id;
  RETURN jsonb_build_object('return_id', _return_id, 'status', 'voided');
END;
$$;

-- ===== PART 21: save_product_with_units =====================================

CREATE OR REPLACE FUNCTION public.save_product_with_units(
  _product jsonb, _units jsonb, _initial_stock jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

  IF _units IS NULL OR jsonb_array_length(_units) = 0 THEN
    RAISE EXCEPTION 'At least one unit is required';
  END IF;
  SELECT count(*) INTO _bases_count FROM jsonb_array_elements(_units) u WHERE (u->>'is_base')::boolean = true;
  IF _bases_count <> 1 THEN RAISE EXCEPTION 'Exactly one base unit is required'; END IF;

  IF _pid IS NULL THEN
    _is_new := true;
    INSERT INTO public.products (name, barcode, category_id, purchase_price, sale_price, stock, min_stock_alert, is_active)
    VALUES (
      _product->>'name', _product->>'barcode', NULLIF(_product->>'category_id','')::uuid,
      COALESCE((_product->>'purchase_price')::numeric, 0), COALESCE((_product->>'sale_price')::numeric, 0),
      0, COALESCE((_product->>'min_stock_alert')::int, 5), COALESCE((_product->>'is_active')::boolean, true)
    ) RETURNING id INTO _pid;
  ELSE
    UPDATE public.products SET
      name = _product->>'name', barcode = _product->>'barcode',
      category_id = NULLIF(_product->>'category_id','')::uuid,
      purchase_price = COALESCE((_product->>'purchase_price')::numeric, purchase_price),
      sale_price = COALESCE((_product->>'sale_price')::numeric, sale_price),
      min_stock_alert = COALESCE((_product->>'min_stock_alert')::int, min_stock_alert),
      is_active = COALESCE((_product->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = _pid;
  END IF;

  DELETE FROM public.product_units
  WHERE product_id = _pid
    AND id NOT IN (SELECT NULLIF(x->>'id','')::uuid FROM jsonb_array_elements(_units) x WHERE NULLIF(x->>'id','') IS NOT NULL);

  FOR _u IN SELECT * FROM jsonb_array_elements(_units) LOOP
    IF NULLIF(_u->>'id','') IS NOT NULL THEN
      UPDATE public.product_units SET
        name = _u->>'name', equals_base = (_u->>'equals_base')::int,
        is_base = (_u->>'is_base')::boolean, is_default_sale = COALESCE((_u->>'is_default_sale')::boolean, false),
        sku = NULLIF(_u->>'sku',''), barcode = NULLIF(_u->>'barcode',''),
        purchase_price = COALESCE((_u->>'purchase_price')::numeric, 0),
        sale_price = COALESCE((_u->>'sale_price')::numeric, 0),
        sort_order = COALESCE((_u->>'sort_order')::int, 0), updated_at = now()
      WHERE id = (_u->>'id')::uuid AND product_id = _pid
      RETURNING id INTO _new_unit_id;
    ELSE
      INSERT INTO public.product_units(product_id, name, equals_base, is_base, is_default_sale, sku, barcode, purchase_price, sale_price, sort_order)
      VALUES (_pid, _u->>'name', (_u->>'equals_base')::int, (_u->>'is_base')::boolean,
              COALESCE((_u->>'is_default_sale')::boolean, false), NULLIF(_u->>'sku',''), NULLIF(_u->>'barcode',''),
              COALESCE((_u->>'purchase_price')::numeric, 0), COALESCE((_u->>'sale_price')::numeric, 0),
              COALESCE((_u->>'sort_order')::int, 0))
      RETURNING id INTO _new_unit_id;
    END IF;
    IF (_u->>'is_base')::boolean THEN _base_id := _new_unit_id; END IF;
  END LOOP;

  UPDATE public.products SET base_unit_id = _base_id WHERE id = _pid;

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

-- ===== PART 22: get_unit_breakdown ==========================================

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

-- ===== PART 23: Open / Close Shift functions =================================

CREATE OR REPLACE FUNCTION public.open_shift(_opening_cash numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _user_name text; _session_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_sessions WHERE user_id = auth.uid() AND status = 'open') THEN
    RAISE EXCEPTION 'You already have an open shift';
  END IF;
  SELECT coalesce(full_name, username, 'Cashier') INTO _user_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.cash_sessions(user_id, user_name, opening_cash, expected_cash, status)
  VALUES (auth.uid(), coalesce(_user_name, ''), _opening_cash, _opening_cash, 'open')
  RETURNING id INTO _session_id;
  RETURN jsonb_build_object('session_id', _session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_shift(_closing_cash numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _session_id uuid; _opening numeric; _cash_sales numeric;
        _online_sales numeric; _paid_out numeric; _expenses numeric; _expected numeric; _diff numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id, opening_cash INTO _session_id, _opening FROM public.cash_sessions
   WHERE user_id = auth.uid() AND status = 'open' FOR UPDATE;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'No open shift'; END IF;
  SELECT
    coalesce(sum(total) FILTER (WHERE lower(trim(coalesce(payment_type,'cash'))) =  'cash'), 0),
    coalesce(sum(total) FILTER (WHERE lower(trim(coalesce(payment_type,'cash'))) <> 'cash'), 0)
  INTO _cash_sales, _online_sales FROM public.sales WHERE session_id = _session_id;
  SELECT coalesce(sum(amount), 0) INTO _paid_out FROM public.supplier_payments
   WHERE session_id = _session_id AND lower(trim(coalesce(method,'cash'))) = 'cash';
  SELECT coalesce(sum(amount), 0) INTO _expenses FROM public.shift_expenses WHERE session_id = _session_id;
  _expected := _opening + _cash_sales - _paid_out - _expenses;
  _diff := _closing_cash - _expected;
  UPDATE public.cash_sessions
     SET closing_cash=_closing_cash, cash_sales=_cash_sales, online_sales=_online_sales,
         cash_paid_out=_paid_out, expenses=_expenses, expected_cash=_expected, difference=_diff,
         status='closed', closed_at=now()
   WHERE id = _session_id;
  RETURN jsonb_build_object('session_id',_session_id,'opening_cash',_opening,
    'cash_sales',_cash_sales,'online_sales',_online_sales,'cash_paid_out',_paid_out,
    'expenses',_expenses,'expected_cash',_expected,'closing_cash',_closing_cash,'difference',_diff);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_open_session()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s record; _cash_sales numeric; _online_sales numeric; _paid_out numeric; _expenses numeric;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _s FROM public.cash_sessions WHERE user_id = auth.uid() AND status = 'open' LIMIT 1;
  IF _s.id IS NULL THEN RETURN NULL; END IF;
  SELECT
    coalesce(sum(total) FILTER (WHERE lower(trim(coalesce(payment_type,'cash'))) =  'cash'), 0),
    coalesce(sum(total) FILTER (WHERE lower(trim(coalesce(payment_type,'cash'))) <> 'cash'), 0)
  INTO _cash_sales, _online_sales FROM public.sales WHERE session_id = _s.id;
  SELECT coalesce(sum(amount), 0) INTO _paid_out FROM public.supplier_payments
   WHERE session_id = _s.id AND lower(trim(coalesce(method,'cash'))) = 'cash';
  SELECT coalesce(sum(amount), 0) INTO _expenses FROM public.shift_expenses WHERE session_id = _s.id;
  RETURN jsonb_build_object('id',_s.id,'opening_cash',_s.opening_cash,
    'cash_sales',_cash_sales,'online_sales',_online_sales,
    'cash_paid_out',_paid_out,'expenses',_expenses,
    'expected_cash',_s.opening_cash + _cash_sales - _paid_out - _expenses, 'opened_at',_s.opened_at);
END;
$$;

-- ===== PART 24: record_expense ==============================================

CREATE OR REPLACE FUNCTION public.record_expense(_amount numeric, _description text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _name text; _session_id uuid; _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (has_role(_uid, 'cashier'::app_role) OR has_role(_uid, 'admin'::app_role)) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  SELECT id INTO _session_id FROM public.cash_sessions WHERE user_id = _uid AND status = 'open' LIMIT 1;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'No open shift — start a shift first'; END IF;
  SELECT coalesce(full_name, username, 'Cashier') INTO _name FROM public.profiles WHERE id = _uid;
  INSERT INTO public.shift_expenses(session_id, cashier_id, cashier_name, amount, description)
  VALUES (_session_id, _uid, coalesce(_name, ''), _amount, coalesce(_description, ''))
  RETURNING id INTO _id;
  RETURN jsonb_build_object('expense_id', _id, 'session_id', _session_id);
END;
$$;

-- ===== PART 25: record_supplier_payment =====================================

CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  _supplier_id uuid, _amount numeric, _method text default 'cash',
  _notes text default '', _payment_date date default CURRENT_DATE
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _name text; _session_id uuid; _payment_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (has_role(_uid,'cashier'::app_role) OR has_role(_uid,'admin'::app_role)) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = _supplier_id) THEN RAISE EXCEPTION 'Supplier not found'; END IF;
  SELECT coalesce(full_name, username, 'Cashier') INTO _name FROM public.profiles WHERE id = _uid;
  SELECT id INTO _session_id FROM public.cash_sessions WHERE user_id = _uid AND status = 'open' LIMIT 1;
  INSERT INTO public.supplier_payments(supplier_id, amount, method, notes, payment_date, created_by, created_by_name, session_id)
  VALUES (_supplier_id, _amount, coalesce(_method,'cash'), coalesce(_notes,''), coalesce(_payment_date,CURRENT_DATE), _uid, coalesce(_name,''), _session_id)
  RETURNING id INTO _payment_id;
  RETURN jsonb_build_object('payment_id',_payment_id,'session_id',_session_id);
END;
$$;

-- ===== PART 26: admin_update_shift ==========================================

CREATE OR REPLACE FUNCTION public.admin_update_shift(
  _session_id uuid, _opening_cash numeric default null, _closing_cash numeric default null,
  _cash_sales numeric default null, _expected_cash numeric default null,
  _difference numeric default null, _user_name text default null,
  _online_sales numeric default null, _cash_paid_out numeric default null
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _existing record;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Only admins can edit shifts'; END IF;
  SELECT * INTO _existing FROM public.cash_sessions WHERE id = _session_id;
  IF _existing.id IS NULL THEN RAISE EXCEPTION 'Shift not found'; END IF;
  UPDATE public.cash_sessions SET
    opening_cash = coalesce(_opening_cash, _existing.opening_cash),
    closing_cash = coalesce(_closing_cash, _existing.closing_cash),
    cash_sales = coalesce(_cash_sales, _existing.cash_sales),
    online_sales = coalesce(_online_sales, _existing.online_sales),
    cash_paid_out = coalesce(_cash_paid_out, _existing.cash_paid_out),
    expected_cash = coalesce(_expected_cash, _existing.expected_cash),
    difference = coalesce(_difference, _existing.difference),
    user_name = coalesce(_user_name, _existing.user_name)
  WHERE id = _session_id;
  RETURN jsonb_build_object('session_id', _session_id, 'status', 'updated');
END;
$$;

-- ===== PART 27: get_suppliers_summary =======================================

CREATE OR REPLACE FUNCTION public.get_suppliers_summary()
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY t.name), '[]'::jsonb)
  FROM (
    SELECT s.id, s.name, s.phone, s.address, s.notes,
      coalesce((SELECT sum(amount) FROM public.supplier_purchases WHERE supplier_id = s.id), 0) AS total_purchases,
      coalesce((SELECT sum(amount) FROM public.supplier_payments WHERE supplier_id = s.id), 0) AS total_paid,
      coalesce((SELECT sum(amount) FROM public.supplier_purchases WHERE supplier_id = s.id), 0)
        - coalesce((SELECT sum(amount) FROM public.supplier_payments WHERE supplier_id = s.id), 0) AS balance
    FROM public.suppliers s WHERE s.is_active = true
  ) t;
$$;

-- ===== PART 28: Dashboard & Report Functions ================================

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_summary(_start_at timestamptz, _days integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _gross numeric := 0; _bills integer := 0; _refunds numeric := 0; _returns_count integer := 0;
  _cash numeric := 0; _online numeric := 0; _profit numeric := 0;
  _daily jsonb := '[]'::jsonb; _top_products jsonb := '[]'::jsonb; _margin jsonb := '[]'::jsonb;
  _top_cashiers jsonb := '[]'::jsonb; _hourly jsonb := '[]'::jsonb;
  _prev_start timestamptz; _p_gross numeric := 0; _p_bills integer := 0; _p_refunds numeric := 0; _p_profit numeric := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only admins can view dashboard analytics'; END IF;
  _days := greatest(1, least(coalesce(_days, 7), 90));
  _prev_start := _start_at - (now() - _start_at);
  SELECT coalesce(sum(total), 0), count(*)::int,
         coalesce(sum(total) FILTER (WHERE lower(trim(coalesce(payment_type,'cash'))) = 'cash'), 0),
         coalesce(sum(total) FILTER (WHERE lower(trim(coalesce(payment_type,'cash'))) <> 'cash'), 0)
  INTO _gross, _bills, _cash, _online FROM public.sales WHERE created_at >= _start_at;
  SELECT coalesce(sum(refund_amount), 0), count(*)::int
  INTO _refunds, _returns_count FROM public.returns WHERE status = 'approved' AND coalesce(approved_at, created_at) >= _start_at;
  SELECT coalesce(sum(si.subtotal - (si.purchase_price * si.qty)), 0) INTO _profit
  FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id WHERE s.created_at >= _start_at;
  WITH day_series AS (
    SELECT generate_series(date_trunc('day', _start_at), date_trunc('day', now()), interval '1 day')::date AS day
  ), sales_by_day AS (
    SELECT date_trunc('day', created_at)::date AS day, sum(total) AS sales FROM public.sales WHERE created_at >= _start_at GROUP BY 1
  ), returns_by_day AS (
    SELECT date_trunc('day', coalesce(approved_at, created_at))::date AS day, sum(refund_amount) AS refunds
    FROM public.returns WHERE status = 'approved' AND coalesce(approved_at, created_at) >= _start_at GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('day', CASE WHEN _days = 1 THEN 'Today' ELSE to_char(ds.day, 'MM-DD') END, 'sales', round(coalesce(s.sales, 0)), 'refunds', round(coalesce(r.refunds, 0))) ORDER BY ds.day), '[]'::jsonb)
  INTO _daily FROM day_series ds LEFT JOIN sales_by_day s ON s.day = ds.day LEFT JOIN returns_by_day r ON r.day = ds.day;
  WITH product_totals AS (
    SELECT si.product_name AS name, sum(si.qty)::int AS qty, sum(si.subtotal) AS revenue
    FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id WHERE s.created_at >= _start_at
    GROUP BY si.product_name ORDER BY sum(si.qty) DESC LIMIT 7
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'revenue', revenue)), '[]'::jsonb) INTO _top_products FROM product_totals;
  WITH margin_buckets AS (
    SELECT CASE WHEN si.subtotal > 0 AND (((si.subtotal - (si.purchase_price * si.qty)) / si.subtotal) * 100) < 10 THEN 'Low (<10%)' WHEN si.subtotal > 0 AND (((si.subtotal - (si.purchase_price * si.qty)) / si.subtotal) * 100) < 30 THEN 'Mid (10-30%)' ELSE 'High (>30%)' END AS name, round(sum(si.subtotal)) AS value
    FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id WHERE s.created_at >= _start_at AND si.subtotal > 0 GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'value', value)), '[]'::jsonb) INTO _margin FROM margin_buckets WHERE value > 0;
  WITH cashier_totals AS (
    SELECT coalesce(nullif(cashier_name,''), 'Unknown') AS name, sum(total) AS sales, count(*)::int AS bills
    FROM public.sales WHERE created_at >= _start_at GROUP BY 1 ORDER BY sum(total) DESC LIMIT 5
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'sales', round(sales), 'bills', bills) ORDER BY sales DESC), '[]'::jsonb) INTO _top_cashiers FROM cashier_totals;
  WITH hours AS (SELECT generate_series(0, 23) AS hour), sales_by_hour AS (
    SELECT extract(hour FROM (created_at AT TIME ZONE 'Asia/Karachi'))::int AS hour, sum(total) AS sales FROM public.sales WHERE created_at >= _start_at GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('hour', h.hour, 'sales', round(coalesce(sh.sales, 0))) ORDER BY h.hour), '[]'::jsonb) INTO _hourly
  FROM hours h LEFT JOIN sales_by_hour sh ON sh.hour = h.hour;
  SELECT coalesce(sum(total), 0), count(*)::int INTO _p_gross, _p_bills FROM public.sales WHERE created_at >= _prev_start AND created_at < _start_at;
  SELECT coalesce(sum(refund_amount), 0) INTO _p_refunds FROM public.returns WHERE status = 'approved' AND coalesce(approved_at, created_at) >= _prev_start AND coalesce(approved_at, created_at) < _start_at;
  SELECT coalesce(sum(si.subtotal - (si.purchase_price * si.qty)), 0) INTO _p_profit FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id WHERE s.created_at >= _prev_start AND s.created_at < _start_at;
  RETURN jsonb_build_object('grossSales', _gross, 'bills', _bills, 'refunds', _refunds, 'net', _gross - _refunds, 'rate', CASE WHEN _gross > 0 THEN (_refunds / _gross) * 100 ELSE 0 END, 'returnsCount', _returns_count, 'cashSales', _cash, 'onlineSales', _online, 'grossProfit', _profit, 'daily', _daily, 'topProducts', _top_products, 'margin', _margin, 'topCashiers', _top_cashiers, 'hourly', _hourly, 'prev', jsonb_build_object('grossSales', _p_gross, 'bills', _p_bills, 'net', _p_gross - _p_refunds, 'grossProfit', _p_profit));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_inventory_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'products', count(*)::int,
    'lowStock', count(*) FILTER (WHERE stock <= min_stock_alert)::int,
    'lowStockItems', coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'stock', stock, 'min_stock_alert', min_stock_alert) ORDER BY stock ASC) FILTER (WHERE stock <= min_stock_alert), '[]'::jsonb)
  ) FROM public.products
$$;

CREATE OR REPLACE FUNCTION public.get_profit_report(_from timestamptz, _to timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH li AS (
    SELECT coalesce(nullif(si.product_name, ''), 'Unknown') AS name, ((s.created_at AT TIME ZONE 'UTC')::date) AS d,
           coalesce(si.qty, 0) AS qty, coalesce(si.qty, 0) * coalesce(si.unit_price, 0) AS revenue,
           coalesce(si.qty, 0) * coalesce(si.purchase_price, 0) AS cost,
           (coalesce(si.purchase_price, 0) = 0) AS zero_cost
    FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id
    WHERE s.created_at >= _from AND s.created_at <= _to
  ), by_product AS (
    SELECT name, sum(qty) AS qty, sum(revenue) AS revenue, sum(cost) AS cost, sum(revenue) - sum(cost) AS profit
    FROM li GROUP BY name
  ), by_day AS (
    SELECT d, sum(revenue) - sum(cost) AS profit, sum(revenue) AS sales FROM li GROUP BY d
  ), tot AS (
    SELECT coalesce(sum(revenue), 0) AS revenue, coalesce(sum(cost), 0) AS cost, coalesce(sum(CASE WHEN zero_cost THEN 1 ELSE 0 END), 0) AS zero_count FROM li
  )
  SELECT jsonb_build_object(
    'total_revenue', (SELECT revenue FROM tot), 'total_cost', (SELECT cost FROM tot), 'total_profit', (SELECT revenue - cost FROM tot),
    'zero_count', (SELECT zero_count FROM tot), 'by_product', coalesce((SELECT jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'revenue', revenue, 'cost', cost, 'profit', profit, 'margin', CASE WHEN revenue > 0 THEN (profit / revenue) * 100 ELSE 0 END) ORDER BY profit DESC) FROM by_product), '[]'::jsonb),
    'daily', coalesce((SELECT jsonb_agg(jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'), 'profit', round(profit), 'sales', round(sales)) ORDER BY d) FROM by_day), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_online_by_method(_from timestamptz, _to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _r jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only admins can view sales analytics'; END IF;
  SELECT coalesce(jsonb_object_agg(pt, amt), '{}'::jsonb) INTO _r FROM (
    SELECT lower(trim(coalesce(payment_type, 'cash'))) AS pt, sum(total) AS amt
    FROM public.sales WHERE created_at >= _from AND created_at <= _to GROUP BY 1
  ) s;
  RETURN _r;
END;
$$;

-- ===== PART 29: RLS Policies ================================================

-- Profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles self read" ON public.profiles;
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles admin read all" ON public.profiles;
CREATE POLICY "profiles admin read all" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles admin manage" ON public.profiles;
CREATE POLICY "profiles admin manage" ON public.profiles FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- User roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roles self read" ON public.user_roles;
CREATE POLICY "roles self read" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "roles admin read" ON public.user_roles;
CREATE POLICY "roles admin read" ON public.user_roles FOR SELECT USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "roles admin manage" ON public.user_roles;
CREATE POLICY "roles admin manage" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cat read" ON public.categories;
CREATE POLICY "cat read" ON public.categories FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cat admin write" ON public.categories;
CREATE POLICY "cat admin write" ON public.categories FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prod read" ON public.products;
CREATE POLICY "prod read" ON public.products FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "prod admin write" ON public.products;
CREATE POLICY "prod admin write" ON public.products FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "prod cashier insert" ON public.products;
CREATE POLICY "prod cashier insert" ON public.products FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'cashier') OR public.has_role(auth.uid(), 'admin'));

-- Sales
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales own read" ON public.sales;
CREATE POLICY "sales own read" ON public.sales FOR SELECT USING (auth.uid() = cashier_id);
DROP POLICY IF EXISTS "sales admin read" ON public.sales;
CREATE POLICY "sales admin read" ON public.sales FOR SELECT USING (public.has_role(auth.uid(),'admin'));

-- Sale items
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sale_items read own" ON public.sale_items;
CREATE POLICY "sale_items read own" ON public.sale_items FOR SELECT USING (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND (s.cashier_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

-- Store settings
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settings read" ON public.store_settings;
CREATE POLICY "settings read" ON public.store_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "settings admin write" ON public.store_settings;
CREATE POLICY "settings admin write" ON public.store_settings FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Bill sequences
ALTER TABLE public.bill_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "billseq admin read" ON public.bill_sequences;
CREATE POLICY "billseq admin read" ON public.bill_sequences FOR SELECT USING (public.has_role(auth.uid(),'admin'));

-- Suppliers
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "suppliers admin all" ON public.suppliers;
CREATE POLICY "suppliers admin all" ON public.suppliers FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "suppliers cashier select" ON public.suppliers;
CREATE POLICY "suppliers cashier select" ON public.suppliers FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));
DROP POLICY IF EXISTS "suppliers cashier insert" ON public.suppliers;
CREATE POLICY "suppliers cashier insert" ON public.suppliers FOR INSERT WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));
DROP POLICY IF EXISTS "suppliers cashier update" ON public.suppliers;
CREATE POLICY "suppliers cashier update" ON public.suppliers FOR UPDATE USING (has_role(auth.uid(), 'cashier'::app_role)) WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));

-- Supplier purchases
ALTER TABLE public.supplier_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supplier_purchases admin all" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases admin all" ON public.supplier_purchases FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "supplier_purchases cashier select" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases cashier select" ON public.supplier_purchases FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));
DROP POLICY IF EXISTS "supplier_purchases cashier insert" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases cashier insert" ON public.supplier_purchases FOR INSERT WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));
DROP POLICY IF EXISTS "supplier_purchases cashier update" ON public.supplier_purchases;
CREATE POLICY "supplier_purchases cashier update" ON public.supplier_purchases FOR UPDATE USING (has_role(auth.uid(), 'cashier'::app_role)) WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));

-- Supplier payments
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supplier_payments admin all" ON public.supplier_payments;
CREATE POLICY "supplier_payments admin all" ON public.supplier_payments FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "supplier_payments cashier select" ON public.supplier_payments;
CREATE POLICY "supplier_payments cashier select" ON public.supplier_payments FOR SELECT USING (public.has_role(auth.uid(), 'cashier'));
DROP POLICY IF EXISTS "supplier_payments cashier insert" ON public.supplier_payments;
CREATE POLICY "supplier_payments cashier insert" ON public.supplier_payments FOR INSERT WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));
DROP POLICY IF EXISTS "supplier_payments cashier update" ON public.supplier_payments;
CREATE POLICY "supplier_payments cashier update" ON public.supplier_payments FOR UPDATE USING (has_role(auth.uid(), 'cashier'::app_role)) WITH CHECK (has_role(auth.uid(), 'cashier'::app_role));

-- Cash sessions
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sessions own read" ON public.cash_sessions;
CREATE POLICY "sessions own read" ON public.cash_sessions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "sessions admin read" ON public.cash_sessions;
CREATE POLICY "sessions admin read" ON public.cash_sessions FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "sessions admin update" ON public.cash_sessions;
CREATE POLICY "sessions admin update" ON public.cash_sessions FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Stock entries
ALTER TABLE public.stock_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_entries admin read" ON public.stock_entries;
CREATE POLICY "stock_entries admin read" ON public.stock_entries FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "stock_entries own read" ON public.stock_entries;
CREATE POLICY "stock_entries own read" ON public.stock_entries FOR SELECT USING (auth.uid() = cashier_id);
DROP POLICY IF EXISTS "stock_entries cashier insert" ON public.stock_entries;
CREATE POLICY "stock_entries cashier insert" ON public.stock_entries FOR INSERT WITH CHECK (auth.uid() = cashier_id AND (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));

-- Product units
ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "punits read" ON public.product_units;
CREATE POLICY "punits read" ON public.product_units FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "punits admin write" ON public.product_units;
CREATE POLICY "punits admin write" ON public.product_units FOR ALL USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "punits cashier insert" ON public.product_units;
CREATE POLICY "punits cashier insert" ON public.product_units FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Inventory movements
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inv_mov admin read" ON public.inventory_movements;
CREATE POLICY "inv_mov admin read" ON public.inventory_movements FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "inv_mov own read" ON public.inventory_movements;
CREATE POLICY "inv_mov own read" ON public.inventory_movements FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "inv_mov insert" ON public.inventory_movements;
CREATE POLICY "inv_mov insert" ON public.inventory_movements FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND (has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));

-- Returns
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "returns own read" ON public.returns;
CREATE POLICY "returns own read" ON public.returns FOR SELECT USING (auth.uid() = cashier_id);
DROP POLICY IF EXISTS "returns admin read" ON public.returns;
CREATE POLICY "returns admin read" ON public.returns FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Return items
ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "return_items read own" ON public.return_items;
CREATE POLICY "return_items read own" ON public.return_items FOR SELECT USING (EXISTS (SELECT 1 FROM public.returns r WHERE r.id = return_items.return_id AND (r.cashier_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))));

-- User audit log
ALTER TABLE public.user_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit admin read" ON public.user_audit_log;
CREATE POLICY "audit admin read" ON public.user_audit_log FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "audit admin insert" ON public.user_audit_log;
CREATE POLICY "audit admin insert" ON public.user_audit_log FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Daily expenses
ALTER TABLE public.daily_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "daily_expenses admin all" ON public.daily_expenses;
CREATE POLICY "daily_expenses admin all" ON public.daily_expenses FOR ALL USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Shift expenses
ALTER TABLE public.shift_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shift_expenses select own" ON public.shift_expenses;
CREATE POLICY "shift_expenses select own" ON public.shift_expenses FOR SELECT USING (cashier_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "shift_expenses admin all" ON public.shift_expenses;
CREATE POLICY "shift_expenses admin all" ON public.shift_expenses FOR ALL USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ===== PART 30: Triggers ====================================================

DROP TRIGGER IF EXISTS products_touch ON public.products;
CREATE TRIGGER products_touch BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_suppliers_updated ON public.suppliers;
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS product_units_touch ON public.product_units;
CREATE TRIGGER product_units_touch BEFORE UPDATE ON public.product_units
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== PART 31: Seed Default Data ==========================================

INSERT INTO public.categories (name) VALUES ('General'), ('Beverages'), ('Snacks'), ('Groceries')
ON CONFLICT (name) DO NOTHING;

-- ===== PART 32: Secure Function Execute Privileges ==========================

-- Only necessary revokes/grants for security definer functions
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.next_bill_no(text) FROM public, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.process_sale_v2(jsonb, numeric, numeric, numeric, numeric, numeric, numeric, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.process_sale_v2(jsonb, numeric, numeric, numeric, numeric, numeric, numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.add_stock_entry_v2(uuid, uuid, integer, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.add_stock_entry_v2(uuid, uuid, integer, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.add_stock_entry(uuid, integer, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.add_stock_entry(uuid, integer, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_stock_entry(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.approve_stock_entry(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reject_stock_entry(uuid, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.reject_stock_entry(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.process_return(uuid, jsonb, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.process_return(uuid, jsonb, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_return(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.approve_return(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.void_return(uuid, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.void_return(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.save_product_with_units(jsonb, jsonb, jsonb) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.save_product_with_units(jsonb, jsonb, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.open_shift(numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.open_shift(numeric) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.close_shift(numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.close_shift(numeric) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_open_session() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_open_session() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.record_expense(numeric, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.record_expense(numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_update_shift(uuid, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.admin_update_shift(uuid, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_summary(timestamptz, integer) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_dashboard_summary(timestamptz, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_inventory_summary() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_inventory_summary() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_profit_report(timestamptz, timestamptz) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_profit_report(timestamptz, timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_online_by_method(timestamptz, timestamptz) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_online_by_method(timestamptz, timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM public, anon, authenticated;

-- Grant table access
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
