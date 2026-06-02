import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, Plus, ScanLine, CheckCircle2, ClipboardList, Package, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { fetchUnitsByProductIds, pickDefaultUnit, type ProductUnit } from "@/lib/units";

export const Route = createFileRoute("/stock-entry")({
  component: StockEntryPage,
});

interface Product {
  id: string; barcode: string; name: string; stock: number;
}

interface EntryRow {
  product_id: string; product_name: string; barcode: string;
  current_stock: number; qty: number; notes: string;
  unit_id: string | null; unit_name: string; unit_equals_base: number;
}

interface SubmitSummary {
  entries: EntryRow[]; submittedAt: string; submittedBy: string;
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

  const fetchProducts = useCallback(async () => {
    const { data } = await supabase
      .from("products").select("id,barcode,name,stock")
      .eq("is_active", true).order("name").range(0, 9999);
    setProducts((data ?? []) as Product[]);
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

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
        const prod = products.find(p => p.barcode === code);
        if (prod) { selectProduct(prod); }
        else toast.error(`Barcode not found: ${code}`);
        return;
      }
      if (e.key.length === 1) {
        scanBuffer.current += e.key;
        if (scanTimer.current) clearTimeout(scanTimer.current);
        scanTimer.current = setTimeout(() => { scanBuffer.current = ""; }, 300);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [products]);

  const filtered = search.trim() && !selectedProduct
    ? products.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) || p.barcode.includes(search)
      ).slice(0, 10)
    : [];

  const selectProduct = (p: Product) => {
    setSelectedProduct(p);
    setSearch(p.name);
    setShowDrop(false);
    setQty("");
    setNotes("");
    setTimeout(() => qtyRef.current?.focus(), 50);
  };

  const addEntry = () => {
    if (!selectedProduct) return toast.error("Select a product first");
    const qtyNum = Number(qty);
    if (!qty || qtyNum <= 0) return toast.error("Enter a valid quantity");

    const existing = entries.findIndex(e => e.product_id === selectedProduct.id);
    if (existing >= 0) {
      setEntries(prev => prev.map((e, i) =>
        i === existing ? { ...e, qty: e.qty + qtyNum, notes: notes || e.notes } : e
      ));
      toast.success(`Updated: ${selectedProduct.name}`);
    } else {
      setEntries(prev => [...prev, {
        product_id: selectedProduct.id,
        product_name: selectedProduct.name,
        barcode: selectedProduct.barcode,
        current_stock: selectedProduct.stock,
        qty: qtyNum,
        notes,
      }]);
      toast.success(`Added: ${selectedProduct.name}`);
    }
    setSelectedProduct(null);
    setSearch("");
    setQty("");
    setNotes("");
  };

  const removeEntry = (idx: number) => setEntries(e => e.filter((_, i) => i !== idx));

  const submitEntries = async () => {
    if (entries.length === 0) return toast.error("No entries to submit");
    setProcessing(true);
    try {
      const results = await Promise.all(
        entries.map(e => supabase.rpc("add_stock_entry", {
          _product_id: e.product_id, _qty: e.qty, _notes: e.notes || undefined,
        }))
      );
      const errors = results.filter(r => r.error);
      if (errors.length > 0) return toast.error(errors[0]!.error!.message);
      toast.success(`${entries.length} entr${entries.length === 1 ? "y" : "ies"} submitted!`);
      setSummary({ entries: [...entries], submittedAt: new Date().toISOString(), submittedBy: fullName ?? "" });
      setEntries([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
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
              <CheckCircle2 className="h-5 w-5 text-green-500" /> Submitted
            </h1>
            <p className="text-xs text-muted-foreground">
              {summary.submittedBy} · {new Date(summary.submittedAt).toLocaleString()}
            </p>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 max-w-3xl mx-auto w-full space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4 border-l-4 border-l-green-500">
              <div className="text-xs text-muted-foreground">Products Restocked</div>
              <div className="text-3xl font-bold text-green-600">{summary.entries.length}</div>
            </Card>
            <Card className="p-4 border-l-4 border-l-blue-500">
              <div className="text-xs text-muted-foreground">Total Units Added</div>
              <div className="text-3xl font-bold text-blue-600">{summary.entries.reduce((s, e) => s + e.qty, 0)}</div>
            </Card>
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3">Product</th>
                    <th className="text-left px-4 py-3">Barcode</th>
                    <th className="text-right px-4 py-3">Before</th>
                    <th className="text-right px-4 py-3">Added</th>
                    <th className="text-right px-4 py-3">After</th>
                    <th className="text-left px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {summary.entries.map((e, i) => (
                    <tr key={i} className="hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">{e.product_name}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{e.barcode}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{e.current_stock}</td>
                      <td className="px-4 py-3 text-right font-bold text-green-600">+{e.qty}</td>
                      <td className="px-4 py-3 text-right font-bold">{e.current_stock + e.qty}</td>
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
                <div className="text-xs text-muted-foreground">View all entries from all cashiers</div>
              </div>
              <Button asChild size="sm">
                <Link to="/admin/stock-summary"><ClipboardList className="h-4 w-4 mr-2" /> View</Link>
              </Button>
            </Card>
          )}
          <div className="grid grid-cols-2 gap-3 pb-4">
            <Button variant="outline" onClick={() => { setSummary(null); fetchProducts(); }}>
              <Plus className="h-4 w-4 mr-2" /> New Entry
            </Button>
            <Button asChild>
              <Link to="/pos"><ArrowLeft className="h-4 w-4 mr-2" /> Back to POS</Link>
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
              <Link to="/pos"><ArrowLeft className="h-5 w-5" /></Link>
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
              <Link to="/admin/stock-summary"><ClipboardList className="h-4 w-4 mr-2" /> History</Link>
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
                  onChange={e => {
                    setSearch(e.target.value);
                    setSelectedProduct(null);
                    setShowDrop(true);
                  }}
                  onFocus={() => setShowDrop(true)}
                  onBlur={() => setTimeout(() => setShowDrop(false), 150)}
                />
                {showDrop && filtered.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg z-20 max-h-52 overflow-auto">
                    {filtered.map(p => (
                      <button
                        key={p.id}
                        onMouseDown={() => selectProduct(p)}
                        className="w-full text-left px-4 py-2.5 hover:bg-muted transition-colors border-b last:border-0"
                      >
                        <div className="font-medium text-sm">{p.name}</div>
                        <div className="text-xs text-muted-foreground">Stock: {p.stock} · {p.barcode}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedProduct && (
                <div className="mt-2 text-xs text-muted-foreground px-1">
                  Current stock: <span className="font-semibold text-foreground">{selectedProduct.stock}</span>
                  &nbsp;·&nbsp;{selectedProduct.barcode}
                </div>
              )}
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
                onChange={e => setQty(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addEntry()}
                className="mt-1"
              />
            </div>

            {/* Notes */}
            <div>
              <Label>Notes <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Input
                placeholder="e.g. New batch, Supplier..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addEntry()}
                className="mt-1"
              />
            </div>

            {/* Add button — full width */}
            <div className="col-span-2">
              <Button onClick={addEntry} className="w-full">
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
                      <td className="px-4 py-3 text-right font-bold text-green-600">+{e.qty}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{e.notes || "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeEntry(idx)}>
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
            {processing
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...</>
              : <><CheckCircle2 className="h-4 w-4 mr-2" /> Submit {entries.length} Entr{entries.length === 1 ? "y" : "ies"}</>
            }
          </Button>
        )}
      </div>
    </div>
  );
}