## What's redundant

In the Edit Product dialog, three top fields duplicate what the base "Piece" row in the Units, Conversion & Pricing table already stores:

- **Barcode (Base Unit)** at the top = the Barcode cell on the Piece row
- **Default Purchase (Piece)** = the Purchase cell on the Piece row (12.1)
- **Default Sale (Piece)** = the Sale cell on the Piece row (15)

Today, the save handler already mirrors the base unit's prices onto the product row for backward compatibility, so keeping two inputs for the same value invites drift (edit one, forget the other) and clutter.

## Proposed change

- Remove the "Barcode (Base Unit)", "Default Purchase (Piece)" and "Default Sale (Piece)" inputs from the top of the Edit/Add Product dialog on `/admin/products`.
- Keep the base unit's Barcode / Purchase / Sale cells inside the Units table as the single source of truth.
- Keep Product Name, Category, and Low Stock Alert at the top (not duplicated anywhere else).
- Keep the small green "Base Unit — Piece" info card as a hint.
- Save logic already reads `purchase_price` / `sale_price` from the base unit row into the `products` row — no backend change needed. The product-level `barcode` column will be populated from the base unit's barcode on save (falling back to a generated one if empty) so existing lookups keep working.

## What stays the same

- Cashier Quick Add dialog on POS is unchanged.
- Units table, stock editor, and Example Conversions panel below are unchanged.
- Database schema and RPCs are unchanged.

## Technical notes

- File: `src/routes/admin.products.tsx` — remove the three inputs and the `form.barcode` / top-level purchase/sale inputs from the dialog JSX; in `save`, set `productPayload.barcode = baseUnit.barcode?.trim() || <generated>` so the product row always has a barcode.
- Validation: replace the "Name and barcode are required" check with "Name is required" and let `validateUnits` continue to enforce the base unit exists; add a fallback that auto-generates a barcode on the base unit if the admin left it blank.
