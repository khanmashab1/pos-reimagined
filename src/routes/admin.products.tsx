import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, Search, Printer, Camera } from "lucide-react";
import { toast } from "sonner";
import { fmt } from "@/lib/format";
import { BarcodeLabel } from "@/components/BarcodeLabel";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { ProductUnitsEditor, makeBlankUnit, validateUnits } from "@/components/ProductUnitsEditor";
import { StockBreakdownBadge } from "@/components/StockBreakdownBadge";
import { fetchUnitsByProductIds, type ProductUnit, type UnitDraft } from "@/lib/units";

export const Route = createFileRoute("/admin/products")({
  component: ProductsPage,
});

interface Product {
  id: string;
  barcode: string;
  name: string;
  category_id: string | null;
  purchase_price: number;
  sale_price: number;
  stock: number;
  min_stock_alert: number;
  is_active: boolean;
}
interface Cat {
  id: string;
  name: string;
}

const empty: Omit<Product, "id"> = {
  barcode: "",
  name: "",
  category_id: null,
  purchase_price: 0,
  sale_price: 0,
  stock: 0,
  min_stock_alert: 5,
  is_active: true,
};

function genBarcode() {
  return "ZIC" + Date.now().toString().slice(-9) + Math.floor(Math.random() * 10);
}

const PAGE_SIZE = 50;

const StockBadge = ({ stock, minStockAlert }: { stock: number; minStockAlert: number }) => {
  if (stock === 0) return <Badge variant="destructive">Out</Badge>;
  if (stock <= minStockAlert)
    return <Badge className="bg-warning text-warning-foreground">Low ({stock})</Badge>;
  return <Badge className="bg-success text-success-foreground">{stock}</Badge>;
};

