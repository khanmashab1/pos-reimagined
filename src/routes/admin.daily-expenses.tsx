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
  Building2, Download, Plus, Trash2, Loader2, Receipt,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/daily-expenses")({
  component: OperatingExpensesPage,
});

const num = (v: unknown) => Number(v) || 0;

const MONTHS = [
  { v: "all", label: "All months" },
  { v: "01", label: "January" }, { v: "02", label: "February" }, { v: "03", label: "March" },
  { v: "04", label: "April" }, { v: "05", label: "May" }, { v: "06", label: "June" },
  { v: "07", label: "July" }, { v: "08", label: "August" }, { v: "09", label: "September" },
  { v: "10", label: "October" }, { v: "11", label: "November" }, { v: "12", label: "December" },
];

const EXPENSE_CATEGORIES = ["Rent", "Electricity", "Gas", "Internet", "Salary", "Wages", "Miscellaneous"];
const PAY_METHODS = ["cash", "easypaisa", "jazzcash", "card", "bank"];

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", easypaisa: "EasyPaisa", jazzcash: "JazzCash", card: "Card", bank: "Bank",
};

type Preset = "today" | "7d" | "30d" | "90d" | "year" | "month" | "custom";

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { fromISO: from.toISOString().slice(0, 10), toISO: to.toISOString().slice(0, 10) };
}

const PRESET_LABEL: Record<Preset, string> = {
  today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days",
  year: "This year", month: "Month", custom: "Custom",
};

const blankOp = {
  expense_date: today(),
  category: "Rent",
  description: "",
  amount: "",
  paid_to: "",
  payment_method: "cash",
};

