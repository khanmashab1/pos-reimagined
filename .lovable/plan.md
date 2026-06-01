# Quick Add Product from POS

Let cashiers (and admins) create a new product directly from the POS screen and auto-add it to the current cart.

## UX

- Add an **"+ New Product"** button in the POS toolbar (next to search/scan).
- Also trigger the same dialog when a typed/scanned barcode is **not found**, with prompt: *"Product not found — add it?"*
- **Quick Add dialog** (minimal):
  - Name (required)
  - Sale Price (required)
  - Barcode (auto-generated, editable, "Gen" button)
  - Stock defaults to `1` (so it can be sold immediately)
  - Purchase price defaults to `0`, category null
- On save: insert product, then auto-add 1 unit to the cart.

## Database / Permissions

Current RLS on `products` is admin-only writes (`prod admin write`). Add a policy so cashiers can INSERT products too (no update/delete for cashiers — they keep using the quick-add path only):

```sql
CREATE POLICY "prod cashier insert"
ON public.products
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'cashier')
  OR public.has_role(auth.uid(), 'admin')
);
```

Admin ALL policy remains untouched.

## Files

- `supabase/migrations/<new>.sql` — add the insert policy above.
- `src/routes/pos.tsx` — add "New Product" button, quick-add dialog component, unknown-barcode handler hook into the existing scan/search flow, auto-add to cart on save.

No changes to admin Products page or supplier flow.
