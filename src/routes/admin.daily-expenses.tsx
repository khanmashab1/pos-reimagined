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
  TrendingUp, Wallet, Receipt, Coins, User, Users, Building2, HandCoins,
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

const EXPENSE_CATEGORIES = ["Rent", "Electricity", "Gas", "Internet", "Salary", "Wages", "Miscellaneous"];
const PAY_METHODS = ["cash", "easypaisa", "jazzcash", "card", "bank"];
const PERSON_OPTIONS = ["Junaid", "Usama", "Other"];

const blankOp = { expense_date: today(), category: "Rent", description: "", amount: "", paid_to: "", payment_method: "cash" };
const blankPay = { payment_date: today(), person: "Junaid", customPerson: "", amount: "", payment_method: "cash", notes: "" };

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
  // POS cashier expenses (shift_expenses) total for the scope — folded into Total Expenses.
  const [shiftExpTotal, setShiftExpTotal] = useState(0);
  // Operating expenses (rent, bills, salaries) for the scope, with per-category breakdown.
  const [opTotals, setOpTotals] = useState<{ total: number; byCat: Record<string, number> }>({ total: 0, byCat: {} });
  const [opList, setOpList] = useState<any[]>([]);
  // Person payments (Junaid/Usama/Other) for the scope, grouped by person and method.
  const [personPay, setPersonPay] = useState<Record<string, { total: number; byMethod: Record<string, number> }>>({});
  const [opForm, setOpForm] = useState(blankOp);
  const [payForm, setPayForm] = useState(blankPay);
  const [savingOp, setSavingOp] = useState(false);
  const [savingPay, setSavingPay] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => { load(); }, []);

  // Fetch scope-bound data: POS cashier expenses, operating expenses, person payments.
  useEffect(() => {
    let active = true;
    const from = `${year}-${month === "all" ? "01" : month}-01`;
    const lastDay = month === "all" ? 31 : new Date(Number(year), Number(month), 0).getDate();
    const to = `${year}-${month === "all" ? "12" : month}-${String(month === "all" ? 31 : lastDay).padStart(2, "0")}`;
    const fromIso = new Date(from + "T00:00:00").toISOString();
    const toIso = new Date(to + "T23:59:59.999").toISOString();

    supabase.from("shift_expenses").select("amount, created_at")
      .gte("created_at", fromIso).lte("created_at", toIso)
      .then(({ data, error }) => {
        if (!active) return;
        setShiftExpTotal(error ? 0 : (data ?? []).reduce((s: number, r: any) => s + num(r.amount), 0));
      });

    supabase.from("operating_expenses" as any).select("amount, category")
      .gte("expense_date", from).lte("expense_date", to)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) { setOpTotals({ total: 0, byCat: {} }); return; }
        const byCat: Record<string, number> = {};
        let total = 0;
        (data ?? []).forEach((r: any) => {
          const amt = num(r.amount);
          total += amt;
          const cat = String(r.category || "Miscellaneous");
          byCat[cat] = (byCat[cat] ?? 0) + amt;
        });
        setOpTotals({ total, byCat });
      });

    supabase.from("person_payments" as any).select("amount, person_name, payment_method")
      .gte("payment_date", from).lte("payment_date", to)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) { setPersonPay({}); return; }
        const acc: Record<string, { total: number; byMethod: Record<string, number> }> = {};
        (data ?? []).forEach((r: any) => {
          const name = String(r.person_name || "Other").trim() || "Other";
          const amt = num(r.amount);
          const method = String(r.payment_method || "cash");
          const bucket = (acc[name] ??= { total: 0, byMethod: {} });
          bucket.total += amt;
          bucket.byMethod[method] = (bucket.byMethod[method] ?? 0) + amt;
        });
        setPersonPay(acc);
      });

    return () => { active = false; };
  }, [year, month, refreshTick]);

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

  const scopeLabel = month === "all" ? year : `${MONTHS.find((m) => m.v === month)?.label} ${year}`;

  // Person totals come from the person_payments ledger. Junaid/Usama always shown;
  // everyone else is aggregated into "Others".
  const personCards = useMemo(() => {
    const known = new Set(["junaid", "usama"]);
    const junaid = personPay["Junaid"] ?? { total: 0, byMethod: {} };
    const usama = personPay["Usama"] ?? { total: 0, byMethod: {} };
    const others = { total: 0, byMethod: {} as Record<string, number> };
    for (const [name, v] of Object.entries(personPay)) {
      if (known.has(name.trim().toLowerCase())) continue;
      others.total += v.total;
      for (const [m, amt] of Object.entries(v.byMethod)) others.byMethod[m] = (others.byMethod[m] ?? 0) + amt;
    }
    return { junaid, usama, others };
  }, [personPay]);

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

  async function savePay() {
    const person = payForm.person === "Other" ? payForm.customPerson.trim() : payForm.person;
    if (!person) return toast.error("Enter the person's name");
    if (!payForm.amount || num(payForm.amount) <= 0) return toast.error("Enter an amount");
    setSavingPay(true);
    const { error } = await supabase.from("person_payments" as any).insert({
      payment_date: payForm.payment_date,
      person_name: person,
      amount: num(payForm.amount),
      payment_method: payForm.payment_method,
      notes: payForm.notes.trim(),
      recorded_by_name: fullName,
    });
    setSavingPay(false);
    if (error) return toast.error(error.message);
    toast.success("Payment recorded");
    setPayForm({ ...blankPay, payment_date: payForm.payment_date });
    setRefreshTick((t) => t + 1);
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard label={`Total Sales (${scopeLabel})`} value={fmt(cards.sales)} icon={TrendingUp} color="var(--info)" />
        <SummaryCard label={`Total Profit (${scopeLabel})`} value={fmt(cards.profit - shiftExpTotal - opTotals.total)} icon={Coins} color="var(--success)"
          accent={(cards.profit - shiftExpTotal - opTotals.total) < 0 ? "text-destructive" : "text-green-600"} />
        <SummaryCard label={`Total Expenses (${scopeLabel})`} value={fmt(cards.expenses + shiftExpTotal + opTotals.total)} icon={Receipt} color="var(--warning)"
          sub={(shiftExpTotal > 0 || opTotals.total > 0)
            ? `Daily ${fmt(cards.expenses)}${shiftExpTotal ? ` · POS ${fmt(shiftExpTotal)}` : ""}${opTotals.total ? ` · Operating ${fmt(opTotals.total)}` : ""}`
            : undefined} />
        <SummaryCard label={`Operating Exp. (${scopeLabel})`} value={fmt(opTotals.total)} icon={Building2} color="var(--destructive)"
          sub={catSub(opTotals.byCat)} />
        <SummaryCard label={`Total Cash (${scopeLabel})`} value={fmt(cards.cash)} icon={Wallet} color="var(--accent)" />
      </div>

      {/* Per-person totals from the person_payments ledger (respect the Year + Month filter). */}
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase text-muted-foreground">
          By Person · {scopeLabel} <span className="normal-case font-normal text-muted-foreground">· from recorded payments</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryCard label="Total Junaid" value={fmt(personCards.junaid.total)} sub={methodSub(personCards.junaid.byMethod)} icon={User} color="var(--info)" />
          <SummaryCard label="Total Usama" value={fmt(personCards.usama.total)} sub={methodSub(personCards.usama.byMethod)} icon={User} color="var(--success)" />
          <SummaryCard label="Total Others" value={fmt(personCards.others.total)} sub={methodSub(personCards.others.byMethod)} icon={Users} color="var(--warning)" />
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

      {/* Two side-by-side ledgers: operating expenses + person payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Add Operating Expense */}
        <Card className="p-4 sm:p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4"><Building2 className="h-4 w-4" /> Add Operating Expense</h2>
          <div className="grid grid-cols-2 gap-3">
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
          <Button className="w-full mt-3" onClick={saveOp} disabled={savingOp}>
            {savingOp ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Add Operating Expense
          </Button>
        </Card>

        {/* Add Payment (Junaid / Usama / Other) */}
        <Card className="p-4 sm:p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4"><HandCoins className="h-4 w-4" /> Add Payment</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input type="date" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} />
            </Field>
            <Field label="Person">
              <Select value={payForm.person} onValueChange={(v) => setPayForm({ ...payForm, person: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PERSON_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {payForm.person === "Other" && (
              <Field label="Name">
                <Input value={payForm.customPerson} onChange={(e) => setPayForm({ ...payForm, customPerson: e.target.value })} placeholder="Mention the name" />
              </Field>
            )}
            <Field label="Amount">
              <Input type="number" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} placeholder="0" />
            </Field>
            <Field label="Payment Method">
              <Select value={payForm.payment_method} onValueChange={(v) => setPayForm({ ...payForm, payment_method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PAY_METHODS.map((m) => <SelectItem key={m} value={m}>{METHOD_LABEL[m] ?? m}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Notes">
              <Input value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} placeholder="optional" />
            </Field>
          </div>
          <Button className="w-full mt-3" onClick={savePay} disabled={savingPay}>
            {savingPay ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Record Payment
          </Button>
        </Card>
      </div>

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

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", easypaisa: "EasyPaisa", jazzcash: "JazzCash", card: "Card", bank: "Bank",
};

/** "Cash 5,000 · EasyPaisa 2,000" from a {method: amount} map, or undefined if empty. */
function methodSub(byMethod: Record<string, number>): string | undefined {
  const parts = Object.entries(byMethod)
    .filter(([, v]) => v > 0)
    .map(([m, v]) => `${METHOD_LABEL[m] ?? m} ${fmt(v)}`);
  return parts.length ? parts.join(" · ") : undefined;
}

/** "Rent 20,000 · Salary 15,000" from a {category: amount} map, or undefined if empty. */
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

function Field({ label, children, highlight }: { label: string; children: ReactNode; highlight?: boolean }) {
  return (
    <div>
      <Label className={`text-xs ${highlight ? "text-primary font-semibold" : ""}`}>{label}</Label>
      {children}
    </div>
  );
}
