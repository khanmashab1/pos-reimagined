import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmt } from "@/lib/format";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/shifts")({
  component: ShiftsPage,
});

interface Session {
  id: string;
  user_name: string;
  opening_cash: number;
  cash_sales: number;
  closing_cash: number | null;
  expected_cash: number;
  difference: number | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
}

function ShiftsPage() {
  const [rows, setRows] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("cash_sessions").select("*").order("opened_at", { ascending: false }).limit(200)
      .then(({ data }) => { setRows((data ?? []) as Session[]); setLoading(false); });
  }, []);

  const totals = rows.reduce((a, r) => ({
    cash: a.cash + Number(r.cash_sales || 0),
    diff: a.diff + Number(r.difference || 0),
  }), { cash: 0, diff: 0 });

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Cashier Shifts</h1>
        <p className="text-muted-foreground">Sessions opened and closed by cashiers</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="p-4"><div className="text-xs text-muted-foreground">Total Shifts</div><div className="text-2xl font-bold">{rows.length}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Total Cash Sales</div><div className="text-2xl font-bold">{fmt(totals.cash)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Net Difference</div><div className={`text-2xl font-bold ${totals.diff === 0 ? "" : totals.diff > 0 ? "text-green-600" : "text-destructive"}`}>{fmt(totals.diff)}</div></Card>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">No shifts yet.</p>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-4 py-3">Cashier</th>
                    <th className="px-4 py-3">Opened</th>
                    <th className="px-4 py-3">Closed</th>
                    <th className="px-4 py-3 text-right">Opening</th>
                    <th className="px-4 py-3 text-right">Cash Sales</th>
                    <th className="px-4 py-3 text-right">Expected</th>
                    <th className="px-4 py-3 text-right">Closing</th>
                    <th className="px-4 py-3 text-right">Diff</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 font-medium">{r.user_name || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(r.opened_at).toLocaleString()}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.closed_at ? new Date(r.closed_at).toLocaleString() : "—"}</td>
                      <td className="px-4 py-3 text-right">{fmt(r.opening_cash)}</td>
                      <td className="px-4 py-3 text-right">{fmt(r.cash_sales)}</td>
                      <td className="px-4 py-3 text-right">{fmt(r.expected_cash)}</td>
                      <td className="px-4 py-3 text-right">{r.closing_cash != null ? fmt(r.closing_cash) : "—"}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${r.difference == null ? "" : Number(r.difference) === 0 ? "" : Number(r.difference) > 0 ? "text-green-600" : "text-destructive"}`}>
                        {r.difference != null ? fmt(Number(r.difference)) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={r.status === "open" ? "default" : "secondary"}>{r.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y">
              {rows.map(r => (
                <div key={r.id} className="p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">{r.user_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{new Date(r.opened_at).toLocaleString()}</div>
                    </div>
                    <Badge variant={r.status === "open" ? "default" : "secondary"}>{r.status}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-y-1 text-sm">
                    <span className="text-muted-foreground">Opening</span><span className="text-right">{fmt(r.opening_cash)}</span>
                    <span className="text-muted-foreground">Cash Sales</span><span className="text-right">{fmt(r.cash_sales)}</span>
                    <span className="text-muted-foreground">Expected</span><span className="text-right">{fmt(r.expected_cash)}</span>
                    <span className="text-muted-foreground">Closing</span><span className="text-right">{r.closing_cash != null ? fmt(r.closing_cash) : "—"}</span>
                    <span className="text-muted-foreground">Difference</span>
                    <span className={`text-right font-semibold ${r.difference == null ? "" : Number(r.difference) === 0 ? "" : Number(r.difference) > 0 ? "text-green-600" : "text-destructive"}`}>
                      {r.difference != null ? fmt(Number(r.difference)) : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
