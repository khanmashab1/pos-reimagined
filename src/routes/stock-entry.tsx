import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  ArrowLeft,
  Plus,
  ScanLine,
  CheckCircle2,
  ClipboardList,
  Package,
  Trash2,
  Clock,
  Tag,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { fetchUnitsByProductIds, pickDefaultUnit, type ProductUnit } from "@/lib/units";

export const Route = createFileRoute("/stock-entry")({
  component: StockEntryPage,
});

interface Product {
  id: string;
  barcode: string;
  name: string;
  stock: number;
  purchase_price: number;
  sale_price: number;
}

interface EntryRow {
  product_id: string;
  product_name: string;
  barcode: string;
  current_stock: number;
  qty: number;
  notes: string;
  unit_id: string | null;
  unit_name: string;
  unit_equals_base: number;
}

interface SubmitSummary {
  entries: EntryRow[];
  submittedAt: string;
  submittedBy: string;
  status: string; // pending | approved | rejected
}

function StockEntryPage() {
  const { loading, user, role, fullName } = useAuth();
  const navigate = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [showDrop, setShowDrop] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedUnits, setSelectedUnits] = useState<ProductUnit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [reqPurchase, setReqPurchase] = useState("");
  const [reqSale, setReqSale] = useState("");
  const [reqReason, setReqReason] = useState("");
  const [submittingReq, setSubmittingReq] = useState(false);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [summary, setSummary] = useState<SubmitSummary | null>(null);

  const scanBuffer = useRef("");
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  const selectedUnit = selectedUnits.find((u) => u.id === selectedUnitId);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  // Debounced server-side product search — avoids loading the entire catalog up front.
  useEffect(() => {
    if (selectedProduct) return;
    const term = search.trim();
    if (!term) { setProducts([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("products")
        .select("id,barcode,name,stock,purchase_price,sale_price")
        .eq("is_active", true)
        .or(`name.ilike.%${term}%,barcode.ilike.%${term}%`)
        .order("name")
        .limit(20);
      setProducts((data ?? []) as Product[]);
    }, 250);
    return () => clearTimeout(t);
  }, [search, selectedProduct]);

  // Global barcode scanner
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "Enter") {
        const code = scanBuffer.current.trim();
        scanBuffer.current = "";
        if (scanTimer.current) clearTimeout(scanTimer.current);
        if (!code) return;
        void (async () => {
          const { data } = await supabase
            .from("products")
            .select("id,barcode,name,stock,purchase_price,sale_price")
            .eq("barcode", code)
            .eq("is_active", true)
            .maybeSingle();
          if (data) { selectProduct(data as Product); return; }
          // Also match a per-unit barcode (Box / Half Box / …) and pre-select that unit.
          const { data: unitRow } = await supabase.from("product_units").select("*").eq("barcode", code).maybeSingle();
          if (unitRow) {
            const { data: prod } = await supabase
              .from("products").select("id,barcode,name,stock,purchase_price,sale_price")
              .eq("id", (unitRow as any).product_id).eq("is_active", true).maybeSingle();
            if (prod) { selectProduct(prod as Product, (unitRow as any).id); return; }
          }
          toast.error(`Barcode not found: ${code}`);
        })();
        return;
      }
      if (e.key.length === 1) {
        scanBuffer.current += e.key;
        if (scanTimer.current) clearTimeout(scanTimer.current);
        scanTimer.current = setTimeout(() => {
          scanBuffer.current = "";
        }, 300);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `products` already holds the server-side search results, so just cap the dropdown length.
  const filtered = search.trim() && !selectedProduct ? products.slice(0, 10) : [];

  const selectProduct = async (p: Product, preselectUnitId?: string) => {
    setSelectedProduct(p);
    setSearch(p.name);
    setShowDrop(false);
    setQty("");
    setNotes("");
    const map = await fetchUnitsByProductIds([p.id]);
    const units = map[p.id] ?? [];
    setSelectedUnits(units);
    const def = (preselectUnitId ? units.find((u) => u.id === preselectUnitId) : undefined) ?? pickDefaultUnit(units);
    setSelectedUnitId(def?.id ?? null);
    setTimeout(() => qtyRef.current?.focus(), 50);
  };

  const openPriceRequest = () => {
    if (!selectedProduct) return toast.error("Select a product first");
    setReqPurchase(String(selectedProduct.purchase_price ?? 0));
    setReqSale(String(selectedProduct.sale_price ?? 0));
    setReqReason("");
    setPriceDialogOpen(true);
  };

  const submitPriceRequest = async () => {
    if (!selectedProduct) return;
    const cost = Number(reqPurchase);
    const sale = Number(reqSale);
    if (reqPurchase === "" || Number.isNaN(cost) || cost < 0) return toast.error("Enter a valid cost price");
    if (reqSale === "" || Number.isNaN(sale) || sale < 0) return toast.error("Enter a valid sale price");
    if (cost === Number(selectedProduct.purchase_price) && sale === Number(selectedProduct.sale_price)) {
      return toast.error("New prices are the same as current");
    }
    setSubmittingReq(true);
    try {
      const { data: reqId, error } = await supabase.rpc("request_price_change", {
        _product_id: selectedProduct.id,
        _requested_purchase: cost,
        _requested_sale: sale,
        _reason: reqReason || undefined,
      });
      if (error) return toast.error(error.message);
      // Admins auto-approve their own price changes — no approval workflow.
      if (role === "admin" && reqId) {
        const { error: apErr } = await supabase.rpc("approve_price_change", {
          _request_id: reqId as string,
          _notes: undefined,
        });
        if (apErr) return toast.error(apErr.message);
        toast.success("Prices updated");
        setSelectedProduct({ ...selectedProduct, purchase_price: cost, sale_price: sale });
      } else {
        toast.success("Price change request sent to admin");
      }
      setPriceDialogOpen(false);
    } finally {
      setSubmittingReq(false);
    }
  };

  const addEntry = () => {
    if (!selectedProduct) return toast.error("Select a product first");
    const qtyNum = Number(qty);
    if (!qty || qtyNum <= 0) return toast.error("Enter a valid quantity");
    const unit = selectedUnits.find((u) => u.id === selectedUnitId);
    const unitName = unit?.name ?? "Piece";
    const unitEquals = unit?.equals_base ?? 1;
    const pieces = qtyNum * unitEquals;

    const matchKey = (e: EntryRow) =>
      e.product_id === selectedProduct.id && e.unit_id === (unit?.id ?? null);
    const existing = entries.findIndex(matchKey);
    if (existing >= 0) {
      setEntries((prev) =>
        prev.map((e, i) =>
          i === existing ? { ...e, qty: e.qty + qtyNum, notes: notes || e.notes } : e,
        ),
      );
      toast.success(`Updated ${selectedProduct.name}: +${qtyNum} ${unitName} (${pieces} pieces)`);
    } else {
      setEntries((prev) => [
        ...prev,
        {
          product_id: selectedProduct.id,
          product_name: selectedProduct.name,
          barcode: selectedProduct.barcode,
          current_stock: selectedProduct.stock,
          qty: qtyNum,
          notes,
          unit_id: unit?.id ?? null,
          unit_name: unitName,
          unit_equals_base: unitEquals,
        },
      ]);
      toast.success(`Adding ${qtyNum} ${unitName} = ${pieces} pieces to ${selectedProduct.name}`);
    }
    setSelectedProduct(null);
    setSelectedUnits([]);
    setSelectedUnitId(null);
    setSearch("");
    setQty("");
    setNotes("");
  };

  const removeEntry = (idx: number) => setEntries((e) => e.filter((_, i) => i !== idx));

  const submitEntries = async () => {
    if (entries.length === 0) return toast.error("No entries to submit");
    setProcessing(true);
    try {
      const results = await Promise.all(
        entries.map((e) =>
          supabase.rpc("add_stock_entry_v2", {
            _product_id: e.product_id,
            _unit_id: e.unit_id as string,
            _qty: e.qty,
            _notes: e.notes || undefined,
          }),
        ),
      );
      const errors = results.filter((r) => r.error);
      if (errors.length > 0) return toast.error(errors[0]!.error!.message);

      // Admins bypass the approval workflow — auto-approve immediately.
      const isAdmin = role === "admin";
      if (isAdmin) {
        const ids = results.map((r) => r.data as string).filter(Boolean);
        const approveResults = await Promise.all(
          ids.map((id) => supabase.rpc("approve_stock_entry", { _entry_id: id })),
        );
        const apErrs = approveResults.filter((r) => r.error);
        if (apErrs.length > 0) return toast.error(apErrs[0]!.error!.message);
      }

      toast.success(
        isAdmin
          ? `${entries.length} entr${entries.length === 1 ? "y" : "ies"} added to stock`
          : `${entries.length} entr${entries.length === 1 ? "y" : "ies"} submitted for admin approval`,
      );
      setSummary({
        entries: [...entries],
        submittedAt: new Date().toISOString(),
        submittedBy: fullName ?? "",
        status: isAdmin ? "approved" : "pending",
      });
      setEntries([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setProcessing(false);
    }
  };

  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );

  // ── SUMMARY SCREEN ───────────────────────────────────────────────────
  if (summary) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <header className="border-b bg-card p-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSummary(null)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              {summary.status === "approved" ? (
                <><CheckCircle2 className="h-5 w-5 text-green-500" /> Stock Added</>
              ) : (
                <><Clock className="h-5 w-5 text-amber-500" /> Pending Approval</>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              {summary.submittedBy} · {new Date(summary.submittedAt).toLocaleString()}
            </p>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 max-w-3xl mx-auto w-full space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4 border-l-4 border-l-amber-500">
              <div className="text-xs text-muted-foreground">Products Submitted</div>
              <div className="text-3xl font-bold">{summary.entries.length}</div>
            </Card>
            <Card className="p-4 border-l-4 border-l-blue-500">
              <div className="text-xs text-muted-foreground">Total Units Pending</div>
              <div className="text-3xl font-bold text-blue-600">
                {summary.entries.reduce((s, e) => s + e.qty, 0)}
              </div>
            </Card>
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3">Product</th>
                    <th className="text-left px-4 py-3">Barcode</th>
                    <th className="text-right px-4 py-3">Units</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {summary.entries.map((e, i) => (
                    <tr key={i} className="hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">{e.product_name}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{e.barcode}</td>
                      <td className="px-4 py-3 text-right font-bold text-green-600">+{e.qty} {e.unit_name}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                          Pending
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{e.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {role === "admin" && (
            <Card className="p-4 border-l-4 border-l-purple-500 flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">Full Stock Entry History</div>
                <div className="text-xs text-muted-foreground">
                  View all entries from all cashiers
                </div>
              </div>
              <Button asChild size="sm">
                <Link to="/admin/stock-summary">
                  <ClipboardList className="h-4 w-4 mr-2" /> View
                </Link>
              </Button>
            </Card>
          )}
          <div className="grid grid-cols-2 gap-3 pb-4">
            <Button
              variant="outline"
              onClick={() => setSummary(null)}
            >
              <Plus className="h-4 w-4 mr-2" /> New Entry
            </Button>
            <Button asChild>
              <Link to="/pos">
                <ArrowLeft className="h-4 w-4 mr-2" /> Back to POS
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── MAIN FORM ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="border-b bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon">
              <Link to="/pos">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Package className="h-5 w-5" /> Stock Entry
              </h1>
              <p className="text-xs text-muted-foreground">{fullName}</p>
            </div>
          </div>
          {role === "admin" && (
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/stock-summary">
                <ClipboardList className="h-4 w-4 mr-2" /> History
              </Link>
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 max-w-2xl mx-auto w-full space-y-6">
        {/* Add stock form — styled like admin Add Product */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Add Stock</h2>
          <div className="grid grid-cols-2 gap-4">
            {/* Product search — full width */}
            <div className="col-span-2 relative">
              <Label>Product</Label>
              <div className="relative mt-1">
                <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by name or scan barcode..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSelectedProduct(null);
                    setShowDrop(true);
                  }}
                  onFocus={() => setShowDrop(true)}
                  onBlur={() => setTimeout(() => setShowDrop(false), 150)}
                />
                {showDrop && filtered.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg z-20 max-h-52 overflow-auto">
                    {filtered.map((p) => (
                      <button
                        key={p.id}
                        onMouseDown={() => selectProduct(p)}
                        className="w-full text-left px-4 py-2.5 hover:bg-muted transition-colors border-b last:border-0"
                      >
                        <div className="font-medium text-sm">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Stock: {p.stock} · {p.barcode}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedProduct && (
                <div className="mt-2 text-xs text-muted-foreground px-1">
                  Current stock:{" "}
                  <span className="font-semibold text-foreground">{selectedProduct.stock}</span>
                  &nbsp;·&nbsp;{selectedProduct.barcode}
                </div>
              )}
            </div>

            {/* Unit */}
            <div>
              <Label>Unit</Label>
              <Select
                value={selectedUnitId ?? ""}
                onValueChange={(v) => setSelectedUnitId(v)}
                disabled={!selectedProduct || selectedUnits.length === 0}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue
                    placeholder={selectedProduct ? "Select unit" : "Pick a product first"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {selectedUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} (= {u.equals_base} base)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Qty */}
            <div>
              <Label>Quantity to Add</Label>
              <Input
                ref={qtyRef}
                type="number"
                min="1"
                placeholder="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addEntry()}
                className="mt-1"
              />
              {selectedUnit && Number(qty) > 0 && selectedUnit.equals_base > 1 && (
                <div className="text-xs text-muted-foreground mt-1">
                  = {Number(qty) * selectedUnit.equals_base} base units
                </div>
              )}
            </div>

            {/* Prices (read-only, request change from admin) */}
            <div className="col-span-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Prices
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!selectedProduct}
                  onClick={openPriceRequest}
                >
                  <Tag className="h-3.5 w-3.5 mr-1.5" /> Request Price Change
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Cost Price</div>
                  <div className="font-semibold">
                    {selectedProduct ? Number(selectedProduct.purchase_price ?? 0).toFixed(2) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Sale Price</div>
                  <div className="font-semibold">
                    {selectedProduct ? Number(selectedProduct.sale_price ?? 0).toFixed(2) : "—"}
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Price changes require admin approval.
              </p>
            </div>


            {/* Notes */}
            <div className="col-span-2">
              <Label>
                Notes <span className="text-muted-foreground font-normal text-xs">(optional)</span>
              </Label>
              <Input
                placeholder="e.g. New batch, Supplier..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addEntry()}
                className="mt-1"
              />
            </div>

            {/* Add button — full width */}
            <div className="col-span-2">
              <Button onClick={() => void addEntry()} className="w-full">
                <Plus className="h-4 w-4 mr-2" /> Add to List
              </Button>
            </div>

          </div>
          <p className="text-xs text-muted-foreground mt-3">
            💡 Physical barcode scanner works anywhere on this page
          </p>
        </Card>

        {/* Entries table */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between bg-muted/30">
            <span className="font-semibold text-sm">
              Entries {entries.length > 0 && `(${entries.length})`}
            </span>
            {entries.length > 0 && (
              <span className="text-xs text-muted-foreground">
                +{entries.reduce((s, e) => s + e.qty, 0)} total units
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">Product</th>
                  <th className="text-right px-4 py-3">Current Stock</th>
                  <th className="text-right px-4 py-3">Adding</th>
                  <th className="text-left px-4 py-3">Notes</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-muted-foreground py-12">
                      No entries yet. Fill the form above and click Add to List.
                    </td>
                  </tr>
                ) : (
                  entries.map((e, idx) => (
                    <tr key={idx} className="hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">{e.product_name}</td>
                      <td className="px-4 py-3 text-right">{e.current_stock}</td>
                      <td className="px-4 py-3 text-right font-bold text-green-600">
                        +{e.qty} {e.unit_name}
                        {e.unit_equals_base > 1 && (
                          <div className="text-[10px] font-normal text-muted-foreground">
                            (= {e.qty * e.unit_equals_base} base)
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{e.notes || "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => removeEntry(idx)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {entries.length > 0 && (
          <Button onClick={submitEntries} disabled={processing} className="w-full" size="lg">
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" /> Submit {entries.length} Entr
                {entries.length === 1 ? "y" : "ies"}
              </>
            )}
          </Button>
        )}
      </div>

      <Dialog open={priceDialogOpen} onOpenChange={setPriceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Price Change</DialogTitle>
          </DialogHeader>
          {selectedProduct && (
            <div className="space-y-4">
              <div className="text-sm">
                <div className="font-medium">{selectedProduct.name}</div>
                <div className="text-xs text-muted-foreground">
                  Current: Cost {Number(selectedProduct.purchase_price ?? 0).toFixed(2)} · Sale{" "}
                  {Number(selectedProduct.sale_price ?? 0).toFixed(2)}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>New Cost Price</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={reqPurchase}
                    onChange={(e) => setReqPurchase(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>New Sale Price</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={reqSale}
                    onChange={(e) => setReqSale(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label>
                  Reason <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                </Label>
                <Textarea
                  placeholder="Why this change?"
                  value={reqReason}
                  onChange={(e) => setReqReason(e.target.value)}
                  className="mt-1"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceDialogOpen(false)} disabled={submittingReq}>
              Cancel
            </Button>
            <Button onClick={submitPriceRequest} disabled={submittingReq}>
              {submittingReq ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...
                </>
              ) : (
                "Send Request"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
