import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ProductUnitsEditor, makeBlankUnit, validateUnits } from "@/components/ProductUnitsEditor";
import type { UnitDraft } from "@/lib/units";
import { fetchUnitsByProductIds } from "@/lib/units";

export interface QuickAddProduct {
  id: string;
  barcode: string;
  name: string;
  sale_price: number;
  purchase_price: number;
  stock: number;
  category_id: string | null;
}

function genBarcode() {
  return "ZIC" + Date.now().toString().slice(-9) + Math.floor(Math.random() * 10);
}

const NONE = "__none__";

function defaultUnits(): UnitDraft[] {
  return [
    {
      ...makeBlankUnit(),
      name: "Piece",
      equals_base: 1,
      is_base: true,
      is_default_sale: true,
      sort_order: 0,
    },
  ];
}

export function QuickAddProductDialog({
  open,
  onClose,
  initialBarcode,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  initialBarcode?: string;
  onCreated: (p: QuickAddProduct) => void;
}) {
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [categoryId, setCategoryId] = useState<string>(NONE);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [minStock, setMinStock] = useState<string>("5");
  const [units, setUnits] = useState<UnitDraft[]>(defaultUnits());
  const [initialStockQty, setInitialStockQty] = useState<string>("1");
  const [initialStockUnitIdx, setInitialStockUnitIdx] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setBarcode(initialBarcode?.trim() || genBarcode());
      setCategoryId(NONE);
      setMinStock("5");
      setUnits(defaultUnits());
      setInitialStockQty("1");
      setInitialStockUnitIdx(0);
      supabase
        .from("categories")
        .select("id, name")
        .order("name")
        .then(({ data }) => setCategories((data ?? []) as any));
    }
  }, [open, initialBarcode]);

  const save = async () => {
    if (!name.trim()) return toast.error("Name is required");
    if (!barcode.trim()) return toast.error("Barcode is required");
    const err = validateUnits(units);
    if (err) return toast.error(err);

    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from("products")
        .select("id,name")
        .eq("barcode", barcode.trim())
        .maybeSingle();
      if (existing) {
        toast.error(`Barcode already used by "${(existing as any).name}"`);
        return;
      }

      const baseUnit = units.find((u) => u.is_base)!;
      const productPayload = {
        name: name.trim(),
        barcode: barcode.trim(),
        category_id: categoryId === NONE ? null : categoryId,
        purchase_price: Number(baseUnit.purchase_price),
        sale_price: Number(baseUnit.sale_price),
        min_stock_alert: Math.max(0, parseInt(minStock, 10) || 0),
        is_active: true,
      };
      const unitsPayload = units.map((u, idx) => ({
        name: u.name.trim(),
        equals_base: u.equals_base,
        is_base: u.is_base,
        is_default_sale: u.is_default_sale,
        sku: u.sku || null,
        barcode: u.barcode || null,
        purchase_price: u.purchase_price,
        sale_price: u.sale_price,
        sort_order: idx,
      }));

      const { data: pid, error } = await supabase.rpc("save_product_with_units", {
        _product: productPayload,
        _units: unitsPayload,
        _initial_stock: null,
      });
      if (error) {
        toast.error(error.message);
        return;
      }

      const productId = pid as unknown as string;

      // Apply initial stock (if any) against the selected unit now that IDs exist
      const qty = Math.max(0, parseInt(initialStockQty, 10) || 0);
      if (qty > 0) {
        const map = await fetchUnitsByProductIds([productId]);
        const created = map[productId] ?? [];
        // Match by unit name to the editor row index (units are sorted by equals_base desc from RPC)
        const targetName = units[initialStockUnitIdx]?.name.trim().toLowerCase();
        const target =
          created.find((u) => u.name.trim().toLowerCase() === targetName) ??
          created.find((u) => u.is_base);
        if (target) {
          const { error: stkErr } = await supabase.rpc("add_stock_entry_v2", {
            _product_id: productId,
            _unit_id: target.id,
            _qty: qty,
            _notes: "Initial stock (Quick Add)",
          });
          if (stkErr) toast.error(stkErr.message);
        }
      }

      const { data: fresh } = await supabase
        .from("products")
        .select("id, barcode, name, sale_price, purchase_price, stock, category_id")
        .eq("id", productId)
        .single();

      toast.success("Product added");
      onCreated(fresh as QuickAddProduct);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Quick Add Product</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Product Name</Label>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Pepsi 500ml"
              />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Uncategorized</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Barcode</Label>
              <div className="flex gap-2">
                <Input
                  className="flex-1 font-mono"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                />
                <Button type="button" variant="outline" onClick={() => setBarcode(genBarcode())}>
                  Gen
                </Button>
              </div>
            </div>
            <div>
              <Label>Low-stock Alert</Label>
              <Input
                type="number"
                min="0"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
              />
            </div>
          </div>

          <ProductUnitsEditor
            units={units}
            onChange={(next) => {
              // Cashier rule: the "Piece" row (index 0) is ALWAYS the base + default sale unit.
              const locked = next.map((u, i) =>
                i === 0
                  ? { ...u, name: "Piece", equals_base: 1, is_base: true, is_default_sale: true }
                  : { ...u, is_base: false, is_default_sale: false },
              );
              setUnits(locked);
            }}
          />

          <div className="rounded-xl border bg-card p-4">
            <div className="font-semibold mb-3">Initial Stock (optional)</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min="0"
                  value={initialStockQty}
                  onChange={(e) => setInitialStockQty(e.target.value)}
                />
              </div>
              <div>
                <Label>In Unit</Label>
                <Select
                  value={String(initialStockUnitIdx)}
                  onValueChange={(v) => setInitialStockUnitIdx(parseInt(v, 10))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {units.map((u, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {u.name || `Unit ${i + 1}`}
                        {u.is_base ? " (Base)" : ` (× ${u.equals_base})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Stock is stored in the base unit. If you enter initial stock in another unit it will
              be converted automatically.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            The base unit will be added to the cart automatically after saving.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save & Add to Cart"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
