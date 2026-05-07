import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft } from "lucide-react";
import { fmt } from "@/lib/format";

export const Route = createFileRoute("/admin/stock-summary")({
  component: AdminStockSummary,
});

interface StockEntry {
  id: string;
  product_id: string;
  cashier_id: string;
  cashier_name: string;
  product_name: string;
  barcode: string;
  qty: number;
  notes: string;
  created_at: string;
}

interface StockSummary {
  product_id: string;
  product_name: string;
  barcode: string;
  total_qty: number;
  entry_count: number;
  first_entry: string;
  last_entry: string;
}

function AdminStockSummary() {
  const { loading, user, role } = useAuth();
  const [entries, setEntries] = useState<StockEntry[]>([]);
  const [summary, setSummary] = useState<StockSummary[]>([]);
  const [view, setView] = useState<"summary" | "details">("summary");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (role !== "admin") {
      window.location.href = "/pos";
      return;
    }
    fetchData();
  }, [role, dateFrom, dateTo]);

  const fetchData = async () => {
    setDataLoading(true);
    try {
      let q = supabase
        .from("stock_entries")
        .select("id, product_id, cashier_id, cashier_name, qty, notes, created_at")
        .order("created_at", { ascending: false });

      if (dateFrom) {
        q = q.gte("created_at", `${dateFrom}T00:00:00`);
      }
      if (dateTo) {
        q = q.lte("created_at", `${dateTo}T23:59:59`);
      }

      const { data, error } = await q;

      if (error) {
        console.error("Error fetching stock entries:", error);
        return;
      }

      if (!data) return;

      // Get product details
      const productIds = [...new Set(data.map(e => e.product_id))];
      const { data: products } = await supabase
        .from("products")
        .select("id, name, barcode")
        .in("id", productIds);

      const productMap = new Map(products?.map(p => [p.id, p]) ?? []);

      const enriched = data.map(e => ({
        ...e,
        product_name: productMap.get(e.product_id)?.name ?? "Unknown",
        barcode: productMap.get(e.product_id)?.barcode ?? "",
      })) as StockEntry[];

      setEntries(enriched);

      // Build summary
      const summaryMap = new Map<string, StockSummary>();
      enriched.forEach(entry => {
        const key = entry.product_id;
        if (!summaryMap.has(key)) {
          summaryMap.set(key, {
            product_id: entry.product_id,
            product_name: entry.product_name,
            barcode: entry.barcode,
            total_qty: 0,
            entry_count: 0,
            first_entry: entry.created_at,
            last_entry: entry.created_at,
          });
        }
        const summary = summaryMap.get(key)!;
        summary.total_qty += entry.qty;
        summary.entry_count += 1;
        summary.first_entry = new Date(entry.created_at) < new Date(summary.first_entry) ? entry.created_at : summary.first_entry;
        summary.last_entry = new Date(entry.created_at) > new Date(summary.last_entry) ? entry.created_at : summary.last_entry;
      });

      setSummary(Array.from(summaryMap.values()).sort((a, b) => b.total_qty - a.total_qty));
    } finally {
      setDataLoading(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card p-4">
        <div className="flex items-center gap-3 mb-4">
          <Button asChild variant="ghost" size="icon">
            <Link to="/admin/dashboard"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <h1 className="text-xl font-bold">Stock Entry Summary</h1>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            placeholder="From"
            className="text-sm"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            placeholder="To"
            className="text-sm"
          />
          <div className="flex gap-2 ml-auto">
            <Button
              variant={view === "summary" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("summary")}
            >
              Summary
            </Button>
            <Button
              variant={view === "details" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("details")}
            >
              Details
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {dataLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : view === "summary" ? (
          // Summary View
          <div className="space-y-3 max-w-6xl">
            {summary.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                No stock entries found
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Card className="p-4 bg-muted">
                    <div className="text-sm text-muted-foreground">Total Products Restocked</div>
                    <div className="text-3xl font-bold">{summary.length}</div>
                  </Card>
                  <Card className="p-4 bg-muted">
                    <div className="text-sm text-muted-foreground">Total Units Added</div>
                    <div className="text-3xl font-bold">{summary.reduce((s, p) => s + p.total_qty, 0)}</div>
                  </Card>
                  <Card className="p-4 bg-muted">
                    <div className="text-sm text-muted-foreground">Total Entries</div>
                    <div className="text-3xl font-bold">{entries.length}</div>
                  </Card>
                </div>

                {/* Summary table */}
                <Card>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted">
                        <tr>
                          <th className="text-left p-3">Product</th>
                          <th className="text-left p-3">Barcode</th>
                          <th className="text-right p-3">Units Added</th>
                          <th className="text-right p-3">Entries</th>
                          <th className="text-left p-3">First Entry</th>
                          <th className="text-left p-3">Last Entry</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.map(row => (
                          <tr key={row.product_id} className="border-b hover:bg-muted/50">
                            <td className="p-3 font-medium">{row.product_name}</td>
                            <td className="p-3 text-xs">{row.barcode}</td>
                            <td className="p-3 text-right font-bold text-green-600">{row.total_qty}</td>
                            <td className="p-3 text-right">{row.entry_count}</td>
                            <td className="p-3 text-xs text-muted-foreground">
                              {new Date(row.first_entry).toLocaleDateString()}
                            </td>
                            <td className="p-3 text-xs text-muted-foreground">
                              {new Date(row.last_entry).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}
          </div>
        ) : (
          // Details View
          <div className="space-y-3 max-w-6xl">
            {entries.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                No stock entries found
              </Card>
            ) : (
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted">
                      <tr>
                        <th className="text-left p-3">Date & Time</th>
                        <th className="text-left p-3">Product</th>
                        <th className="text-left p-3">Barcode</th>
                        <th className="text-left p-3">Cashier</th>
                        <th className="text-right p-3">Qty</th>
                        <th className="text-left p-3">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map(entry => (
                        <tr key={entry.id} className="border-b hover:bg-muted/50">
                          <td className="p-3 text-xs text-muted-foreground">
                            {new Date(entry.created_at).toLocaleString()}
                          </td>
                          <td className="p-3 font-medium">{entry.product_name}</td>
                          <td className="p-3 text-xs">{entry.barcode}</td>
                          <td className="p-3">{entry.cashier_name}</td>
                          <td className="p-3 text-right font-bold text-green-600">+{entry.qty}</td>
                          <td className="p-3 text-xs text-muted-foreground">{entry.notes || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