function OperatingExpensesPage() {
  const { fullName } = useAuth();
  const [preset, setPreset] = useState<Preset>("month");
  const [ym, setYm] = useState(() => today().slice(0, 7));
  const [customFrom, setCustomFrom] = useState(() => today());
  const [customTo, setCustomTo] = useState(() => today());
  const [opList, setOpList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [opForm, setOpForm] = useState(blankOp);
  const [savingOp, setSavingOp] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const range = useMemo(() => {
    const t = today();
    if (preset === "today") return { fromISO: t, toISO: addDaysISO(t, 1) };
    if (preset === "7d") return { fromISO: addDaysISO(t, -6), toISO: addDaysISO(t, 1) };
    if (preset === "30d") return { fromISO: addDaysISO(t, -29), toISO: addDaysISO(t, 1) };
    if (preset === "90d") return { fromISO: addDaysISO(t, -89), toISO: addDaysISO(t, 1) };
    if (preset === "year") {
      const y = new Date().getUTCFullYear();
      return { fromISO: `${y}-01-01`, toISO: `${y + 1}-01-01` };
    }
    if (preset === "custom") return { fromISO: customFrom, toISO: addDaysISO(customTo, 1) };
    return monthRange(ym);
  }, [preset, ym, customFrom, customTo]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase.from("operating_expenses" as any)
      .select("id, expense_date, category, description, amount, paid_to, payment_method, recorded_by_name, created_at")
      .gte("expense_date", range.fromISO).lt("expense_date", range.toISO)
      .order("expense_date", { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) { toast.error(error.message); setOpList([]); setLoading(false); return; }
        setOpList((data ?? []) as any[]);
        setLoading(false);
      });

    return () => { active = false; };
  }, [range.fromISO, range.toISO, refreshTick]);

  const totals = useMemo(() => {
    const byCat: Record<string, number> = {};
    const byMethod: Record<string, number> = {};
    let total = 0;
    for (const r of opList) {
      const amt = num(r.amount);
      total += amt;
      const cat = String(r.category || "Miscellaneous");
      byCat[cat] = (byCat[cat] ?? 0) + amt;
      const m = String(r.payment_method || "cash");
      byMethod[m] = (byMethod[m] ?? 0) + amt;
    }
    return { total, byCat, byMethod };
  }, [opList]);

  const scopeLabel = preset === "month"
    ? new Date(ym + "-02").toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : preset === "custom"
      ? `${range.fromISO} → ${addDaysISO(range.toISO, -1)}`
      : PRESET_LABEL[preset];


  async function saveOp() {
    if (!opForm.amount || num(opForm.amount) <= 0) return toast.error("Enter an amount");
    setSavingOp(true);
    const { error } = await supabase.from("operating_expenses" as any).insert({
      expense_date: opForm.expense_date,
      category: opForm.category,
      description: opForm.description.trim(),
      amount: num(opForm.amount),
      paid_to: opForm.paid_to.trim(),
      payment_method: opForm.payment_method,
      recorded_by_name: fullName,
    });
    setSavingOp(false);
    if (error) return toast.error(error.message);
    toast.success("Operating expense added");
    setOpForm({ ...blankOp, expense_date: opForm.expense_date });
    setRefreshTick((t) => t + 1);
  }

  async function delOp(id: string) {
    if (!confirm("Delete this operating expense?")) return;
    const { error } = await supabase.from("operating_expenses" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    setRefreshTick((t) => t + 1);
  }

  function exportCSV() {
    const head = ["Date", "Category", "Description", "Paid To", "Method", "Recorded By", "Amount"];
    const body = opList.map((r) => [
      r.expense_date, r.category, r.description || "", r.paid_to || "",
      METHOD_LABEL[r.payment_method] ?? r.payment_method, r.recorded_by_name || "", num(r.amount),
    ]);
    const csv = [head, ...body]
      .map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `operating-expenses-${year}${month !== "all" ? "-" + month : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 pt-16 md:p-8 md:pt-8 space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Building2 className="h-7 w-7" /> Operating Expenses
        </h1>
        <p className="text-muted-foreground text-sm">
          Record and review operating expenses — rent, bills, salaries and other running costs.
        </p>
      </div>

      {/* Filters */}
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
          <div />
          <Button variant="outline" onClick={exportCSV} disabled={opList.length === 0}>
            <Download className="h-4 w-4 mr-1" /> Export to Excel
          </Button>
        </div>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SummaryCard
          label={`Total Operating Expenses (${scopeLabel})`}
          value={fmt(totals.total)}
          icon={Building2}
          color="var(--destructive)"
          sub={catSub(totals.byCat)}
        />
        <SummaryCard
          label={`By Payment Method (${scopeLabel})`}
          value={fmt(totals.total)}
          icon={Receipt}
          color="var(--warning)"
          sub={methodSub(totals.byMethod)}
        />
      </div>

      {/* Add Operating Expense */}
      <Card className="p-4 sm:p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-4"><Plus className="h-4 w-4" /> Add Operating Expense</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Date">
            <Input type="date" value={opForm.expense_date} onChange={(e) => setOpForm({ ...opForm, expense_date: e.target.value })} />
          </Field>
          <Field label="Category">
            <Select value={opForm.category} onValueChange={(v) => setOpForm({ ...opForm, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Amount">
            <Input type="number" step="0.01" value={opForm.amount} onChange={(e) => setOpForm({ ...opForm, amount: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Payment Method">
            <Select value={opForm.payment_method} onValueChange={(v) => setOpForm({ ...opForm, payment_method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAY_METHODS.map((m) => <SelectItem key={m} value={m}>{METHOD_LABEL[m] ?? m}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Paid To">
            <Input value={opForm.paid_to} onChange={(e) => setOpForm({ ...opForm, paid_to: e.target.value })} placeholder="optional" />
          </Field>
          <Field label="Description">
            <Input value={opForm.description} onChange={(e) => setOpForm({ ...opForm, description: e.target.value })} placeholder="optional" />
          </Field>
        </div>
        <Button className="w-full md:w-auto mt-4" onClick={saveOp} disabled={savingOp}>
          {savingOp ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Add Operating Expense
        </Button>
      </Card>

      {/* List */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Operating Expenses — {scopeLabel}
          </h2>
          <div className="text-sm text-muted-foreground">
            {opList.length} entries · Total <span className="font-semibold text-foreground">{fmt(totals.total)}</span>
          </div>
        </div>
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : opList.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">No operating expenses for this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-muted/50 text-left text-xs uppercase">
                <tr>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Description</th>
                  <th className="px-3 py-3">Paid To</th>
                  <th className="px-3 py-3">Method</th>
                  <th className="px-3 py-3">By</th>
                  <th className="px-3 py-3 text-right">Amount</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {opList.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5">{r.expense_date}</td>
                    <td className="px-3 py-2.5">{r.category}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.description || "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.paid_to || "—"}</td>
                    <td className="px-3 py-2.5">{METHOD_LABEL[r.payment_method] ?? r.payment_method}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.recorded_by_name || "—"}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{fmt(r.amount)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => delOp(r.id)}>
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

function methodSub(byMethod: Record<string, number>): string | undefined {
  const parts = Object.entries(byMethod)
    .filter(([, v]) => v > 0)
    .map(([m, v]) => `${METHOD_LABEL[m] ?? m} ${fmt(v)}`);
  return parts.length ? parts.join(" · ") : undefined;
}

function catSub(byCat: Record<string, number>): string | undefined {
  const parts = Object.entries(byCat)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `${c} ${fmt(v)}`);
  return parts.length ? parts.join(" · ") : undefined;
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
