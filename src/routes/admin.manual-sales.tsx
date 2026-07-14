import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt, today } from "@/lib/format";
import { toast } from "sonner";
import { FileBarChart, Plus, Trash2, Save, Download } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/admin/manual-sales")({
  component: ManualSalesPage,
});

type Row = {
  id?: string;
  entry_date: string;
  cash_junaid: number;
  cash_usama: number;
  cash_zahid: number;
  others: number;
  counter_cash: number;
  today_expenses_override: number | null;
  previous_expense_override: number | null;
  notes: string;
};

const emptyRow = (): Row => ({
  entry_date: today(),
  cash_junaid: 0, cash_usama: 0, cash_zahid: 0, others: 0, counter_cash: 0,
  today_expenses_override: null, previous_expense_override: null, notes: "",
});

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { fromISO: from.toISOString().slice(0, 10), toISO: to.toISOString().slice(0, 10) };
}

function ManualSalesPage() {
  const { fullName, user } = useAuth();
  const [ym, setYm] = useState(() => today().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [expensesByDay, setExpensesByDay] = useState<Record<string, number>>({});
  const [salesByDay, setSalesByDay] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Row>(emptyRow());
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { fromISO, toISO } = monthRange(ym);
    const [{ data: entries }, { data: op }, { data: de }, { data: se }, { data: sales }] = await Promise.all([
      supabase.from("manual_sale_days").select("*")
        .gte("entry_date", fromISO).lt("entry_date", toISO)
        .order("entry_date", { ascending: true }),
      supabase.from("operating_expenses").select("expense_date, amount")
        .gte("expense_date", fromISO).lt("expense_date", toISO),
      supabase.from("daily_expenses").select("expense_date, amount")
        .gte("expense_date", fromISO).lt("expense_date", toISO),
      supabase.from("shift_expenses").select("created_at, amount")
        .gte("created_at", fromISO + "T00:00:00Z").lt("created_at", toISO + "T00:00:00Z"),
      supabase.from("sales").select("created_at, total")
        .gte("created_at", fromISO + "T00:00:00Z").lt("created_at", toISO + "T00:00:00Z"),
    ]);

    const ex: Record<string, number> = {};
    for (const r of (op ?? []) as any[]) ex[r.expense_date] = (ex[r.expense_date] ?? 0) + Number(r.amount || 0);
    for (const r of (de ?? []) as any[]) ex[r.expense_date] = (ex[r.expense_date] ?? 0) + Number(r.amount || 0);
    for (const r of (se ?? []) as any[]) {
      const d = String(r.created_at).slice(0, 10);
      ex[d] = (ex[d] ?? 0) + Number(r.amount || 0);
    }
    setExpensesByDay(ex);

    const sm: Record<string, number> = {};
    for (const r of (sales ?? []) as any[]) {
      const d = String(r.created_at).slice(0, 10);
      sm[d] = (sm[d] ?? 0) + Number(r.total || 0);
    }
    setSalesByDay(sm);

    setRows((entries ?? []) as Row[]);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ym]);

  // Compute derived rows in order; carry previous_total forward.
  const computed = useMemo(() => {
    let prevGrand = 0;
    return rows.map((r) => {
      const todayExp = r.today_expenses_override ?? expensesByDay[r.entry_date] ?? 0;
      const prevExp = r.previous_expense_override ?? prevGrand;
      const grandExp = Number(todayExp) + Number(prevExp);
      const totalCash = Number(r.cash_junaid) + Number(r.cash_usama) + Number(r.cash_zahid) + Number(r.others) + Number(r.counter_cash);
      const grandTotal = totalCash + grandExp;
      const previousTotal = prevGrand;
      const saleCalc = grandTotal - previousTotal;
      const salePos = salesByDay[r.entry_date] ?? 0;
      prevGrand = grandTotal;
      return { ...r, todayExp, prevExp, grandExp, totalCash, grandTotal, previousTotal, saleCalc, salePos };
    });
  }, [rows, expensesByDay, salesByDay]);

  const totals = useMemo(() => {
    return computed.reduce((a, r) => ({
      sale: a.sale + r.saleCalc,
      pos: a.pos + r.salePos,
      expenses: a.expenses + r.todayExp,
      cash: a.cash + r.totalCash,
    }), { sale: 0, pos: 0, expenses: 0, cash: 0 });
  }, [computed]);

  async function saveDraft() {
    if (!draft.entry_date) { toast.error("Pick a date"); return; }
    setSaving(true);
    const payload: any = {
      entry_date: draft.entry_date,
      cash_junaid: draft.cash_junaid,
      cash_usama: draft.cash_usama,
      cash_zahid: draft.cash_zahid,
      others: draft.others,
      counter_cash: draft.counter_cash,
      today_expenses_override: draft.today_expenses_override,
      previous_expense_override: draft.previous_expense_override,
      notes: draft.notes,
      created_by: user?.id ?? null,
      created_by_name: fullName ?? "",
    };
    const { error } = await supabase.from("manual_sale_days").upsert(payload, { onConflict: "entry_date" });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    setDraft(emptyRow());
    load();
  }

  async function updateCell(row: Row, patch: Partial<Row>) {
    const merged = { ...row, ...patch };
    setRows((prev) => prev.map((r) => (r.id === row.id ? merged : r)));
    const { error } = await supabase.from("manual_sale_days").update(patch as any).eq("id", row.id!);
    if (error) toast.error(error.message);
  }

  async function delRow(row: Row) {
    if (!confirm(`Delete entry for ${row.entry_date}?`)) return;
    const { error } = await supabase.from("manual_sale_days").delete().eq("id", row.id!);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    load();
  }

  function exportCSV() {
    const header = ["SR.No","Date","Cash Junaid","Cash Usama","Cash Zahid Ali","Others","Counter Cash","Today Expenses","Previous Expense","Grand Expenses","Total Cash","Grand Total","Previous Total","Sale","POS Sale","Notes"];
    const body = computed.map((r, i) => [
      i + 1, r.entry_date, r.cash_junaid, r.cash_usama, r.cash_zahid, r.others, r.counter_cash,
      r.todayExp, r.prevExp, r.grandExp, r.totalCash, r.grandTotal, r.previousTotal, r.saleCalc, r.salePos, r.notes,
    ]);
    const csv = [header, ...body].map(r => r.map(c => `"${String(c ?? "").replace(/"/g,'""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `manual-sale-${ym}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const numInput = (v: number | null | undefined, on: (n: number) => void, cls = "") => (
    <Input type="number" value={v ?? 0} onChange={(e) => on(Number(e.target.value) || 0)}
      className={`h-8 w-24 text-right font-mono ${cls}`} />
  );

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileBarChart className="h-7 w-7" /> Manual Sale Report
          </h1>
          <p className="text-muted-foreground">Daily cash-in-hand ledger. Today Expenses auto-fill from expense reports; override any cell.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label>Month</Label>
            <Input type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
          </div>
          <Button variant="outline" onClick={exportCSV} disabled={computed.length === 0}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Days" value={String(computed.length)} />
        <Stat label="Total Sale (ledger)" value={fmt(totals.sale)} accent="text-emerald-600" />
        <Stat label="POS Sale (system)" value={fmt(totals.pos)} accent="text-blue-600" />
        <Stat label="Today Expenses" value={fmt(totals.expenses)} accent="text-destructive" />
      </div>

      <Card className="p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Plus className="h-4 w-4" /> Add / Update Day</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <div><Label>Date</Label><Input type="date" value={draft.entry_date} onChange={(e) => setDraft({ ...draft, entry_date: e.target.value })} /></div>
          <div><Label>Cash Junaid</Label><Input type="number" value={draft.cash_junaid} onChange={(e) => setDraft({ ...draft, cash_junaid: Number(e.target.value) || 0 })} /></div>
          <div><Label>Cash Usama</Label><Input type="number" value={draft.cash_usama} onChange={(e) => setDraft({ ...draft, cash_usama: Number(e.target.value) || 0 })} /></div>
          <div><Label>Cash Zahid Ali</Label><Input type="number" value={draft.cash_zahid} onChange={(e) => setDraft({ ...draft, cash_zahid: Number(e.target.value) || 0 })} /></div>
          <div><Label>Others</Label><Input type="number" value={draft.others} onChange={(e) => setDraft({ ...draft, others: Number(e.target.value) || 0 })} /></div>
          <div><Label>Counter Cash</Label><Input type="number" value={draft.counter_cash} onChange={(e) => setDraft({ ...draft, counter_cash: Number(e.target.value) || 0 })} /></div>
          <div><Label>Today Exp. (override)</Label><Input type="number" placeholder="auto" value={draft.today_expenses_override ?? ""} onChange={(e) => setDraft({ ...draft, today_expenses_override: e.target.value === "" ? null : Number(e.target.value) })} /></div>
        </div>
        <div className="mt-3 flex items-end gap-3">
          <div className="flex-1"><Label>Notes</Label><Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></div>
          <Button onClick={saveDraft} disabled={saving}><Save className="h-4 w-4 mr-1" /> Save Day</Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Saving an existing date will overwrite that day.</p>
      </Card>

      <Card className="p-3">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted uppercase text-[10px]">
              <tr>
                <th className="p-2 text-left">#</th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-right">Junaid</th>
                <th className="p-2 text-right">Usama</th>
                <th className="p-2 text-right">Zahid</th>
                <th className="p-2 text-right">Others</th>
                <th className="p-2 text-right">Counter</th>
                <th className="p-2 text-right">Today Exp.</th>
                <th className="p-2 text-right">Prev Exp.</th>
                <th className="p-2 text-right">Grand Exp.</th>
                <th className="p-2 text-right">Total Cash</th>
                <th className="p-2 text-right">Grand Total</th>
                <th className="p-2 text-right">Prev Total</th>
                <th className="p-2 text-right text-emerald-700">Sale</th>
                <th className="p-2 text-right text-blue-700">POS</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={16} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : computed.length === 0 ? (
                <tr><td colSpan={16} className="p-8 text-center text-muted-foreground">No entries this month. Add one above.</td></tr>
              ) : computed.map((r, i) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-2">{i + 1}</td>
                  <td className="p-2 whitespace-nowrap">{r.entry_date}</td>
                  <td className="p-1 text-right">{numInput(r.cash_junaid, (n) => updateCell(r, { cash_junaid: n }))}</td>
                  <td className="p-1 text-right">{numInput(r.cash_usama, (n) => updateCell(r, { cash_usama: n }))}</td>
                  <td className="p-1 text-right">{numInput(r.cash_zahid, (n) => updateCell(r, { cash_zahid: n }))}</td>
                  <td className="p-1 text-right">{numInput(r.others, (n) => updateCell(r, { others: n }))}</td>
                  <td className="p-1 text-right">{numInput(r.counter_cash, (n) => updateCell(r, { counter_cash: n }))}</td>
                  <td className="p-1 text-right">
                    <Input type="number" placeholder={String(expensesByDay[r.entry_date] ?? 0)}
                      value={r.today_expenses_override ?? ""} onChange={(e) => updateCell(r, { today_expenses_override: e.target.value === "" ? null : Number(e.target.value) })}
                      className="h-8 w-24 text-right font-mono" />
                  </td>
                  <td className="p-2 text-right font-mono text-muted-foreground">{Number(r.prevExp).toLocaleString()}</td>
                  <td className="p-2 text-right font-mono">{Number(r.grandExp).toLocaleString()}</td>
                  <td className="p-2 text-right font-mono font-semibold">{Number(r.totalCash).toLocaleString()}</td>
                  <td className="p-2 text-right font-mono font-semibold">{Number(r.grandTotal).toLocaleString()}</td>
                  <td className="p-2 text-right font-mono text-muted-foreground">{Number(r.previousTotal).toLocaleString()}</td>
                  <td className="p-2 text-right font-mono font-bold text-emerald-700">{Number(r.saleCalc).toLocaleString()}</td>
                  <td className="p-2 text-right font-mono text-blue-700">{Number(r.salePos).toLocaleString()}</td>
                  <td className="p-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => delRow(r)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            {computed.length > 0 && (
              <tfoot className="bg-muted/50 font-semibold">
                <tr>
                  <td className="p-2" colSpan={7}>Totals</td>
                  <td className="p-2 text-right font-mono">{totals.expenses.toLocaleString()}</td>
                  <td colSpan={2}></td>
                  <td className="p-2 text-right font-mono">{totals.cash.toLocaleString()}</td>
                  <td colSpan={2}></td>
                  <td className="p-2 text-right font-mono text-emerald-700">{totals.sale.toLocaleString()}</td>
                  <td className="p-2 text-right font-mono text-blue-700">{totals.pos.toLocaleString()}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
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
