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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Plus,
  Trash2,
  Pencil,
  Search,
  Printer,
  Camera,
  Box,
  Info,
  ArrowRight,
  ShoppingCart,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { fmt } from "@/lib/format";
import { BarcodeLabel } from "@/components/BarcodeLabel";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { ProductUnitsEditor, makeBlankUnit, validateUnits } from "@/components/ProductUnitsEditor";
import { StockBreakdownBadge } from "@/components/StockBreakdownBadge";
import {
  fetchUnitsByProductIds,
  greedyBreakdown,
  pluralize,
  unitColor,
  type ProductUnit,
  type UnitDraft,
} from "@/lib/units";

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
    catName,
    units,
    onOpenEdit,
    onSetPrinting,
    onRemove,
  }: {
    p: Product;
    catName: string;
    units: ProductUnit[];
    onOpenEdit: (p: Product) => void;
    onSetPrinting: (p: Product) => void;
    onRemove: (id: string) => void;
  }) => {
    const baseName = units.find((u) => u.is_base)?.name ?? "Piece";
    return (
      <tr className="hover:bg-muted/30">
        <td className="px-4 py-3">
          <div className="font-medium">{p.name}</div>
          <div className="text-xs text-muted-foreground">{catName}</div>
        </td>
        <td className="px-4 py-3 font-mono text-xs">{p.barcode}</td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {baseName}
          </span>
        </td>
        <td className="px-4 py-3 text-right">{fmt(p.purchase_price)}</td>
        <td className="px-4 py-3 text-right font-semibold">{fmt(p.sale_price)}</td>
        <td className="px-4 py-3 text-center">
          <div className="flex flex-col items-center gap-1">
            <StockBadge stock={p.stock} minStockAlert={p.min_stock_alert} />
            <span className="text-[10px] text-muted-foreground">
              {p.stock} {baseName}
            </span>
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

/** Colourful unit breakdown chips used in the Stock Summary & live preview. */
function UnitChips({
  base,
  units,
  size = "md",
}: {
  base: number;
  units: { id: string; name: string; equals_base: number }[];
  size?: "sm" | "md";
}) {
  if (units.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
  const rows = greedyBreakdown(base, units).filter((r) => r.count > 0);
  if (rows.length === 0) return <span className="text-sm text-muted-foreground">Empty</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((r) => {
        const c = unitColor(Number(r.id) || 0);
        return (
          <div
            key={r.id}
            className={`inline-flex items-center gap-2 rounded-lg border ${c.ring} ${c.chipBg} ${size === "sm" ? "px-2 py-1" : "px-2.5 py-1.5"}`}
          >
            <Box className={`${size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} ${c.icon}`} />
            <span className={`font-bold ${size === "sm" ? "text-xs" : "text-sm"}`}>{r.count}</span>
            <span className={`text-xs ${c.chipText}`}>{pluralize(r.name, r.count)}</span>
          </div>
        );
      })}
    </div>
  );
}

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
  const [editStockCounts, setEditStockCounts] = useState<Record<string, string>>({});
  const [editStockReason, setEditStockReason] = useState<string>("");
  const [previewUnitIdx, setPreviewUnitIdx] = useState<number>(0);
  const [previewQty, setPreviewQty] = useState<string>("1");
  const [printing, setPrinting] = useState<Product | null>(null);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingItems, setLoadingItems] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [searchScannerOpen, setSearchScannerOpen] = useState(false);

  const load = useCallback(
    async (currentPage: number, currentSearch: string, currentFilter: string) => {
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
    [],
  );

  // Reset to the first page when the query changes, then load exactly once per page/search/filter change.
  useEffect(() => { setPage(0); }, [search, filter]);
  useEffect(() => { load(page, search, filter); }, [page, search, filter, load]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const filtered = items;
  // O(1) category-name lookup built once per category change, instead of a .find() per row.
  const catMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cats) m.set(c.id, c.name);
    return m;
  }, [cats]);

  const openNew = useCallback(() => {
    setForm({ ...empty, barcode: genBarcode() });
    setEditing(null);
    setUnits([
      {
        name: "Piece",
        equals_base: 1,
        is_base: true,
        is_default_sale: true,
        sku: "",
        barcode: "",
        purchase_price: 0,
        sale_price: 0,
        sort_order: 0,
      },
    ]);
    setInitialStockQty("");
    setInitialStockUnitIdx(0);
    setEditStockCounts({});
    setEditStockReason("");
    setPreviewUnitIdx(0);
    setPreviewQty("1");
    setOpen(true);
  }, []);
  const openEdit = useCallback(async (p: Product) => {
    setForm({ ...p });
    setEditing(p);
    setInitialStockQty("");
    setInitialStockUnitIdx(0);
    setEditStockReason("");
    setPreviewUnitIdx(0);
    setPreviewQty("1");
    const map = await fetchUnitsByProductIds([p.id]);
    const existing = map[p.id] ?? [];
    if (existing.length === 0) {
      setUnits([
        {
          name: "Piece",
          equals_base: 1,
          is_base: true,
          is_default_sale: true,
          sku: "",
          barcode: "",
          purchase_price: p.purchase_price,
          sale_price: p.sale_price,
          sort_order: 0,
        },
      ]);
      setEditStockCounts({ "0": String(p.stock) });
    } else {
      const sorted = existing
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
        }));
      setUnits(sorted);
      const di = sorted.findIndex((u) => u.is_default_sale);
      setPreviewUnitIdx(di >= 0 ? di : 0);
      // Pre-fill breakdown from current stock (greedy largest→smallest).
      const breakdown = greedyBreakdown(
        p.stock,
        sorted.map((u, i) => ({ id: String(i), name: u.name, equals_base: u.equals_base })),
      );
      const seed: Record<string, string> = {};
      breakdown.forEach((b) => {
        seed[b.id] = String(b.count);
      });
      setEditStockCounts(seed);
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

    // If editing and admin changed unit breakdown counts, apply a stock adjustment with reason.
    if (editing) {
      const newBase = units.reduce((sum, u, i) => {
        const c = Number(editStockCounts[String(i)] ?? 0) || 0;
        return sum + c * u.equals_base;
      }, 0);
      const delta = newBase - Number(editing.stock);
      if (delta !== 0) {
        if (!editStockReason.trim()) {
          toast.error("Please enter a reason for the stock change");
          return;
        }
        const baseRow = units.find((u) => u.is_base);
        const baseUnitId = baseRow?.id ?? null;
        const baseUnitName = baseRow?.name ?? "Unit";
        const { error: upErr } = await supabase
          .from("products")
          .update({ stock: newBase })
          .eq("id", editing.id);
        if (upErr) toast.error(upErr.message);
        else {
          const { data: ures } = await supabase.auth.getUser();
          const uid = ures.user?.id ?? null;
          const uname =
            (ures.user?.user_metadata?.full_name as string) ?? ures.user?.email ?? "admin";
          await supabase.from("inventory_movements").insert({
            product_id: editing.id,
            unit_id: baseUnitId,
            unit_name: baseUnitName,
            qty_in_unit: delta,
            qty_in_base: delta,
            kind: "adjustment",
            user_id: uid,
            user_name: uname,
            notes: `Admin edit (${delta > 0 ? "+" : ""}${delta}): ${editStockReason.trim()}`,
          });
        }
      }
    }

    toast.success(editing ? "Product updated" : "Product added");
    setOpen(false);
    load(page, search, filter);
  }, [
    form,
    units,
    editing,
    initialStockQty,
    initialStockUnitIdx,
    editStockCounts,
    editStockReason,
    load,
    page,
    search,
    filter,
  ]);

  const baseUnitForm = units.find((u) => u.is_base);
  const baseName = baseUnitForm?.name?.trim() || "Piece";

  const setBaseUnit = useCallback((patch: Partial<UnitDraft>) => {
    setUnits((us) => us.map((u) => (u.is_base ? { ...u, ...patch } : u)));
  }, []);

  const totalInitialBase = useMemo(() => {
    const n = Number(initialStockQty);
    const u = units[initialStockUnitIdx];
    if (!n || !u) return 0;
    return n * u.equals_base;
  }, [initialStockQty, initialStockUnitIdx, units]);

  // Units shaped for greedy breakdown — id encodes the editor row index so colours stay in sync.
  const draftUnits = useMemo(
    () =>
      units.map((u, i) => ({
        id: String(i),
        name: u.name.trim() || `Unit ${i + 1}`,
        equals_base: u.equals_base,
      })),
    [units],
  );

  // Edit-stock: per-unit counts × conversion = new total base stock.
  const editedBase = useMemo(() => {
    if (!editing) return 0;
    return units.reduce((sum, u, i) => {
      const c = Number(editStockCounts[String(i)] ?? 0) || 0;
      return sum + c * u.equals_base;
    }, 0);
  }, [editing, units, editStockCounts]);
  const editDelta = editing ? editedBase - Number(editing.stock) : 0;

  // Stock we expect after saving: edited breakdown when editing, otherwise the initial-stock entry.
  const projectedBase = editing ? editedBase : totalInitialBase;
  const stockError = projectedBase < 0;

  // Live "if you sell …" preview.
  const previewUnit = units[previewUnitIdx] ?? baseUnitForm;
  const previewSellBase = Math.max(0, Number(previewQty) || 0) * (previewUnit?.equals_base ?? 1);
  const remainingBase = Math.max(0, projectedBase - previewSellBase);
  const wouldGoNegative = projectedBase > 0 && previewSellBase > projectedBase;

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
                <th className="text-left px-4 py-3">Base Unit</th>
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
                  <td colSpan={8} className="text-center text-muted-foreground py-10">
                    Loading...
                  </td>
                </tr>
              )}
              {!loadingItems && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-muted-foreground py-10">
                    No products found.
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <ProductRow
                  key={p.id}
                  p={p}
                  catName={(p.category_id && catMap.get(p.category_id)) || "—"}
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
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-center text-xl">
              {editing ? "Edit Product" : "Add Product"}
            </DialogTitle>
          </DialogHeader>
          <TooltipProvider delayDuration={150}>
            <div className="space-y-5">
              {/* Name + Barcode */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Product Name</Label>
                  <Input
                    value={form.name}
                    placeholder="e.g. Chocolate Cookies"
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Barcode (Base Unit)</Label>
                  <div className="flex gap-2">
                    <Input
                      className="flex-1 font-mono"
                      value={form.barcode}
                      onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setForm((f) => ({ ...f, barcode: genBarcode() }))}
                    >
                      Gen
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setScannerOpen(true)}
                      title="Scan barcode"
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Category + default prices + base-unit card */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
                <div className="lg:col-span-2 space-y-4">
                  <div className="space-y-1.5">
                    <Label>Category</Label>
                    <Select
                      value={form.category_id ?? "none"}
                      onValueChange={(v) =>
                        setForm((f) => ({ ...f, category_id: v === "none" ? null : v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {cats.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1 text-xs">
                        Default Purchase ({baseName})
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help text-muted-foreground/70">
                              <Info className="h-3 w-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Cost price for one {baseName.toLowerCase()}. Mirrors the base unit row
                            below.
                          </TooltipContent>
                        </Tooltip>
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={baseUnitForm?.purchase_price ?? 0}
                        onChange={(e) =>
                          setBaseUnit({ purchase_price: Math.max(0, Number(e.target.value) || 0) })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1 text-xs">
                        Default Sale ({baseName})
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help text-muted-foreground/70">
                              <Info className="h-3 w-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Selling price for one {baseName.toLowerCase()}. Mirrors the base unit
                            row below.
                          </TooltipContent>
                        </Tooltip>
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={baseUnitForm?.sale_price ?? 0}
                        onChange={(e) =>
                          setBaseUnit({ sale_price: Math.max(0, Number(e.target.value) || 0) })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Low Stock Alert</Label>
                      <Input
                        type="number"
                        min={0}
                        value={form.min_stock_alert}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, min_stock_alert: +e.target.value }))
                        }
                      />
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border bg-primary/5 p-4 flex flex-col justify-center">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <Box className="h-4 w-4 text-primary" /> Base Unit
                    <span className="px-2 py-0.5 rounded-md bg-primary text-primary-foreground text-[11px]">
                      {baseName}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                    All inventory is stored in{" "}
                    <span className="font-medium text-foreground">{pluralize(baseName, 2)}</span>.
                    Sell in any unit you like — the system converts and deducts stock automatically.
                  </p>
                </div>
              </div>

              <ProductUnitsEditor units={units} onChange={setUnits} />

              {/* Stock + summary + conversions */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {!editing ? (
                  <div className="rounded-xl border p-4 space-y-3">
                    <div className="font-semibold text-sm flex items-center gap-2">
                      <Box className="h-4 w-4 text-primary" /> Initial Stock
                      <span className="text-xs text-muted-foreground font-normal">
                        (add in any unit)
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Select
                        value={String(initialStockUnitIdx)}
                        onValueChange={(v) => setInitialStockUnitIdx(Number(v))}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {units.map((u, i) => (
                            <SelectItem key={i} value={String(i)}>
                              {u.name || `Unit ${i + 1}`}
                            </SelectItem>
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
                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-center">
                      <div className="text-xs text-muted-foreground">
                        Total Stock (in {pluralize(baseName, 2)})
                      </div>
                      <div className="text-xl font-bold text-primary">
                        {totalInitialBase} {pluralize(baseName, totalInitialBase)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border p-4 space-y-3">
                    <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                      <Box className="h-4 w-4 text-primary" /> Edit Stock
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        <ShieldCheck className="h-3 w-3" /> Admin
                      </span>
                      <span className="text-xs text-muted-foreground font-normal ml-auto">
                        current: {Number(editing.stock)} {pluralize(baseName, Number(editing.stock))}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {units.map((u, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Label className="w-24 text-xs">{u.name || `Unit ${i + 1}`}</Label>
                          <Input
                            type="number"
                            step="1"
                            className="h-9"
                            value={editStockCounts[String(i)] ?? "0"}
                            onChange={(e) =>
                              setEditStockCounts((s) => ({ ...s, [String(i)]: e.target.value }))
                            }
                          />
                          <span className="text-[11px] text-muted-foreground w-20 text-right">
                            × {u.equals_base}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        Reason {editDelta !== 0 && <span className="text-destructive">*</span>}
                      </Label>
                      <Textarea
                        rows={2}
                        placeholder="e.g. Damaged stock removed, recount adjustment…"
                        value={editStockReason}
                        onChange={(e) => setEditStockReason(e.target.value)}
                      />
                    </div>
                    <div
                      className={`rounded-lg border p-2.5 text-xs ${
                        editDelta === 0
                          ? "bg-muted/40 text-muted-foreground"
                          : editDelta > 0
                            ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300"
                            : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span>New total</span>
                        <span className="font-bold">
                          {editedBase} {pluralize(baseName, editedBase)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span>Change</span>
                        <span className="font-bold">
                          {editDelta > 0 ? "+" : ""}
                          {editDelta}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div
                  className={`rounded-xl border p-4 space-y-3 ${stockError ? "border-destructive bg-destructive/5" : ""}`}
                >
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {stockError ? (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    )}
                    Stock Summary
                    <span className="text-xs text-muted-foreground font-normal">
                      {editing ? "(after save)" : "(after saving)"}
                    </span>
                  </div>
                  {stockError ? (
                    <div className="space-y-2">
                      <div className="rounded-md bg-destructive text-destructive-foreground px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1.5">
                        <ShieldAlert className="h-3.5 w-3.5" /> STOCK ERROR — Run audit
                      </div>
                      <div className="text-sm font-mono text-destructive">
                        {units
                          .map(
                            (u, i) =>
                              `${Number(editStockCounts[String(i)] ?? 0) || 0} ${u.name || "—"}`,
                          )
                          .join(" · ")}
                      </div>
                    </div>
                  ) : (
                    <UnitChips base={projectedBase} units={draftUnits} />
                  )}
                  <div className="flex items-center justify-between border-t pt-2.5 text-sm">
                    <span className="text-muted-foreground">Total</span>
                    <span className={`font-bold ${stockError ? "text-destructive" : ""}`}>
                      {projectedBase} {pluralize(baseName, projectedBase)}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border p-4 space-y-2">
                  <div className="font-semibold text-sm">Example Conversions</div>
                  <div className="space-y-1.5 text-sm">
                    {units.map((u, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="font-medium">1 {u.name || "—"}</span>
                        <span className="text-muted-foreground">
                          = {u.equals_base} {pluralize(baseName, u.equals_base)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Real-time stock preview */}
              <div className="rounded-xl border bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-950/20 dark:to-blue-950/20 p-4">
                <div className="font-semibold text-sm flex items-center gap-2 mb-3">
                  <ShoppingCart className="h-4 w-4 text-violet-600 dark:text-violet-400" />{" "}
                  Real-time Stock Preview
                </div>
                <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      If you sell
                    </span>
                    <Input
                      type="number"
                      min={0}
                      className="w-20 h-9 bg-background"
                      value={previewQty}
                      onChange={(e) => setPreviewQty(e.target.value)}
                    />
                    <Select
                      value={String(previewUnitIdx)}
                      onValueChange={(v) => setPreviewUnitIdx(Number(v))}
                    >
                      <SelectTrigger className="w-32 h-9 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {units.map((u, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {u.name || `Unit ${i + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <ArrowRight className="hidden lg:block h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 flex flex-wrap items-center gap-3">
                    <span className="text-xs text-muted-foreground">Remaining</span>
                    <UnitChips base={remainingBase} units={draftUnits} size="sm" />
                    <div className="ml-auto text-right">
                      <div className="text-[11px] text-muted-foreground">Total</div>
                      <div className="font-bold text-primary">
                        {remainingBase} {pluralize(baseName, remainingBase)}
                      </div>
                    </div>
                  </div>
                </div>
                {wouldGoNegative && (
                  <div className="mt-2.5 text-xs text-destructive flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5" /> Not enough stock — selling this much would go
                    negative.
                  </div>
                )}
                {projectedBase === 0 && !wouldGoNegative && (
                  <div className="mt-2.5 text-xs text-muted-foreground">
                    {editing
                      ? "No stock on hand yet — add stock to preview."
                      : "Add initial stock above to see the live preview."}
                  </div>
                )}
              </div>

              {/* Notes + validation */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-4">
                  <div className="font-semibold text-sm flex items-center gap-2 text-amber-700 dark:text-amber-300 mb-2.5">
                    <Info className="h-4 w-4" /> Important Notes
                  </div>
                  <ul className="space-y-1.5 text-xs text-amber-800/90 dark:text-amber-200/80">
                    {[
                      `Stock is always stored in the base unit (${pluralize(baseName, 2)}).`,
                      "You can sell in any unit you define above.",
                      "Prices can be different for each unit.",
                      "Profit is calculated per unit (sale − purchase).",
                    ].map((t, i) => (
                      <li key={i} className="flex gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {t}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20 p-4">
                  <div className="font-semibold text-sm flex items-center gap-2 text-blue-700 dark:text-blue-300 mb-2.5">
                    <ShieldCheck className="h-4 w-4" /> Validation Rules
                  </div>
                  <ul className="space-y-1.5 text-xs text-blue-800/90 dark:text-blue-200/80">
                    {[
                      "Unit name must be unique.",
                      "Conversion value must be greater than 0.",
                      "Purchase & sale price cannot be negative.",
                      "Exactly one unit is the base unit.",
                    ].map((t, i) => (
                      <li key={i} className="flex gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </TooltipProvider>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} className="min-w-40">
              <CheckCircle2 className="h-4 w-4 mr-1.5" /> Save Product
            </Button>
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
