import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Search, Download, Pencil, PackageX } from "lucide-react";
import { fmt } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/low-stock")({
  component: LowStockPage,
});

interface LowStockProduct {
  id: string;
  barcode: string;
  name: string;
  category_id: string | null;
  purchase_price: number;
  sale_price: number;
  stock: number;
  min_stock_alert: number;
}
interface Cat { id: string; name: string; }

type SeverityFilter = "all" | "out" | "low";
type SortKey = "severity" | "name" | "stock";

function LowStockPage() {
  const [items, setItems] = useState<LowStockProduct[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("severity");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Pull all active products and filter client-side, because PostgREST
      // can't easily compare two columns (stock <= min_stock_alert) in a single .filter().
      // For a typical POS catalog (a few thousand items) this is fine.
      const [{ data: p, error }, { data: c }] = await Promise.all([
        supabase
          .from("products")
          .select("id,barcode,name,category_id,purchase_price,sale_price,stock,min_stock_alert")
          .eq("is_active", true)
          .order("stock", { ascending: true }),
        supabase.from("categories").select("id,name").order("name"),
      ]);
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      const lowOnly = (p ?? []).filter(
        (row: any) => Number(row.stock) <= Number(row.min_stock_alert ?? 5)
      ) as LowStockProduct[];
      setItems(lowOnly);
      setCats((c ?? []) as Cat[]);
      setLoading(false);
    })();
  }, []);

  const catName = (id: string | null) =>
    id ? cats.find(c => c.id === id)?.name ?? "—" : "—";

  const filtered = useMemo(() => {
    let rows = items;
    if (catFilter !== "all") rows = rows.filter(r => r.category_id === catFilter);
    if (severity === "out") rows = rows.filter(r => r.stock === 0);
    else if (severity === "low") rows = rows.filter(r => r.stock > 0);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        r => r.name.toLowerCase().includes(q) || r.barcode.toLowerCase().includes(q)
      );
    }
    // sorting
    const sorted = [...rows];
    if (sortKey === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortKey === "stock") {
      sorted.sort((a, b) => a.stock - b.stock);
    } else {
      // severity: out first, then by % of threshold ascending
      sorted.sort((a, b) => {
        if (a.stock === 0 && b.stock !== 0) return -1;
        if (b.stock === 0 && a.stock !== 0) return 1;
        const ra = a.stock / Math.max(1, a.min_stock_alert);
        const rb = b.stock / Math.max(1, b.min_stock_alert);
        return ra - rb;
      });
    }
    return sorted;
  }, [items, search, catFilter, severity, sortKey]);

  const counts = useMemo(() => {
    const out = items.filter(r => r.stock === 0).length;
    const low = items.filter(r => r.stock > 0).length;
    return { out, low, total: items.length };
  }, [items]);

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const header = [
      "Barcode", "Name", "Category", "Stock", "Threshold",
      "Status", "Reorder Qty (suggest)", "Cost", "Sale Price",
    ];
    const rows = filtered.map(r => {
      const status = r.stock === 0 ? "OUT_OF_STOCK" : "LOW";
      // Suggest reorder = (threshold * 2) - stock, min 1
      const suggest = Math.max(1, r.min_stock_alert * 2 - r.stock);
      return [
        r.barcode, r.name, catName(r.category_id), r.stock, r.min_stock_alert,
        status, suggest, r.purchase_price, r.sale_price,
      ];
    });
    const csv = [header, ...rows]
      .map(row => row.map(cell => {
        const s = String(cell ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `low-stock-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} item${filtered.length === 1 ? "" : "s"}`);
  };

  const StatusBadge = ({ p }: { p: LowStockProduct }) => {
    if (p.stock === 0) {
      return <Badge variant="destructive" className="gap-1"><PackageX className="h-3 w-3" />Out of Stock</Badge>;
    }
    return <Badge className="bg-warning text-warning-foreground gap-1">
      <AlertTriangle className="h-3 w-3" />Low ({p.stock}/{p.min_stock_alert})
    </Badge>;
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-7 w-7 text-warning" /> Low Stock
          </h1>
          <p className="text-muted-foreground">Products that need to be reordered</p>
        </div>
        <Button onClick={exportCsv} disabled={filtered.length === 0}>
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Total Alerts</div>
          <div className="text-3xl font-bold mt-1">{counts.total}</div>
        </Card>
        <Card className="p-4 border-destructive/30">
          <div className="text-xs uppercase text-destructive">Out of Stock</div>
          <div className="text-3xl font-bold mt-1 text-destructive">{counts.out}</div>
        </Card>
        <Card className="p-4 border-warning/40">
          <div className="text-xs uppercase text-warning">Low Stock</div>
          <div className="text-3xl font-bold mt-1">{counts.low}</div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name or barcode"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {cats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={(v: SeverityFilter) => setSeverity(v)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="out">Out of stock only</SelectItem>
              <SelectItem value="low">Low only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortKey} onValueChange={(v: SortKey) => setSortKey(v)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="severity">Sort: severity</SelectItem>
              <SelectItem value="stock">Sort: stock asc</SelectItem>
              <SelectItem value="name">Sort: name</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Product</th>
                <th className="text-left px-4 py-3">Barcode</th>
                <th className="text-center px-4 py-3">Stock</th>
                <th className="text-center px-4 py-3">Threshold</th>
                <th className="text-center px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Cost</th>
                <th className="text-right px-4 py-3">Sale Price</th>
                <th className="text-right px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && (
                <tr><td colSpan={8} className="text-center text-muted-foreground py-10">Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-muted-foreground py-10">
                    {items.length === 0
                      ? "🎉 All products are well-stocked!"
                      : "No products match your filters."}
                  </td>
                </tr>
              )}
              {!loading && filtered.map(p => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{catName(p.category_id)}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{p.barcode}</td>
                  <td className={`px-4 py-3 text-center font-bold ${p.stock === 0 ? "text-destructive" : "text-warning"}`}>
                    {p.stock}
                  </td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{p.min_stock_alert}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge p={p} /></td>
                  <td className="px-4 py-3 text-right">{fmt(p.purchase_price)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{fmt(p.sale_price)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to="/admin/products" className="inline-flex items-center gap-1 text-primary hover:underline text-xs">
                      <Pencil className="h-3 w-3" /> Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