const ProductRow = memo(
  ({
    p,
    cats,
    units,
    onOpenEdit,
    onSetPrinting,
    onRemove,
  }: {
    p: Product;
    cats: Cat[];
    units: ProductUnit[];
    onOpenEdit: (p: Product) => void;
    onSetPrinting: (p: Product) => void;
    onRemove: (id: string) => void;
  }) => {
    const catName = useMemo(
      () => cats.find((c) => c.id === p.category_id)?.name ?? "—",
      [cats, p.category_id],
    );
    const baseName = units.find((u) => u.is_base)?.name ?? "Piece";
    return (
      <tr className="hover:bg-muted/30">
        <td className="px-4 py-3">
          <div className="font-medium">{p.name}</div>
          <div className="text-xs text-muted-foreground">{catName}</div>
        </td>
        <td className="px-4 py-3 font-mono text-xs">{p.barcode}</td>
        <td className="px-4 py-3 text-right">{fmt(p.purchase_price)}</td>
        <td className="px-4 py-3 text-right font-semibold">{fmt(p.sale_price)}</td>
        <td className="px-4 py-3 text-center">
          <div className="flex flex-col items-center gap-1">
            <StockBadge stock={p.stock} minStockAlert={p.min_stock_alert} />
            <span className="text-[10px] text-muted-foreground">{p.stock} {baseName}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <StockBreakdownBadge stock={p.stock} units={units} />
        </td>
        <td className="px-4 py-3 text-right">
          <div className="inline-flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onSetPrinting(p)}
              title="Print barcode"
            >
              <Printer className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => onOpenEdit(p)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-destructive"
              onClick={() => onRemove(p.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </td>
      </tr>
    );
  },
);

function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [unitsByProduct, setUnitsByProduct] = useState<Record<string, ProductUnit[]>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<Omit<Product, "id">>(empty);
  const [units, setUnits] = useState<UnitDraft[]>([]);
  const [initialStockUnitIdx, setInitialStockUnitIdx] = useState<number>(0);
  const [initialStockQty, setInitialStockQty] = useState<string>("");
  const [printing, setPrinting] = useState<Product | null>(null);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingItems, setLoadingItems] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [searchScannerOpen, setSearchScannerOpen] = useState(false);

  const load = useCallback(
    async (currentPage = page, currentSearch = search, currentFilter = filter) => {
      setLoadingItems(true);
      let query = supabase
        .from("products")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE - 1);

      if (currentFilter !== "all") query = query.eq("category_id", currentFilter);
      if (currentSearch) {
        query = query.or(`name.ilike.%${currentSearch}%,barcode.ilike.%${currentSearch}%`);
      }

      const [{ data: p, count }, { data: c }] = await Promise.all([
        query,
        supabase.from("categories").select("id,name").order("name"),
      ]);
      const rows = (p ?? []) as Product[];
      setItems(rows);
      setTotalCount(count ?? 0);
      setCats((c ?? []) as Cat[]);
      const map = await fetchUnitsByProductIds(rows.map((r) => r.id));
      setUnitsByProduct(map);
      setLoadingItems(false);
    },
    [page, search, filter],
  );

  useEffect(() => {
    load(0, search, filter);
    setPage(0);
  }, [search, filter, load]);
  useEffect(() => {
    load(page, search, filter);
  }, [page, load]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const filtered = items;

  const openNew = useCallback(() => {
    setForm({ ...empty, barcode: genBarcode() });
    setEditing(null);
    setUnits([{ name: "Piece", equals_base: 1, is_base: true, is_default_sale: true, sku: "", barcode: "", purchase_price: 0, sale_price: 0, sort_order: 0 }]);
    setInitialStockQty("");
    setInitialStockUnitIdx(0);
    setOpen(true);
  }, []);
  const openEdit = useCallback(async (p: Product) => {
    setForm({ ...p });
    setEditing(p);
    setInitialStockQty("");
    setInitialStockUnitIdx(0);
    const map = await fetchUnitsByProductIds([p.id]);
    const existing = map[p.id] ?? [];
    if (existing.length === 0) {
      setUnits([{ name: "Piece", equals_base: 1, is_base: true, is_default_sale: true, sku: "", barcode: "", purchase_price: p.purchase_price, sale_price: p.sale_price, sort_order: 0 }]);
    } else {
      setUnits(
        existing
          .sort((a, b) => b.equals_base - a.equals_base)
          .map((u) => ({
            id: u.id,
            name: u.name,
            equals_base: u.equals_base,
            is_base: u.is_base,
            is_default_sale: u.is_default_sale,
            sku: u.sku ?? "",
            barcode: u.barcode ?? "",
            purchase_price: Number(u.purchase_price),
            sale_price: Number(u.sale_price),
            sort_order: u.sort_order,
          })),
      );
    }
    setOpen(true);
  }, []);
  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Delete this product?")) return;
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) return toast.error(error.message);
      toast.success("Deleted");
      load(page, search, filter);
    },
    [load, page, search, filter],
  );

  const save = useCallback(async () => {
    if (!form.name.trim() || !form.barcode.trim())
      return toast.error("Name and barcode are required");
    const err = validateUnits(units);
    if (err) return toast.error(err);

    // Mirror base unit prices onto the product row for backward compat
    const baseUnit = units.find((u) => u.is_base)!;
    const productPayload = {
      id: editing?.id,
      name: form.name.trim(),
      barcode: form.barcode.trim(),
      category_id: form.category_id,
      purchase_price: Number(baseUnit.purchase_price),
      sale_price: Number(baseUnit.sale_price),
      min_stock_alert: Number(form.min_stock_alert),
      is_active: form.is_active,
    };

    const unitsPayload = units.map((u, idx) => ({
      id: u.id,
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

    const initialStock =
      !editing && Number(initialStockQty) > 0 && units[initialStockUnitIdx]
        ? { unit_id: units[initialStockUnitIdx].id ?? null, qty: Number(initialStockQty) }
        : null;
    // For new products the unit IDs aren't known yet; pass index as "_initial_unit_index" workaround:
    // we'll do an extra call after save if needed.

    const { data, error } = await supabase.rpc("save_product_with_units", {
      _product: productPayload,
      _units: unitsPayload,
      _initial_stock: initialStock && initialStock.unit_id ? initialStock : null,
    });
    if (error) return toast.error(error.message);

    // If creating new product with initial stock, do a second call now that we have unit IDs
    if (!editing && Number(initialStockQty) > 0) {
      const pid = data as unknown as string;
      const map = await fetchUnitsByProductIds([pid]);
      const created = map[pid] ?? [];
      const target = created.sort((a, b) => b.equals_base - a.equals_base)[initialStockUnitIdx];
      if (target) {
        const { error: stkErr } = await supabase.rpc("add_stock_entry_v2", {
          _product_id: pid,
          _unit_id: target.id,
          _qty: Number(initialStockQty),
          _notes: "Initial stock",
        });
        if (stkErr) toast.error(stkErr.message);
      }
    }

    toast.success(editing ? "Product updated" : "Product added");
    setOpen(false);
    load(page, search, filter);
  }, [form, units, editing, initialStockQty, initialStockUnitIdx, load, page, search, filter]);

  const baseUnitForm = units.find((u) => u.is_base);
  const totalInitialBase = useMemo(() => {
    const n = Number(initialStockQty);
    const u = units[initialStockUnitIdx];
    if (!n || !u) return 0;
    return n * u.equals_base;
  }, [initialStockQty, initialStockUnitIdx, units]);


  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Products</h1>
          <p className="text-muted-foreground">{totalCount.toLocaleString()} items in catalog</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" /> Add Product
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by name or barcode"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setSearchScannerOpen(true)}
              title="Scan barcode to search"
            >
              <Camera className="h-4 w-4" />
            </Button>
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {cats.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Product</th>
                <th className="text-left px-4 py-3">Barcode</th>
                <th className="text-right px-4 py-3">Cost</th>
                <th className="text-right px-4 py-3">Price</th>
                <th className="text-center px-4 py-3">Stock</th>
                <th className="text-left px-4 py-3">In Larger Units</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loadingItems && (
                <tr>
                  <td colSpan={7} className="text-center text-muted-foreground py-10">
                    Loading...
                  </td>
                </tr>
              )}
              {!loadingItems && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-muted-foreground py-10">
                    No products found.
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <ProductRow
                  key={p.id}
                  p={p}
                  cats={cats}
                  units={unitsByProduct[p.id] ?? []}
                  onOpenEdit={openEdit}
                  onSetPrinting={setPrinting}
                  onRemove={remove}
                />
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages} &mdash; {totalCount.toLocaleString()} total
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-center text-xl">{editing ? "Edit" : "Add"} Product</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Product Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Barcode (Base Unit)</Label>
                <div className="flex gap-2">
                  <Input
                    className="flex-1 font-mono"
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  />
                  <Button type="button" variant="outline" onClick={() => setForm((f) => ({ ...f, barcode: genBarcode() }))}>
                    Gen
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => setScannerOpen(true)}>
                    <Camera className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-start">
              <div>
                <Label>Category</Label>
                <Select
                  value={form.category_id ?? "none"}
                  onValueChange={(v) => setForm((f) => ({ ...f, category_id: v === "none" ? null : v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Low Stock Alert (Base Unit)</Label>
                <Input
                  type="number"
                  value={form.min_stock_alert}
                  onChange={(e) => setForm((f) => ({ ...f, min_stock_alert: +e.target.value }))}
                />
              </div>
              <div className="rounded-lg border bg-green-50 dark:bg-green-950/30 p-3 min-w-[180px]">
                <div className="text-xs font-semibold flex items-center gap-2">
                  Base Unit
                  <span className="px-1.5 py-0.5 rounded bg-green-600 text-white text-[10px]">
                    {baseUnitForm?.name || "—"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  All inventory is stored in base unit ({baseUnitForm?.name || "—"}).
                </div>
              </div>
            </div>

            <ProductUnitsEditor units={units} onChange={setUnits} />

            {!editing && units.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-lg border p-4">
                  <div className="font-semibold text-sm">Initial Stock <span className="text-xs text-muted-foreground font-normal">(any unit)</span></div>
                  <div className="flex gap-2 mt-2">
                    <Select
                      value={String(initialStockUnitIdx)}
                      onValueChange={(v) => setInitialStockUnitIdx(Number(v))}
                    >
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {units.map((u, i) => (
                          <SelectItem key={i} value={String(i)}>{u.name || `Unit ${i + 1}`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min={0}
                      value={initialStockQty}
                      onChange={(e) => setInitialStockQty(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="mt-3 rounded-md bg-green-50 dark:bg-green-950/30 p-2 text-center">
                    <div className="text-xs text-muted-foreground">Total ({baseUnitForm?.name || "Base"})</div>
                    <div className="text-lg font-bold text-green-600">{totalInitialBase}</div>
                  </div>
                </div>
                <div className="rounded-lg border p-4 col-span-1 md:col-span-2">
                  <div className="font-semibold text-sm">Example Conversions</div>
                  <div className="mt-2 space-y-1 text-sm">
                    {units.map((u, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="font-medium">1 {u.name || "—"}</span>
                        <span>=</span>
                        <span>{u.equals_base} {baseUnitForm?.name || "Base"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 p-3 text-xs space-y-1">
              <div className="font-semibold flex items-center gap-1">💡 Validation Rules</div>
              <ul className="ml-4 list-disc text-muted-foreground space-y-0.5">
                <li>Stock is always stored in the base unit.</li>
                <li>Unit names must be unique per product.</li>
                <li>Conversion value must be greater than 0.</li>
                <li>Purchase and sale prices cannot be negative.</li>
                <li>Exactly one unit must be marked as base.</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save Product</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {printing && <BarcodeLabel product={printing} onClose={() => setPrinting(null)} />}
      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(code) => {
          setForm((f) => ({ ...f, barcode: code }));
          setScannerOpen(false);
        }}
      />
      <BarcodeScanner
        open={searchScannerOpen}
        onClose={() => setSearchScannerOpen(false)}
        onScan={(code) => {
          setSearch(code);
          setSearchScannerOpen(false);
        }}
      />
    </div>
  );
}
