import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt, today } from "@/lib/format";
import {
  BookText, Download, Search, Plus, Pencil, Trash2, Loader2, X,
  TrendingUp, Wallet, Receipt, Coins, User, Users,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/daily-expenses")({
  component: DailyExpensesPage,
});

const num = (v: unknown) => Number(v) || 0;

const MONTHS = [
  { v: "all", label: "All months" },
  { v: "01", label: "January" }, { v: "02", label: "February" }, { v: "03", label: "March" },
  { v: "04", label: "April" }, { v: "05", label: "May" }, { v: "06", label: "June" },
  { v: "07", label: "July" }, { v: "08", label: "August" }, { v: "09", label: "September" },
  { v: "10", label: "October" }, { v: "11", label: "November" }, { v: "12", label: "December" },
];

interface Raw {
  id: string;
  entry_date: string;
  cash_junaid: number;
  cash_usama: number;
  others: number;
  counter_cash: number;
  today_expenses: number;
  created_at?: string;
}

interface Computed extends Raw {
  sr: number;
  prevExpense: number;
  grandExpenses: number;
  totalCash: number;
  grandTotal: number;
  prevTotal: number;
  profit: number;
  sale: number;
}

const blankForm = {
  id: null as string | null,
  entry_date: today(),
  cash_junaid: "",
  cash_usama: "",
  others: "",
  counter_cash: "",
  today_expenses: "",
};

