import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Search, Users, Loader2 } from "lucide-react";
import { fmt } from "@/lib/format";

export const Route = createFileRoute("/admin/cashier-report")({
  component: CashierReportPage,
});

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const isCash = (v: string | null | undefined) => (v ?? "cash").trim().toLowerCase() === "cash";

interface CashierRow {
  id: string;
  name: string;
  bills: number;
  cash: number;
  online: number;
  total: number;
  paidOut: number;
  diff: number;
}

function CashierReportPage() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayStr());
  const [rows, setRows] = useState<CashierRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const fromIso = new Date(from + "T00:00:00").toISOString();
    const toIso = new Date(to + "T23:59:59.999").toISOString();

    const [{ data: sales }, { data: pays }, { data: sessions }] = await Promise.all([
      supabase
        .from("sales")
        .select("cashier_id,cashier_name,payment_type,total")
        .gte("created_at", fromIso)
        .lte("created_at", toIso),
      supabase
        .from("supplier_payments" as any)
        .select("created_by,created_by_name,amount,method")
        .gte("created_at", fromIso)
        .lte("created_at", toIso),
      supabase
        .from("cash_sessions")
        .select("user_id,user_name,difference,opened_at")
        .gte("opened_at", fromIso)
        .lte("opened_at", toIso),
    ]);

    const map = new Map<string, CashierRow>();
    const get = (id: string | null, name: string | null) => {
      const key = id ?? "unknown";
      let r = map.get(key);
      if (!r) {
        r = { id: key, name: name || "—", bills: 0, cash: 0, online: 0, total: 0, paidOut: 0, diff: 0 };
        map.set(key, r);
      }
      if (name && (r.name === "—" || r.name === "")) r.name = name;
      return r;
    };

    for (const s of (sales ?? []) as any[]) {
      const r = get(s.cashier_id, s.cashier_name);
      const amt = Number(s.total) || 0;
      r.bills += 1;
      r.total += amt;
      if (isCash(s.payment_type)) r.cash += amt;
      else r.online += amt;
    }
    for (const p of (pays ?? []) as any[]) {
      if (!isCash(p.method)) continue; // only cash payouts leave the drawer
      const r = get(p.created_by, p.created_by_name);
      r.paidOut += Number(p.amount) || 0;
    }
    for (const se of (sessions ?? []) as any[]) {
      if (se.difference == null) continue;
      const r = get(se.user_id, se.user_name);
      r.diff += Number(se.difference) || 0;
    }

    setRows(Array.from(map.values()).sort((a, b) => b.total - a.total));
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = rows.reduce(
    (a, r) => ({
      cash: a.cash + r.cash,
      online: a.online + r.online,
      total: a.total + r.total,
      paidOut: a.paidOut + r.paidOut,
      diff: a.diff + r.diff,
    }),
    { cash: 0, online: 0, total: 0, paidOut: 0, diff: 0 },
  );

  const diffClass = (d: number) => (d === 0 ? "" : d > 0 ? "text-green-600" : "text-destructive");

  function exportCSV() {
    const head = ["Cashier", "Bills", "Cash Sales", "Online Sales", "Total Sales", "Cash Paid Out", "Net Difference"];
    const body = rows.map((r) => [r.name, r.bills, r.cash, r.online, r.total, r.paidOut, r.diff]);
    const csv = [head, ...body]
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cashier-report-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Users className="h-7 w-7" /> Cashier Report
        </h1>
        <p className="text-muted-foreground">How much each cashier sold and handled</p>
      </div>

      <Card className="p-5">
        <div className="grid md:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
          <div>
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button onClick={load} disabled={loading}>
            <Search className="h-4 w-4 mr-1" /> Apply
          </Button>
          <Button variant="outline" onClick={exportCSV} disabled={rows.length === 0}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <Stat label="Cashiers" value={String(rows.length)} />
          <Stat label="Total Sales" value={fmt(totals.total)} />
          <Stat label="Cash Paid Out" value={fmt(totals.paidOut)} />
          <Stat
            label="Net Difference"
            value={fmt(totals.diff)}
            accent={totals.diff === 0 ? "" : totals.diff > 0 ? "text-green-600" : "text-destructive"}
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">No cashier activity in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3">Cashier</th>
                  <th className="px-4 py-3 text-right">Bills</th>
                  <th className="px-4 py-3 text-right">Cash Sales</th>
                  <th className="px-4 py-3 text-right">Online Sales</th>
                  <th className="px-4 py-3 text-right">Total Sales</th>
                  <th className="px-4 py-3 text-right">Paid Out</th>
                  <th className="px-4 py-3 text-right">Net Diff</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium">{r.name}</td>
                    <td className="px-4 py-3 text-right">{r.bills}</td>
                    <td className="px-4 py-3 text-right">{fmt(r.cash)}</td>
                    <td className="px-4 py-3 text-right">{fmt(r.online)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{fmt(r.total)}</td>
                    <td className="px-4 py-3 text-right">{fmt(r.paidOut)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${diffClass(r.diff)}`}>
                      {fmt(r.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 bg-muted/30 font-semibold">
                <tr>
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right">{rows.reduce((s, r) => s + r.bills, 0)}</td>
                  <td className="px-4 py-3 text-right">{fmt(totals.cash)}</td>
                  <td className="px-4 py-3 text-right">{fmt(totals.online)}</td>
                  <td className="px-4 py-3 text-right">{fmt(totals.total)}</td>
                  <td className="px-4 py-3 text-right">{fmt(totals.paidOut)}</td>
                  <td className={`px-4 py-3 text-right ${diffClass(totals.diff)}`}>{fmt(totals.diff)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold mt-1 ${accent ?? ""}`}>{value}</div>
    </div>
  );
}
