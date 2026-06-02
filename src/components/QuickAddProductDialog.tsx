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
import { toast } from "sonner";

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
  const [salePrice, setSalePrice] = useState<string>("");
  const [stock, setStock] = useState<string>("1");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setBarcode(initialBarcode?.trim() || genBarcode());
      setSalePrice("");
      setStock("1");
    }
  }, [open, initialBarcode]);

  const save = async () => {
    if (!name.trim()) return toast.error("Name is required");
    const price = Number(salePrice);
    if (!price || price <= 0) return toast.error("Sale price must be greater than 0");
    if (!barcode.trim()) return toast.error("Barcode is required");

    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from("products")
        .select("*")
        .eq("barcode", barcode.trim())
        .maybeSingle();

      if (existing) {
        toast.error(`Barcode already used by "${(existing as any).name}"`);
        return;
      }

      const stockNum = Math.max(0, parseInt(stock, 10) || 0);

      const { data, error } = await supabase
        .from("products")
        .insert({
          name: name.trim(),
          barcode: barcode.trim(),
          sale_price: price,
          purchase_price: 0,
          stock: stockNum,
          min_stock_alert: 5,
          category_id: null,
          is_active: true,
        })
        .select("*")
        .single();

      if (error) {
        toast.error(error.message);
        return;
      }

      // Create matching base unit so multi-unit features (POS unit selector, breakdown) work.
      const created = data as QuickAddProduct;
      const { data: unitRow } = await supabase
        .from("product_units")
        .insert({
          product_id: created.id,
          name: "Piece",
          equals_base: 1,
          is_base: true,
          is_default_sale: true,
          purchase_price: 0,
          sale_price: price,
          sort_order: 0,
        })
        .select("id")
        .single();
      if (unitRow?.id) {
        await supabase.from("products").update({ base_unit_id: unitRow.id }).eq("id", created.id);
      }

      toast.success("Product added");
      onCreated(created);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Quick Add Product</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
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
            <Label>Sale Price</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              placeholder="0.00"
            />
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
            <Label>Initial Stock</Label>
            <Input
              type="number"
              min="0"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Product will be added to the cart automatically. You can edit cost & category later in
            the catalog.
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
