
# Multi-Unit Pricing & Inventory Module

A complete upgrade that lets each product be sold in multiple units (Box, Half Box, Piece, etc.) while keeping inventory stored internally in a single Base Unit. Stock auto-converts during purchase, sale, return, and restock; POS lets the cashier pick the selling unit and applies the correct price.

---

## 1. Database (single migration)

### New table: `product_units`
- `id uuid pk`
- `product_id uuid` → products(id) ON DELETE CASCADE
- `name text` (e.g. Box, Half Box, Piece)
- `equals_base int` — how many base units = 1 of this unit (Piece = 1)
- `is_base bool` — exactly one true per product
- `is_default_sale bool` — preselected in POS
- `sku text` nullable
- `barcode text` nullable (UNIQUE where not null)
- `purchase_price numeric`
- `sale_price numeric`
- `sort_order int`
- timestamps
- UNIQUE(product_id, lower(name))
- CHECK equals_base > 0, prices >= 0

RLS: read for authenticated; admin ALL; cashier INSERT (so POS quick-add still works).

### `products` table changes
- Add `base_unit_id uuid` (nullable for backward compat) — points at the base `product_units` row.
- Keep existing `stock`, `purchase_price`, `sale_price`, `barcode` as the **base-unit canonical values** (backward compat).
- `stock` continues to mean stock in BASE units.

### Backfill
For every existing product, insert one `product_units` row using the product's current `barcode/name/purchase_price/sale_price`, `equals_base = 1`, `is_base = true`, `is_default_sale = true`. Set `products.base_unit_id` to it. Existing data keeps working unchanged.

### New table: `inventory_movements`
- `id`, `product_id`, `unit_id` (the unit used at the moment of the action), `qty_in_unit`, `qty_in_base` (signed +/-), `kind` ('sale' | 'return' | 'restock' | 'adjustment' | 'initial'), `ref_id` (sale_id/return_id/stock_entry_id), `user_id`, `user_name`, `created_at`. RLS: admin read, own read, insert by trigger/RPCs.

### Updated RPCs
- `process_sale(_items jsonb, ...)`: each item now carries `unit_id`, `qty` (in chosen unit), `unit_price`. Function computes `qty_base = qty * unit.equals_base`, deducts from `products.stock`, writes `sale_items` (extend with `unit_id`, `unit_name`, `qty_in_unit`, `qty_in_base`), and inserts an `inventory_movements` row.
- `add_stock_entry(_product_id, _unit_id, _qty, _notes)`: convert to base via unit, increment `products.stock`, log movement.
- `process_return`: same — items reference unit_id; refund and stock restoration use base-unit math.

### New RPC: `save_product_with_units(_product jsonb, _units jsonb)`
Atomic upsert: writes product row, replaces its `product_units` rows, enforces exactly-one base, sets `products.base_unit_id`, optional `_initial_stock { unit_id, qty }` converts to base and increments `stock` + logs an `initial` movement.

### New RPC: `get_unit_breakdown(_product_id)`
Returns `[{unit_id, name, equals_base, count}]` greedy-decomposed from current base stock — used for the "In Larger Units" column and the Stock Summary card.

### Reporting view: `v_unit_sales`
Aggregates `sale_items` by `product_id, unit_id, unit_name` with qty in unit, qty in base, revenue, cost, profit.

---

## 2. Backend / Server functions

No new server functions required — all DB writes go through RPCs called via the existing `supabase` client (consistent with current code style). Auth middleware already gates writes through RLS + `has_role`.

---

## 3. Frontend

### New shared types & helpers (`src/lib/units.ts`)
- `ProductUnit`, `ProductWithUnits` types
- `toBase(qty, unit)`, `fromBase(qtyBase, unit)`
- `greedyBreakdown(qtyBase, units)` → ordered display string ("2 Boxes + 1 Half Box + 3 Pieces")
- `marginPct(sale, cost)`

