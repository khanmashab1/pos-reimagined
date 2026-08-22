# ZIC Mart POS — Complete Fix & Improvement Spec

> **For Claude Code.** This is a single implementation spec consolidating every fix and feature discussed. Implement all sections in this codebase. **No design or layout changes** unless a section explicitly asks for new UI. Match the existing ZIC Mart green theme `#1A7A3E` for any new elements.

---

## How to use this document

Work through the sections in order. Sections **A–B** add barcode/unit support, **C** fixes the profit model, **D–E** add two new tables and their UI, **F** fixes the cashier report, and **G** rebuilds the suppliers page. Section **H** is the canonical formula reference — treat it as the single source of truth whenever a figure appears anywhere in the app.

Before writing code, locate the existing data layer (queries/mutations), the page components for Dashboard, Profit Report, Daily Expenses, Cashier Report, Stock Entry, POS Sale, and Suppliers, and confirm the database tables that already exist (`products`, `product_units`, `stock_entries`, `sales`, `sale_items`, `cash_sessions`, `suppliers`, `supplier_purchases`, `supplier_payments`). Reuse existing patterns rather than introducing new ones.

---

## ⚠️ One inconsistency to resolve first

Two of the source prompts define **revenue** differently:

- Section C says: `Net Sale Revenue = SUM(sales.total)` — and notes this value **already has discount deducted**.
- An earlier formula prompt said: `Gross Profit = SUM(sale_items.unit_price × qty) − SUM(cost)` — which is computed from line items and is therefore **pre-discount**.

These can disagree whenever a discount exists. **Use `SUM(sales.total)` as the canonical net revenue** (the discount-inclusive version), because it is the later, more refined decision and it correctly accounts for discounts. Compute cost of goods separately from `sale_items`. Do **not** mix the two revenue definitions. See Section H for the canonical formulas.

---

## SECTION A — Stock Entry: barcode & unit support

On the `/stock-entry` page:

1. The **barcode field** must search both `products.barcode` (base unit) and `product_units.barcode` (Box / Half Box / etc.). On a match, auto-load the product and auto-select the matched unit.
2. The **unit dropdown** shows all units from `product_units` for that product, e.g. Box (20 pcs), Half Box (10 pcs), Piece (1 pc).
3. The **quantity entered is in the selected unit**. Convert to pieces:
   `qty_pieces = entered_qty × unit.equals_pieces`
4. **Save to `stock_entries`:** `qty` = pieces, `unit_name` = selected unit, `qty_in_unit` = the entered quantity. Then **increase `products.stock` by `qty_pieces`**.
5. Show a confirmation message such as: `Adding 3 box = 60 pieces to CAPSTAN RED`.

---

## SECTION B — POS Sale screen: barcode & cost tracking

On the POS sale screen:

1. **Barcode scan** searches both `products.barcode` and `product_units.barcode`. A match in `product_units` auto-selects that unit and its `sale_price`.
2. **On sale, deduct `unit.equals_pieces × qty` from `products.stock`** (i.e. reduce stock by the piece-equivalent of what was sold).
3. **Critical — cost capture:** when saving `sale_items`, always copy the purchase price *at time of sale*:
   - Unit sale → copy `product_units.purchase_price` for the matched unit.
   - Base-unit sale → copy `products.purchase_price`.
   - **Never save `sale_items.purchase_price = 0`.** If no purchase price is available, surface a warning and flag the sale rather than silently writing 0.

---

## SECTION C — Profit model (Dashboard, Profit Report, Daily Expenses, Cashier Report)

Apply the **same** profit logic on every page where these figures appear:

```
Net Sale Revenue = SUM(sales.total)                          // discount already deducted
Cost of Goods    = SUM(sale_items.purchase_price × qty)
Gross Profit     = Net Sale Revenue − Cost of Goods
Net Profit       = Gross Profit − SUM(operating_expenses.amount)
Profit Margin    = (Gross Profit ÷ Net Sale Revenue) × 100
```

Rules:

