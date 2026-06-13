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

const num = (v: unknown) => Number(v) || 0;
function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

// Net Difference = opening_cash + cash_sales − cash_paid_out − expenses (per session, then summed).
// Online sales never enter the drawer, so they are tracked separately and never in Net Difference.
interface CashierRow {
  id: string;
  name: string;
  sessions: number;
  cash: number;       // SUM(cash_sessions.cash_sales)
  online: number;     // SUM(cash_sessions.online_sales)
  paidOut: number;    // SUM(cash_sessions.cash_paid_out)
  expenses: number;   // SUM(cash_sessions.expenses)
  netDiff: number;    // SUM(opening + cash_sales − cash_paid_out − expenses)
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

    const { data: sessions } = await supabase
      .from("cash_sessions")
      .select("user_id,user_name,opening_cash,cash_sales,online_sales,cash_paid_out,expenses,opened_at")
      .gte("opened_at", fromIso)
      .lte("opened_at", toIso);

    const map = new Map<string, CashierRow>();
    const get = (id: string | null, name: string | null) => {
      const key = id ?? "unknown";
      let r = map.get(key);
      if (!r) { r = { id: key, name: name || "—", sessions: 0, cash: 0, online: 0, paidOut: 0, expenses: 0, netDiff: 0 }; map.set(key, r); }
      if (name && (r.name === "—" || r.name === "")) r.name = name;
      return r;
    };

    for (const se of (sessions ?? []) as any[]) {
      const r = get(se.user_id, se.user_name);
      r.sessions += 1;
      r.cash += num(se.cash_sales);
      r.online += num(se.online_sales);
      r.paidOut += num(se.cash_paid_out);
      r.expenses += num(se.expenses);
      r.netDiff += num(se.opening_cash) + num(se.cash_sales) - num(se.cash_paid_out) - num(se.expenses);
    }

    setRows(Array.from(map.values()).sort((a, b) => b.cash - a.cash));
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const totals = rows.reduce(
    (a, r) => ({
      sessions: a.sessions + r.sessions,
      cash: a.cash + r.cash,
      online: a.online + r.online,
      paidOut: a.paidOut + r.paidOut,
      expenses: a.expenses + r.expenses,
      netDiff: a.netDiff + r.netDiff,
    }),
    { sessions: 0, cash: 0, online: 0, paidOut: 0, expenses: 0, netDiff: 0 },
  );

  const diffClass = (d: number) => (d === 0 ? "" : d > 0 ? "text-green-600" : "text-destructive");

  function exportCSV() {
    const head = ["Cashier", "Sessions", "Cash Sales", "Online Sales", "Cash Paid Out", "Expenses", "Net Difference"];
    const body = rows.map((r) => [r.name, r.sessions, r.cash, r.online, r.paidOut, r.expenses, r.netDiff]);
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
        <p className="text-muted-foreground">Cash flow per cashier. Online sales are tracked separately and never enter the drawer.</p>
      </div>

      <Card className="p-5">
        <div className="grid md:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button onClick={load} disabled={loading}><Search className="h-4 w-4 mr-1" /> Apply</Button>
          <Button variant="outline" onClick={exportCSV} disabled={rows.length === 0}><Download className="h-4 w-4 mr-1" /> Export CSV</Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <Stat label="Cash Sales" value={fmt(totals.cash)} accent="text-green-600" />
          <Stat label="Online Sales" value={fmt(totals.online)} accent="text-blue-600" />
          <Stat label="Expenses" value={fmt(totals.expenses)} />
          <Stat label="Net Difference" value={fmt(totals.netDiff)}
            accent={totals.netDiff === 0 ? "" : totals.netDiff > 0 ? "text-green-600" : "text-destructive"} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">No cashier sessions in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3">Cashier</th>
                  <th className="px-4 py-3 text-right">Sessions</th>
                  <th className="px-4 py-3 text-right">Cash Sales</th>
                  <th className="px-4 py-3 text-right">Online Sales</th>
                  <th className="px-4 py-3 text-right">Cash Paid Out</th>
                  <th className="px-4 py-3 text-right">Expenses</th>
                  <th className="px-4 py-3 text-right">Net Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium">{r.name}</td>
                    <td className="px-4 py-3 text-right">{r.sessions}</td>
                    <td className="px-4 py-3 text-right text-green-700">{fmt(r.cash)}</td>
                    <td className="px-4 py-3 text-right text-blue-700">{fmt(r.online)}</td>
                    <td className="px-4 py-3 text-right">{fmt(r.paidOut)}</td>
                    <td className="px-4 py-3 text-right">{fmt(r.expenses)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${diffClass(r.netDiff)}`}>{fmt(r.netDiff)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 bg-muted/30 font-semibold">
                <tr>
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right">{totals.sessions}</td>
                  <td className="px-4 py-3 text-right text-green-700">{fmt(totals.cash)}</td>
                  <td className="px-4 py-3 text-right text-blue-700">{fmt(totals.online)}</td>
                  <td className="px-4 py-3 text-right">{fmt(totals.paidOut)}</td>
                  <td className="px-4 py-3 text-right">{fmt(totals.expenses)}</td>
                  <td className={`px-4 py-3 text-right ${diffClass(totals.netDiff)}`}>{fmt(totals.netDiff)}</td>
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
