import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmt } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Download } from "lucide-react";

export const Route = createFileRoute("/admin/stock-reconciliations")({
  head: () => ({
    meta: [
      { title: "Stock Reconciliation Report — ZIC Mart" },
      { name: "description", content: "Audit log of stock reconciliations: system vs physical counts, differences, cost impact and notes." },
      { property: "og:title", content: "Stock Reconciliation Report — ZIC Mart" },
      { property: "og:description", content: "Audit log of stock reconciliations at ZIC Mart." },
    ],
  }),
  component: StockReconciliationsPage,
});

type Row = {
  id: string;
  created_at: string;
  product_id: string;
  unit_id: string | null;
  system_stock: number;
  physical_stock: number;
  difference: number;
  cost_price: number;
  cost_impact: number;
  notes: string | null;
  created_by: string | null;
  product_name?: string;
  unit_name?: string;
  created_by_name?: string;
};

function todayISO(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function StockReconciliationsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO());
  const [q, setQ] = useState("");
  const [onlyMismatch, setOnlyMismatch] = useState(false);

  const load = async () => {
    setLoading(true);
    const start = new Date(from + "T00:00:00").toISOString();
    const end = new Date(to + "T23:59:59").toISOString();
    const { data, error } = await supabase
      .from("stock_reconciliations")
      .select("*")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    if (error) { console.error(error); setRows([]); setLoading(false); return; }

    const recs = (data ?? []) as Row[];
    const productIds = Array.from(new Set(recs.map(r => r.product_id).filter(Boolean)));
    const unitIds = Array.from(new Set(recs.map(r => r.unit_id).filter(Boolean) as string[]));
    const userIds = Array.from(new Set(recs.map(r => r.created_by).filter(Boolean) as string[]));

    const [pRes, uRes, prRes] = await Promise.all([
      productIds.length ? supabase.from("products").select("id,name").in("id", productIds) : Promise.resolve({ data: [] as any[] }),
      unitIds.length ? supabase.from("product_units").select("id,unit_label").in("id", unitIds) : Promise.resolve({ data: [] as any[] }),
      userIds.length ? supabase.from("profiles").select("id,full_name").in("id", userIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const pMap = new Map((pRes.data ?? []).map((p: any) => [p.id, p.name]));
    const uMap = new Map((uRes.data ?? []).map((u: any) => [u.id, u.unit_label]));
    const prMap = new Map((prRes.data ?? []).map((p: any) => [p.id, p.full_name]));

    setRows(recs.map(r => ({
      ...r,
      product_name: pMap.get(r.product_id) ?? "—",
      unit_name: r.unit_id ? uMap.get(r.unit_id) : undefined,
      created_by_name: r.created_by ? (prMap.get(r.created_by) ?? "—") : "—",
    })));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (onlyMismatch && Number(r.difference) === 0) return false;
      if (!q.trim()) return true;
      const s = q.toLowerCase();
      return (r.product_name ?? "").toLowerCase().includes(s)
        || (r.notes ?? "").toLowerCase().includes(s)
        || (r.created_by_name ?? "").toLowerCase().includes(s);
    });
  }, [rows, q, onlyMismatch]);

  const totals = useMemo(() => {
    let count = filtered.length;
    let mismatches = 0, shortage = 0, surplus = 0, netImpact = 0;
    for (const r of filtered) {
      const d = Number(r.difference);
      const c = Number(r.cost_impact);
      if (d !== 0) mismatches++;
      if (d < 0) shortage += Math.abs(c);
      else if (d > 0) surplus += Math.abs(c);
      netImpact += c;
    }
    return { count, mismatches, shortage, surplus, netImpact };
  }, [filtered]);

  const exportCsv = () => {
    const header = ["Date", "Product", "Unit", "System", "Physical", "Difference", "Cost Price", "Cost Impact", "Notes", "By"];
    const lines = [header.join(",")];
    for (const r of filtered) {
      const cols = [
        new Date(r.created_at).toLocaleString(),
        r.product_name ?? "",
        r.unit_name ?? "",
        r.system_stock,
        r.physical_stock,
        r.difference,
        r.cost_price,
        r.cost_impact,
        (r.notes ?? "").replace(/"/g, '""'),
        r.created_by_name ?? "",
      ].map(v => `"${String(v ?? "")}"`);
      lines.push(cols.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-reconciliations-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Stock Reconciliation Report</h1>
          <p className="text-sm text-muted-foreground">Audit of physical stock counts vs system stock.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!filtered.length}>
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </Button>
      </div>

      <Card className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Search product / notes / user</Label>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" />
          </div>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyMismatch} onChange={e => setOnlyMismatch(e.target.checked)} />
            Only mismatches
          </label>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-4"><div className="text-xs text-muted-foreground">Records</div><div className="text-xl font-bold">{totals.count}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Mismatches</div><div className="text-xl font-bold">{totals.mismatches}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Shortage (cost)</div><div className="text-xl font-bold text-red-600">{fmt(totals.shortage)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Surplus (cost)</div><div className="text-xl font-bold text-green-600">{fmt(totals.surplus)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Net impact</div><div className={`text-xl font-bold ${totals.netImpact < 0 ? "text-red-600" : "text-green-600"}`}>{fmt(totals.netImpact)}</div></Card>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">No reconciliation records in this range.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2 text-right">System</th>
                  <th className="px-3 py-2 text-right">Physical</th>
                  <th className="px-3 py-2 text-right">Diff</th>
                  <th className="px-3 py-2 text-right">Cost Price</th>
                  <th className="px-3 py-2 text-right">Cost Impact</th>
                  <th className="px-3 py-2">Notes</th>
                  <th className="px-3 py-2">By</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const diff = Number(r.difference);
                  const impact = Number(r.cost_impact);
                  const diffColor = diff === 0 ? "" : diff < 0 ? "text-red-600" : "text-green-600";
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2">{r.product_name}</td>
                      <td className="px-3 py-2">{r.unit_name ?? <span className="text-muted-foreground">base</span>}</td>
                      <td className="px-3 py-2 text-right">{r.system_stock}</td>
                      <td className="px-3 py-2 text-right">{r.physical_stock}</td>
                      <td className={`px-3 py-2 text-right font-medium ${diffColor}`}>
                        {diff > 0 ? `+${diff}` : diff}
                        {diff !== 0 && (
                          <Badge variant="outline" className={`ml-2 ${diff < 0 ? "border-red-500 text-red-600" : "border-green-500 text-green-600"}`}>
                            {diff < 0 ? "Shortage" : "Surplus"}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{fmt(r.cost_price)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${impact < 0 ? "text-red-600" : impact > 0 ? "text-green-600" : ""}`}>{fmt(impact)}</td>
                      <td className="px-3 py-2 max-w-[280px] truncate" title={r.notes ?? ""}>{r.notes ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.created_by_name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
