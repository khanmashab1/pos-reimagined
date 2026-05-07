import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, ArrowLeft, Plus, Trash2 } from "lucide-react";
import { fmt } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/stock-entry")({
  component: StockEntryPage,
});

interface Product {
  id: string;
  barcode: string;
  name: string;
  stock: number;
  category_id: string | null;
}

interface StockEntry {
  product_id: string;
  product_name: string;
  qty: number;
  notes: string;
}

function StockEntryPage() {
  const { loading, user, role, fullName } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<StockEntry[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [processing, setProcessing] = useState(false);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  // Load all products for search
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true)
        .order("name");
      setProducts((data ?? []) as Product[]);
    })();
  }, []);

  const filtered = search.trim()
    ? products.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.barcode.includes(search)
      )
    : [];

  const selectProduct = (product: Product) => {
    setSelectedProduct(product);
    setSearch("");
    setShowResults(false);
    setQty("");
    setNotes("");
  };

  const addEntry = () => {
    if (!selectedProduct) {
      toast.error("Select a product");
      return;
    }
    if (!qty || Number(qty) <= 0) {
      toast.error("Enter a valid quantity");
      return;
    }

    setEntries([
      ...entries,
      {
        product_id: selectedProduct.id,
        product_name: selectedProduct.name,
        qty: Number(qty),
        notes,
      },
    ]);

    setSelectedProduct(null);
    setQty("");
    setNotes("");
    toast.success("Entry added");
  };

  const removeEntry = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const submitEntries = async () => {
    if (entries.length === 0) {
      toast.error("No stock entries to submit");
      return;
    }

    setProcessing(true);
    try {
      const results = await Promise.all(
        entries.map(entry =>
          supabase.rpc("add_stock_entry", {
            _product_id: entry.product_id,
            _qty: entry.qty,
            _notes: entry.notes || null,
          })
        )
      );

      const errors = results.filter(r => r.error);
      if (errors.length > 0) {
        toast.error(`Error: ${errors[0].error.message}`);
        return;
      }

      toast.success(`${entries.length} stock entry(ies) recorded!`);
      setEntries([]);
    } catch (error) {
      console.error("Submit error:", error);
      toast.error(`Error submitting entries: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon">
              <Link to="/pos"><ArrowLeft className="h-5 w-5" /></Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold">Stock Entry</h1>
              <p className="text-xs text-muted-foreground">{fullName}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 max-w-2xl mx-auto w-full">
        <div className="space-y-4">
          {/* Search and select product */}
          <Card className="p-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Product</label>
              <div className="relative">
                <Input
                  placeholder="Search product by name or barcode..."
                  value={search}
                  onChange={e => {
                    setSearch(e.target.value);
                    setShowResults(true);
                  }}
                  onFocus={() => search && setShowResults(true)}
                />
                {showResults && filtered.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg z-10 max-h-48 overflow-auto">
                    {filtered.map(p => (
                      <button
                        key={p.id}
                        onClick={() => selectProduct(p)}
                        className="w-full text-left px-4 py-2 hover:bg-muted transition-colors border-b last:border-0"
                      >
                        <div className="font-medium text-sm">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Stock: {p.stock} | Barcode: {p.barcode}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedProduct && (
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-sm">
                    <div className="font-medium">{selectedProduct.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Current Stock: {selectedProduct.stock}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Quantity and notes */}
          {selectedProduct && (
            <Card className="p-4">
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium block mb-1">Quantity to Add</label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={qty}
                    onChange={e => setQty(e.target.value)}
                    min="1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Notes (optional)</label>
                  <Input
                    placeholder="e.g., Received from supplier, New batch..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>
                <Button onClick={addEntry} className="w-full">
                  <Plus className="h-4 w-4 mr-2" /> Add Entry
                </Button>
              </div>
            </Card>
          )}

          {/* Entries list */}
          {entries.length > 0 && (
            <Card className="p-4">
              <div className="space-y-2">
                <div className="font-semibold text-sm">Stock Entries ({entries.length})</div>
                <div className="space-y-2 max-h-48 overflow-auto">
                  {entries.map((entry, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-muted rounded-lg text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{entry.product_name}</div>
                        <div className="text-xs text-muted-foreground">+{entry.qty} units</div>
                        {entry.notes && <div className="text-xs text-muted-foreground italic">{entry.notes}</div>}
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => removeEntry(idx)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* Submit button */}
          {entries.length > 0 && (
            <Button
              onClick={submitEntries}
              disabled={processing}
              className="w-full h-10 text-base"
              size="lg"
            >
              {processing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Submit {entries.length} {entries.length === 1 ? "Entry" : "Entries"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