function DailyExpensesPage() {
  const { fullName } = useAuth();
  const [rows, setRows] = useState<Raw[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);

  const thisYear = String(new Date().getFullYear());
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState("all");
  const [search, setSearch] = useState("");
  // Online payments pulled from POS sales for the scope: card+easypaisa -> Junaid, jazzcash -> Usama.
  const [online, setOnline] = useState({ junaid: 0, usama: 0 });

  useEffect(() => { load(); }, []);

  // Fetch online payments by method for the selected Year + Month and attribute to people.
  useEffect(() => {
    let active = true;
    const from = `${year}-${month === "all" ? "01" : month}-01`;
    const lastDay = month === "all" ? 31 : new Date(Number(year), Number(month), 0).getDate();
    const to = `${year}-${month === "all" ? "12" : month}-${String(month === "all" ? 31 : lastDay).padStart(2, "0")}`;
    const fromIso = new Date(from + "T00:00:00").toISOString();
    const toIso = new Date(to + "T23:59:59.999").toISOString();
    supabase.rpc("get_online_by_method" as any, { _from: fromIso, _to: toIso }).then(({ data, error }) => {
      if (!active) return;
      if (error) { setOnline({ junaid: 0, usama: 0 }); return; } // RPC not deployed yet → 0
      const d = (data ?? {}) as Record<string, number>;
      setOnline({
        junaid: num(d.card) + num(d.easypasa),
        usama: num(d.jazzcash),
      });
    });
    return () => { active = false; };
  }, [year, month]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("daily_expenses" as any)
      .select("*")
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    setRows(((data as any) ?? []) as Raw[]);
    setLoading(false);
  }

  // Compute the full running chain over ALL rows in date order — so Previous
  // Expense/Total pull from the row above and editing a past date recalculates everything.
  const computed = useMemo<Computed[]>(() => {
    const sorted = [...rows].sort((a, b) =>
      a.entry_date.localeCompare(b.entry_date) ||
      (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    );
    let prevExpense = 0;
    let prevTotal = 0;
    return sorted.map((r, i) => {
      const totalCash =
        num(r.cash_junaid) + num(r.cash_usama) +
        num(r.others) + num(r.counter_cash);
      const grandExpenses = num(r.today_expenses) + prevExpense;
      const grandTotal = totalCash + prevTotal;
      const profit = grandTotal - grandExpenses;
      const sale = grandTotal - prevTotal; // == totalCash, by the Excel formula
      const out: Computed = {
        ...r, sr: i + 1, prevExpense, grandExpenses, totalCash, grandTotal, prevTotal, profit, sale,
      };
      prevExpense = grandExpenses;
      prevTotal = grandTotal;
      return out;
    });
  }, [rows]);

  const years = useMemo(() => {
    const set = new Set<string>(computed.map((r) => r.entry_date.slice(0, 4)));
    set.add(thisYear);
    return Array.from(set).sort().reverse();
  }, [computed, thisYear]);

  // Rows in the selected Year + Month — the date filter that drives every summary.
  const scoped = useMemo(
    () => computed.filter((r) =>
      r.entry_date.slice(0, 4) === year && (month === "all" || r.entry_date.slice(5, 7) === month),
    ),
    [computed, year, month],
  );

  // Summary cards = sum of daily values for the selected Year + Month.
  const cards = useMemo(
    () => scoped.reduce(
      (a, r) => ({
        sales: a.sales + r.sale,
        profit: a.profit + (r.sale - num(r.today_expenses)),
        expenses: a.expenses + num(r.today_expenses),
        cash: a.cash + r.totalCash,
      }),
      { sales: 0, profit: 0, expenses: 0, cash: 0 },
    ),
    [scoped],
  );

  const personTotals = useMemo(
    () => scoped.reduce(
      (a, r) => ({
        junaid: a.junaid + num(r.cash_junaid),
        usama: a.usama + num(r.cash_usama),
        others: a.others + num(r.others),
      }),
      { junaid: 0, usama: 0, others: 0 },
    ),
    [scoped],
  );

  const scopeLabel = month === "all" ? year : `${MONTHS.find((m) => m.v === month)?.label} ${year}`;

  const display = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((r) => r.entry_date.toLowerCase().includes(q) || String(r.sr) === q);
  }, [scoped, search]);

  async function save() {
    if (!form.entry_date) return toast.error("Date is required");
    setSaving(true);
    const payload = {
      entry_date: form.entry_date,
      cash_junaid: num(form.cash_junaid),
      cash_usama: num(form.cash_usama),
      others: num(form.others),
      counter_cash: num(form.counter_cash),
      today_expenses: num(form.today_expenses),
    };
    const { error } = form.id
      ? await supabase.from("daily_expenses" as any).update({ ...payload, updated_at: new Date().toISOString() }).eq("id", form.id)
      : await supabase.from("daily_expenses" as any).insert({ ...payload, created_by_name: fullName });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(form.id ? "Entry updated" : "Entry added");
    setForm({ ...blankForm, entry_date: form.entry_date });
    load();
  }

  function editRow(r: Computed) {
    setForm({
      id: r.id,
      entry_date: r.entry_date,
      cash_junaid: String(r.cash_junaid),
      cash_usama: String(r.cash_usama),
      others: String(r.others),
      counter_cash: String(r.counter_cash),
      today_expenses: String(r.today_expenses),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function del(id: string) {
    if (!confirm("Delete this entry? Rows after it will recalculate.")) return;
    const { error } = await supabase.from("daily_expenses" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    if (form.id === id) setForm(blankForm);
    load();
  }

  function exportCSV() {
    const head = [
      "SR.No", "Date", "Cash Junaid", "Cash Usama", "others",
      "Counter Cash", "Today Expenses", "Previous Expense", "Grand Expenses",
      "Total Cash", "Grand Total", "Previous Total", "Profit", "Sale",
    ];
    const body = display.map((r) => [
      r.sr, r.entry_date, r.cash_junaid, r.cash_usama, r.others,
      r.counter_cash, r.today_expenses, r.prevExpense, r.grandExpenses, r.totalCash,
      r.grandTotal, r.prevTotal, r.profit, r.sale,
    ]);
    const csv = [head, ...body]
      .map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily-expenses-${year}${month !== "all" ? "-" + month : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const profitClass = (n: number) => (n === 0 ? "" : n > 0 ? "text-green-600" : "text-destructive");

  return (
    <div className="p-4 pt-16 md:p-8 md:pt-8 space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <BookText className="h-7 w-7" /> Daily Expenses Report
        </h1>
        <p className="text-muted-foreground text-sm">
          Enter the day's cash and expenses — Grand Expenses, Total Cash, Grand Total, Profit and Sale
          calculate automatically.
        </p>
      </div>

      {/* Filters — control all summary cards and the table */}
      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-[160px_200px_1fr_auto] gap-3 items-end">
          <Field label="Year">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Month">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MONTHS.map((m) => <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Search">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Date (YYYY-MM-DD) or SR.No" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </Field>
          <Button variant="outline" onClick={exportCSV} disabled={display.length === 0}>
            <Download className="h-4 w-4 mr-1" /> Export to Excel
          </Button>
        </div>
      </Card>

      {/* Summary cards (respect the Year + Month filter) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label={`Total Sales (${scopeLabel})`} value={fmt(cards.sales)} icon={TrendingUp} color="var(--info)" />
        <SummaryCard label={`Total Profit (${scopeLabel})`} value={fmt(cards.profit)} icon={Coins} color="var(--success)"
          accent={cards.profit < 0 ? "text-destructive" : "text-green-600"} />
        <SummaryCard label={`Total Expenses (${scopeLabel})`} value={fmt(cards.expenses)} icon={Receipt} color="var(--warning)" />
        <SummaryCard label={`Total Cash (${scopeLabel})`} value={fmt(cards.cash)} icon={Wallet} color="var(--accent)" />
      </div>

      {/* Per-person totals (respect the Year + Month date filter).
          Junaid also includes Card + EasyPaisa; Usama also includes JazzCash (from POS sales). */}
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase text-muted-foreground">
          By Person · {scopeLabel}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryCard
            label="Total Junaid"
            value={fmt(personTotals.junaid + online.junaid)}
            sub={`Cash ${fmt(personTotals.junaid)} · Card+EasyPaisa ${fmt(online.junaid)}`}
            icon={User} color="var(--info)"
          />
          <SummaryCard
            label="Total Usama"
            value={fmt(personTotals.usama + online.usama)}
            sub={`Cash ${fmt(personTotals.usama)} · JazzCash ${fmt(online.usama)}`}
            icon={User} color="var(--success)"
          />
          <SummaryCard label="Total others" value={fmt(personTotals.others)} icon={Users} color="var(--warning)" />
        </div>
      </div>

      {/* Data entry form */}
      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            {form.id ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {form.id ? "Edit Entry" : "Add Entry"}
          </h2>
          {form.id && (
            <Button size="sm" variant="ghost" onClick={() => setForm(blankForm)}>
              <X className="h-4 w-4 mr-1" /> Cancel edit
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Date">
            <Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
          </Field>
          <Field label="Cash Junaid">
            <Input type="number" step="0.01" value={form.cash_junaid} onChange={(e) => setForm({ ...form, cash_junaid: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Cash Usama">
            <Input type="number" step="0.01" value={form.cash_usama} onChange={(e) => setForm({ ...form, cash_usama: e.target.value })} placeholder="0" />
          </Field>
          <Field label="others">
            <Input type="number" step="0.01" value={form.others} onChange={(e) => setForm({ ...form, others: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Counter Cash" highlight>
            <Input type="number" step="0.01" value={form.counter_cash} onChange={(e) => setForm({ ...form, counter_cash: e.target.value })} placeholder="0"
              className="border-primary/50 focus-visible:ring-primary" />
          </Field>
          <Field label="Today Expenses">
            <Input type="number" step="0.01" value={form.today_expenses} onChange={(e) => setForm({ ...form, today_expenses: e.target.value })} placeholder="0" />
          </Field>
          <div className="flex items-end">
            <Button className="w-full" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : form.id ? <Pencil className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              {form.id ? "Update" : "Add Entry"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Data table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : display.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">No entries for this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-muted/50 text-left text-xs uppercase">
                <tr>
                  <th className="px-3 py-3">SR</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3 text-right">Cash Junaid</th>
                  <th className="px-3 py-3 text-right">Cash Usama</th>
                  <th className="px-3 py-3 text-right">others</th>
                  <th className="px-3 py-3 text-right">Counter Cash</th>
                  <th className="px-3 py-3 text-right">Today Exp.</th>
                  <th className="px-3 py-3 text-right">Prev. Exp.</th>
                  <th className="px-3 py-3 text-right">Grand Exp.</th>
                  <th className="px-3 py-3 text-right">Total Cash</th>
                  <th className="px-3 py-3 text-right">Grand Total</th>
                  <th className="px-3 py-3 text-right">Prev. Total</th>
                  <th className="px-3 py-3 text-right">Profit</th>
                  <th className="px-3 py-3 text-right">Sale</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {display.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5 font-medium">{r.sr}</td>
                    <td className="px-3 py-2.5">{r.entry_date}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(r.cash_junaid)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(r.cash_usama)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(r.others)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmt(r.counter_cash)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(r.today_expenses)}</td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground">{fmt(r.prevExpense)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(r.grandExpenses)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmt(r.totalCash)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(r.grandTotal)}</td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground">{fmt(r.prevTotal)}</td>
                    <td className={`px-3 py-2.5 text-right font-semibold ${profitClass(r.profit)}`}>{fmt(r.profit)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{fmt(r.sale)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => editRow(r)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => del(r.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, color, accent, sub }: {
  label: string; value: string; icon: React.ComponentType<{ className?: string; style?: any }>;
  color: string; accent?: string; sub?: string;
}) {
  return (
    <Card className="p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
          <div className={`mt-1 text-base sm:text-xl font-bold break-words leading-tight ${accent ?? ""}`}>{value}</div>
          {sub && <div className="mt-0.5 text-[11px] text-muted-foreground break-words">{sub}</div>}
        </div>
        <div className="relative flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg">
          <div className="absolute inset-0 rounded-lg opacity-15" style={{ background: color }} />
          <Icon className="relative h-4 w-4 sm:h-5 sm:w-5" style={{ color }} />
        </div>
      </div>
    </Card>
  );
}

function Field({ label, children, highlight }: { label: string; children: ReactNode; highlight?: boolean }) {
  return (
    <div>
      <Label className={`text-xs ${highlight ? "text-primary font-semibold" : ""}`}>{label}</Label>
      {children}
    </div>
  );
}