- **Never subtract `supplier_payments` from profit.** Supplier payments are inventory investment. Show them in a separate **“Stock Purchased”** card instead.
- Add a **“Total Discounts Given”** card = `SUM(sales.discount)` for the period (informational only — do not subtract again; it is already reflected in `sales.total`).
- Fix the **“Inaccurate profit data”** warning's **“Fix Now”** button so an admin can set missing purchase prices and recalculate the affected sales (update those `sale_items.purchase_price` values, then recompute profit figures).
- Profit Margin shows as a percentage: **green if positive, red if negative**.

---

## SECTION D — Operating Expenses (Rent, Bills, Salaries)

Create table **`operating_expenses`**:

| Column | Notes |
|---|---|
| `id` | PK |
| `date` | expense date |
| `category` | one of the categories below |
| `description` | text |
| `amount` | numeric |
| `paid_to` | text |
| `payment_method` | Cash / EasyPaisa / JazzCash / Card / Bank |
| `recorded_by_name` | text |
| `created_at` | timestamp default now |

**Categories:** Rent · Electricity · Gas · Internet · Salary · Wages · Miscellaneous

On the **Daily Expenses Report** page:
- Add an **“Add Operating Expense”** form with all the fields above.
- Add a **“Total Operating Expenses”** card, broken down by category.

---

## SECTION E — Person Payments (Junaid, Usama, etc.)

Create table **`person_payments`**:

| Column | Notes |
|---|---|
| `id` | PK |
| `date` | payment date |
| `person_name` | Junaid / Usama / Other |
| `amount` | numeric |
| `payment_method` | Cash / EasyPaisa / JazzCash / Card / Bank |
| `notes` | text |
| `recorded_by_name` | text |
| `created_at` | timestamp default now |

- **Replace** the manual “Cash Junaid / Cash Usama” fields with an **“Add Payment”** form: Date, Person (dropdown: Junaid / Usama / Other), Amount, Method, Notes.
- The **“BY PERSON”** section on the dashboard reads from `person_payments`, **grouped by person and by payment method**.

---

## SECTION F — Cashier Report: Net Difference fix

Correct the cashier report calculations (compute **per `cash_sessions` row, then sum**):

```
Net Difference = opening_cash + cash_sales − cash_paid_out − expenses
```

Rules:

- Show **Cash Sales** and **Online Sales** as **separate cards** — never add them together for cash flow. Online sales never enter the cash drawer, so they must not appear in Net Difference.
  - `Cash Sales = SUM(cash_sessions.cash_sales)`
  - `Online Sales = SUM(cash_sessions.online_sales)`
- Add an **Expenses** card.
- The **per-cashier table** shows columns: Cashier · Sessions · Cash Sales · Online Sales · Cash Paid Out · Expenses · Net Difference.
- Net Difference is **green if positive, red if negative**.

---

## SECTION G — Suppliers page (`/suppliers`): complete report

### G1 — Date filter tabs
Add 4 tabs just below the page title: **Today · This Week · This Month · All Time**. Default to **Today**. All summary cards, supplier cards, and the Manage drawer update based on the selected tab. Only show suppliers with **at least one bill or payment in the selected period**. If none, show: `No supplier activity in this period.`

### G2 — Summary cards (3, update with filter)

| Card | Value |
|---|---|
| Total Purchases | `SUM(supplier_purchases.amount)` for the period |
| Total Paid | `SUM(supplier_payments.amount)` for the period |
| Outstanding | `Total Purchases − Total Paid` · **red if > 0**, green if 0 |

### G3 — Today's activity banner
When the **Today** tab is active, show a compact green banner below the cards listing each payment made today, one line per payment:
`Walls — Rs. 14,430 · Cash · by Abdullah`
If nothing today: `No payments recorded today.`

### G4 — Supplier card improvements
- BILLS · PAID · LEFT reflect the **selected period only**.
- **Sort suppliers by Bills amount descending** (highest first).
- **LEFT** shown red bold if > 0, green if cleared.
- Show last payment date under the supplier name: `Last paid: 08-Jun-2026` (format `DD-MMM-YYYY`).