### New component: `src/components/ProductUnitsEditor.tsx`
The "Units, Conversion & Pricing" table from the reference image:
- Add/remove rows, mark base, mark default sale unit
- Inline barcode scan + Gen
- Live profit % per row
- Inline validations (unique name, equals > 0, prices ≥ 0, exactly one base)

### New component: `src/components/StockBreakdownBadge.tsx`
Renders "2 Boxes • 1 Half Box • 3 Pieces" from `greedyBreakdown`.

### Updated: `src/routes/admin.products.tsx`
Replace the existing Add/Edit dialog with a larger dialog matching the reference:
- Product Name + base barcode + Gen + scan
- Category + Default purchase/sale price (per base unit)
- `ProductUnitsEditor` block
- Initial Stock (Add in any unit) + Total Stock readout
- Stock Summary (post-save preview) + Example Conversions
- Real-time Stock Preview ("If you sell N <unit> → remaining …")
- Saves through `save_product_with_units` RPC
- Products table adds a new column "In Larger Units" using `StockBreakdownBadge`

### Updated: `src/routes/pos.tsx`
- When a product is added to cart, default to its `is_default_sale` unit (fallback to base).
- Cart line shows a unit dropdown (all units for that product). Switching unit updates `unit_price` and recomputes subtotal; qty stays in the chosen unit.
- Scanning a barcode now matches **either** `products.barcode` **or** `product_units.barcode` — when matched on a unit barcode, the line is added in that unit at that unit's price.
- Stock check uses `qty * unit.equals_base ≤ product.stock`.
- `QuickAddProductDialog`: still creates a single-unit (base) product — unchanged, backward compatible.
- Payload sent to `process_sale` includes `unit_id` and `qty_in_unit`.

### Updated: `src/routes/stock-entry.tsx`
Add a Unit selector next to qty; submit `unit_id` along with qty. Function converts.

### Updated: `src/routes/admin.stock-summary.tsx` & `admin.reports.tsx`
- Add unit-wise sales/profit table (from `v_unit_sales`).
- Inventory movement history list (filterable by product, date, kind).
- Stock value: `sum(stock * purchase_price)` (base unit) unchanged.

### Updated: `src/components/BarcodeLabel.tsx`
Allow printing a unit's barcode (pass unit instead of product).

---

## 4. Backward compatibility

- Migration backfills a base `product_units` row for every existing product, so existing carts, sales, returns, and reports keep working.
- `sale_items.unit_id` / `inventory_movements` rows for historical sales are NOT backfilled — they simply remain `null` and reports treat null as "base unit".
- `QuickAddProductDialog` keeps creating single-unit products; the new editor is opt-in via the admin Products page.
- All existing RPC signatures remain callable; new `unit_id` parameter is optional and defaults to the base unit.

---

## 5. Files touched

**Migration**
- `supabase/migrations/<new>.sql` — tables, RLS, GRANTs, RPC updates, backfill, view.

**New**
- `src/lib/units.ts`
- `src/components/ProductUnitsEditor.tsx`
- `src/components/StockBreakdownBadge.tsx`

**Updated**
- `src/routes/admin.products.tsx` (dialog + list column)
- `src/routes/pos.tsx` (cart unit selector, scan, payload)
- `src/routes/stock-entry.tsx` (unit selector)
- `src/routes/admin.stock-summary.tsx` (unit-wise tables)
- `src/routes/admin.reports.tsx` (unit-wise sales/profit, movements)
- `src/routes/returns.tsx` (unit-aware return)
- `src/components/QuickAddProductDialog.tsx` (set base_unit_id on insert via RPC wrapper)
- `src/components/BarcodeLabel.tsx` (optional unit param)

---

## 6. Rollout order (single message after approval)

1. Run the migration (tables, backfill, RPC updates).
2. Add types/helpers + new components.
3. Wire into admin Products, POS, stock-entry, returns, reports.
4. Smoke test: existing products still scan/sell; new multi-unit product flows end-to-end.

This is a sizable change. Approve and I'll build it in one pass.