### G5 — Manage button → full supplier ledger drawer
Tapping **Manage** opens a drawer (respecting the active date filter) with:
- **Bills section** (yellow rows): Date · Bill No · Amount · Description
- **Payments section** (green rows): Date · Amount · Method · Recorded By · Notes
- **Bottom summary:** Total Billed · Total Paid · Balance Due (red if > 0, green if cleared).

### G6 — Export Excel button
Add a white **“Export Excel”** button next to “Add Supplier” that downloads an `.xlsx` with 3 sheets:
1. **Supplier Summary** (filtered period)
2. **All Transactions** (Date · Supplier · Type [Bill/Payment] · Amount · Method · By)
3. **Per-Supplier Ledger** (grouped, with **running balance**)

Filename: `ZICMart-Suppliers-[from]-to-[to].xlsx`

### G7 — Dynamic supplier dropdown
The supplier dropdown **anywhere in the app** loads dynamically from the `suppliers` table, **alphabetical**.

---

## SECTION H — Canonical formula reference (single source of truth)

Apply these everywhere these figures appear. Do not let any page diverge.

### Cashier / cash flow
```
Net Difference = opening_cash + cash_sales − cash_paid_out − expenses   (per session, then summed)
Cash Sales     = SUM(cash_sessions.cash_sales)
Online Sales   = SUM(cash_sessions.online_sales)
Cash in Hand   = opening_cash + cash_sales − cash_paid_out − expenses
```
Never combine cash and online sales in any cash-flow figure.

### Profit
```
Net Sale Revenue = SUM(sales.total)                       // discount already deducted
Cost of Goods    = SUM(sale_items.purchase_price × qty)
Gross Profit     = Net Sale Revenue − Cost of Goods
Net Profit       = Gross Profit − SUM(operating_expenses.amount)
Profit Margin    = (Gross Profit ÷ Net Sale Revenue) × 100
```
Supplier payments are **never** subtracted from profit.

### Sale items cost capture
```
sale_items.purchase_price = product_units.purchase_price   (unit sale, matched by unit_id)
                          OR products.purchase_price        (base-unit sale)
```
Never `0`.

### Supplier outstanding
```
Outstanding (per supplier) = SUM(supplier_purchases.amount) − SUM(supplier_payments.amount)
```
Red if > 0, green if 0. Never display negative.

### Dashboard summary cards

| Card | Source |
|---|---|
| Total Sales | `SUM(sales.total)` filtered by period |
| Cash Sales | `SUM(cash_sessions.cash_sales)` filtered by period |
| Online Sales | `SUM(cash_sessions.online_sales)` filtered by period |
| Gross Profit | Net Sale Revenue − Cost of Goods (from `sale_items`) |
| Net Profit | Gross Profit − `SUM(operating_expenses.amount)` |
| Total Expenses | `SUM(operating_expenses.amount)` only — **not** supplier payments |
| Stock Purchased | `SUM(supplier_payments.amount)` (separate card, not in profit) |
| Total Discounts Given | `SUM(sales.discount)` (informational) |
| Cash in Hand | `opening_cash + cash_sales − cash_paid_out − expenses` |

---

## Acceptance checklist

- [ ] Stock entry accepts unit barcodes and base barcodes; quantity converts to pieces correctly; `products.stock` increases by pieces.
- [ ] POS scan resolves unit vs base; stock deducts by piece-equivalent; every `sale_items` row stores a non-zero `purchase_price`.
- [ ] Profit figures identical across Dashboard, Profit Report, Daily Expenses, Cashier Report; supplier payments excluded from profit.
- [ ] `operating_expenses` and `person_payments` tables exist with their forms; dashboard “BY PERSON” reads from `person_payments`.
- [ ] Cashier report uses the Net Difference formula; cash and online sales never combined; expenses card present.
- [ ] Suppliers page: filter tabs, live summary cards, today banner, sorted cards with last-paid date, Manage ledger drawer, Excel export (3 sheets, correct filename), dynamic alphabetical dropdown.
- [ ] No existing design/layout/colors changed; new elements use `#1A7A3E`.
