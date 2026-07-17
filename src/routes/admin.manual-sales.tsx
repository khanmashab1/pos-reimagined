import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { fmt, today } from "@/lib/format";
import { toast } from "sonner";
import { FileBarChart, Plus, Trash2, Save, Download, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/admin/manual-sales")({
  component: ManualSalesPage,
});

type Person = { id: string; name: string; sort_order: number; is_active: boolean };

// Per-person cash breakdown for a given day.
// `taken` = cash the person received/holds. `paid` = cash they paid out.
// Net contribution to cash-in-hand = taken - paid.
export type PersonCash = { taken: number; paid: number };

type Row = {
  id?: string;
  entry_date: string;
  cash_by_person: Record<string, PersonCash>;
  others: number;
  counter_cash: number;
  today_expenses_override: number | null;
  previous_expense_override: number | null;
  notes: string;
};

// Legacy rows stored a plain number per person. Normalize to {taken, paid}.
function normalizePersonCash(v: unknown): PersonCash {
  if (typeof v === "number") return { taken: Number(v) || 0, paid: 0 };
  if (v && typeof v === "object") {
    const o = v as any;
    return { taken: Number(o.taken) || 0, paid: Number(o.paid) || 0 };
  }
  return { taken: 0, paid: 0 };
}
const personNet = (p: PersonCash) => Number(p.taken || 0) - Number(p.paid || 0);

const emptyRow = (): Row => ({
  entry_date: today(),
  cash_by_person: {},
  others: 0, counter_cash: 0,
  today_expenses_override: null, previous_expense_override: null, notes: "",
});

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { fromISO: from.toISOString().slice(0, 10), toISO: to.toISOString().slice(0, 10) };
}

type Preset = "today" | "7d" | "30d" | "90d" | "year" | "month" | "custom";

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}


function ManualSalesPage() {
  const { fullName, user } = useAuth();
  const [preset, setPreset] = useState<Preset>("month");
  const [ym, setYm] = useState(() => today().slice(0, 7));
  const [customFrom, setCustomFrom] = useState(() => today());
  const [customTo, setCustomTo] = useState(() => today());
  const [persons, setPersons] = useState<Person[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [expensesByDay, setExpensesByDay] = useState<Record<string, number>>({});
  const [salesByDay, setSalesByDay] = useState<Record<string, number>>({});
  const [supplierPaid, setSupplierPaid] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Row>(emptyRow());
  const [saving, setSaving] = useState(false);
  const [personDialog, setPersonDialog] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");

  const range = useMemo(() => {
    const t = today();
    // toISO is exclusive upper bound
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

  async function loadPersons() {
    const { data } = await supabase.from("manual_sale_persons").select("*")
      .eq("is_active", true).order("sort_order").order("name");
    setPersons((data ?? []) as Person[]);
  }

  async function load() {
    setLoading(true);
    const { fromISO, toISO } = range;
    const [{ data: entries }, { data: op }, { data: de }, { data: se }, { data: sales }, { data: sp }] = await Promise.all([
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
        .gte("created_at", fromISO + "T00:00:00+05:00").lt("created_at", toISO + "T00:00:00+05:00"),
      supabase.from("supplier_payments").select("amount, payment_date")
        .gte("payment_date", fromISO).lt("payment_date", toISO),
    ]);
    setSupplierPaid(((sp ?? []) as any[]).reduce((a, r) => a + Number(r.amount || 0), 0));

    const ex: Record<string, number> = {};
    for (const r of (op ?? []) as any[]) ex[r.expense_date] = (ex[r.expense_date] ?? 0) + Number(r.amount || 0);
    for (const r of (de ?? []) as any[]) ex[r.expense_date] = (ex[r.expense_date] ?? 0) + Number(r.amount || 0);
    for (const r of (se ?? []) as any[]) {
      const d = String(r.created_at).slice(0, 10);
      ex[d] = (ex[d] ?? 0) + Number(r.amount || 0);
    }
    setExpensesByDay(ex);

    const sm: Record<string, number> = {};
    const tzFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" });
    for (const r of (sales ?? []) as any[]) {
      const d = tzFmt.format(new Date(r.created_at));
      sm[d] = (sm[d] ?? 0) + Number(r.total || 0);
    }
    setSalesByDay(sm);

    // Merge legacy fixed columns into cash_by_person for display.
    const mapped: Row[] = ((entries ?? []) as any[]).map((r) => {
      const raw = (r.cash_by_person ?? {}) as Record<string, unknown>;
      const cbp: Record<string, PersonCash> = {};
      for (const [k, v] of Object.entries(raw)) cbp[k] = normalizePersonCash(v);
      if (Number(r.cash_junaid) && cbp["Junaid"] == null) cbp["Junaid"] = { taken: Number(r.cash_junaid), paid: 0 };
      if (Number(r.cash_usama) && cbp["Usama"] == null) cbp["Usama"] = { taken: Number(r.cash_usama), paid: 0 };
      if (Number(r.cash_zahid) && cbp["Zahid Ali"] == null) cbp["Zahid Ali"] = { taken: Number(r.cash_zahid), paid: 0 };
      return {
        id: r.id, entry_date: r.entry_date, cash_by_person: cbp,
        others: Number(r.others || 0), counter_cash: Number(r.counter_cash || 0),
        today_expenses_override: r.today_expenses_override, previous_expense_override: r.previous_expense_override,
        notes: r.notes ?? "",
      };
    });
    setRows(mapped);
    setLoading(false);
  }

  useEffect(() => { loadPersons(); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range.fromISO, range.toISO]);

  const computed = useMemo(() => {
    let prevGrand = 0;
    return rows.map((r) => {
      const todayExp = r.today_expenses_override ?? expensesByDay[r.entry_date] ?? 0;
      const prevExp = r.previous_expense_override ?? prevGrand;
      const grandExp = Number(todayExp) + Number(prevExp);
      const personSum = Object.values(r.cash_by_person || {}).reduce((a, b) => a + personNet(b), 0);
      const personTaken = Object.values(r.cash_by_person || {}).reduce((a, b) => a + Number(b?.taken || 0), 0);
      const personPaid = Object.values(r.cash_by_person || {}).reduce((a, b) => a + Number(b?.paid || 0), 0);
      const totalCash = personSum + Number(r.others) + Number(r.counter_cash);
      const grandTotal = totalCash + grandExp;
      const previousTotal = prevGrand;
      const saleCalc = grandTotal - previousTotal;
      const salePos = salesByDay[r.entry_date] ?? 0;
      prevGrand = grandTotal;
      return { ...r, todayExp, prevExp, grandExp, personSum, personTaken, personPaid, totalCash, grandTotal, previousTotal, saleCalc, salePos };
    });
  }, [rows, expensesByDay, salesByDay]);

  const totals = useMemo(() => {
    const agg = computed.reduce((a, r) => ({
      sale: a.sale + r.saleCalc, pos: a.pos + r.salePos,
      expenses: a.expenses + r.todayExp,
    }), { sale: 0, pos: 0, expenses: 0 });
    // Cash in Hand = latest day's on-hand cash (persons + counter + others).
    // Summing across days would double-count cash carried forward.
    const last = computed[computed.length - 1];
    const cash = last ? last.totalCash : 0;
    return { ...agg, cash };
  }, [computed]);

  async function addPerson() {
    const name = newPersonName.trim();
    if (!name) return;
    const nextOrder = (persons.at(-1)?.sort_order ?? 0) + 1;
    const { error } = await supabase.from("manual_sale_persons").insert({ name, sort_order: nextOrder });
    if (error) { toast.error(error.message); return; }
    toast.success(`Added ${name}`);
    setNewPersonName("");
    loadPersons();
  }

  async function removePerson(p: Person) {
    if (!confirm(`Remove ${p.name} from the persons list? Existing entries keep their amounts.`)) return;
    const { error } = await supabase.from("manual_sale_persons").update({ is_active: false }).eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    loadPersons();
  }

  async function saveDraft() {
    if (!draft.entry_date) { toast.error("Pick a date"); return; }
    setSaving(true);
    const payload: any = {
      entry_date: draft.entry_date,
      cash_by_person: draft.cash_by_person,
      others: draft.others,
      counter_cash: draft.counter_cash,
      today_expenses_override: draft.today_expenses_override,
      previous_expense_override: draft.previous_expense_override,
      notes: draft.notes,
      created_by: user?.id ?? null,
      created_by_name: fullName ?? "",
      // Legacy columns kept in sync (net = taken - paid) so old reports still work
      cash_junaid: personNet(draft.cash_by_person["Junaid"] ?? { taken: 0, paid: 0 }),
      cash_usama: personNet(draft.cash_by_person["Usama"] ?? { taken: 0, paid: 0 }),
      cash_zahid: personNet(draft.cash_by_person["Zahid Ali"] ?? { taken: 0, paid: 0 }),
    };
    const { error } = await supabase.from("manual_sale_days").upsert(payload, { onConflict: "entry_date" });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    setDraft(emptyRow());
    load();
  }

  async function updateRow(row: Row, patch: Partial<Row>) {
    const merged = { ...row, ...patch };
    setRows((prev) => prev.map((r) => (r.id === row.id ? merged : r)));
    const upd: any = { ...patch };
    if (patch.cash_by_person) {
      upd.cash_junaid = personNet(patch.cash_by_person["Junaid"] ?? { taken: 0, paid: 0 });
      upd.cash_usama = personNet(patch.cash_by_person["Usama"] ?? { taken: 0, paid: 0 });
      upd.cash_zahid = personNet(patch.cash_by_person["Zahid Ali"] ?? { taken: 0, paid: 0 });
    }
    const { error } = await supabase.from("manual_sale_days").update(upd).eq("id", row.id!);
    if (error) toast.error(error.message);
  }

  async function delRow(row: Row) {
    if (!confirm(`Delete entry for ${row.entry_date}?`)) return;
    const { error } = await supabase.from("manual_sale_days").delete().eq("id", row.id!);
    if (error) { toast.error(error.message); return; }
    load();
  }

  // Persons that appear in any row this month (existing + active), for column set.
  const columnPersons = useMemo(() => {
    const set = new Set<string>(persons.map((p) => p.name));
    for (const r of rows) for (const k of Object.keys(r.cash_by_person || {})) set.add(k);
    return Array.from(set);
  }, [persons, rows]);

  function exportCSV() {
    const header = ["SR.No", "Date", ...columnPersons, "Others", "Counter Cash", "Today Expenses", "Previous Expense", "Grand Expenses", "Total Cash", "Grand Total", "Previous Total", "Sale", "POS Sale", "Notes"];
    const body = computed.map((r, i) => [
      i + 1, r.entry_date,
      ...columnPersons.map((n) => personNet(r.cash_by_person[n] ?? { taken: 0, paid: 0 })),
      r.others, r.counter_cash, r.todayExp, r.prevExp, r.grandExp, r.totalCash, r.grandTotal, r.previousTotal, r.saleCalc, r.salePos, r.notes,
    ]);
    const csv = [header, ...body].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `manual-sale-${range.fromISO}_to_${addDaysISO(range.toISO, -1)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // --- Draft: person rows editor ---
  const draftPersonEntries = Object.entries(draft.cash_by_person);
  const availableToAdd = persons.filter((p) => draft.cash_by_person[p.name] == null);

  function setDraftPerson(name: string, patch: Partial<PersonCash>) {
    const cur = draft.cash_by_person[name] ?? { taken: 0, paid: 0 };
    setDraft({ ...draft, cash_by_person: { ...draft.cash_by_person, [name]: { ...cur, ...patch } } });
  }
  function removeDraftPerson(name: string) {
    const cp = { ...draft.cash_by_person };
    delete cp[name];
    setDraft({ ...draft, cash_by_person: cp });
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileBarChart className="h-7 w-7" /> Manual Sale Report
          </h1>
          <p className="text-muted-foreground">Daily cash-in-hand ledger. Choose a person, enter their cash. Add new persons anytime.</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <Label>Range</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="year">This year</SelectItem>
                <SelectItem value="month">Month</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {preset === "month" && (
            <div>
              <Label>Month</Label>
              <Input type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
            </div>
          )}
          {preset === "custom" && (
            <>
              <div>
                <Label>From</Label>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </div>
              <div>
                <Label>To</Label>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            </>
          )}
          <Button variant="outline" onClick={() => setPersonDialog(true)}><Users className="h-4 w-4 mr-1" /> Persons</Button>
          <Button variant="outline" onClick={exportCSV} disabled={computed.length === 0}><Download className="h-4 w-4 mr-1" /> CSV</Button>
        </div>

      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Days" value={String(computed.length)} />
        <Stat label="Total Sale (ledger)" value={fmt(totals.sale)} accent="text-emerald-600" />
        <Stat label="System Sale (POS)" value={fmt(totals.pos)} accent="text-blue-600" />
        <Stat label="Today Expenses" value={fmt(totals.expenses)} accent="text-destructive" />
        <Stat label="System Expenses (Suppliers Paid)" value={fmt(supplierPaid)} accent="text-orange-600" />
        <Stat label="Cash in Hand" value={fmt(totals.cash)} accent="text-emerald-700" />
      </div>

      <Card className="p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Plus className="h-4 w-4" /> Add / Update Day</h2>
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 items-start">
          <div>
            <Label>Date</Label>
            <Input type="date" value={draft.entry_date} onChange={(e) => setDraft({ ...draft, entry_date: e.target.value })} />
          </div>
          <div>
            <Label>Cash by Person</Label>
            <div className="mt-2 space-y-2">
              {draftPersonEntries.length === 0 && (
                <p className="text-xs text-muted-foreground">No persons added yet for this day. Use the dropdown below.</p>
              )}
              {draftPersonEntries.map(([name, amt]) => (
                <div key={name} className="flex items-center gap-2">
                  <div className="w-40 font-medium text-sm">{name}</div>
                  <Input type="number" className="w-40" value={amt} onChange={(e) => setDraftPerson(name, Number(e.target.value) || 0)} />
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeDraftPerson(name)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <Select
                  value=""
                  onValueChange={(v) => {
                    if (v === "__add__") setPersonDialog(true);
                    else setDraftPerson(v, 0);
                  }}
                >
                  <SelectTrigger className="w-56"><SelectValue placeholder="+ Add person…" /></SelectTrigger>
                  <SelectContent>
                    {availableToAdd.map((p) => (
                      <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                    ))}
                    <SelectItem value="__add__"><span className="flex items-center gap-1"><UserPlus className="h-3 w-3" /> Add new person…</span></SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
          
          <div><Label>Counter Cash</Label><Input type="number" value={draft.counter_cash} onChange={(e) => setDraft({ ...draft, counter_cash: Number(e.target.value) || 0 })} /></div>
          <div><Label>Today Exp. (override)</Label><Input type="number" placeholder="auto" value={draft.today_expenses_override ?? ""} onChange={(e) => setDraft({ ...draft, today_expenses_override: e.target.value === "" ? null : Number(e.target.value) })} /></div>
        </div>


        <div className="mt-4 flex items-end gap-3">
          <div className="flex-1"><Label>Notes</Label><Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></div>
          <Button onClick={saveDraft} disabled={saving}><Save className="h-4 w-4 mr-1" /> Save Day</Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Saving an existing date overwrites that day.</p>
      </Card>

      <Card className="p-3">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted uppercase text-[10px]">
              <tr>
                <th className="p-2 text-left">#</th>
                <th className="p-2 text-left">Date</th>
                {columnPersons.map((n) => <th key={n} className="p-2 text-right">{n}</th>)}
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
                <tr><td colSpan={13 + columnPersons.length} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : computed.length === 0 ? (
                <tr><td colSpan={13 + columnPersons.length} className="p-8 text-center text-muted-foreground">No entries this month. Add one above.</td></tr>
              ) : computed.map((r, i) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-2">{i + 1}</td>
                  <td className="p-2 whitespace-nowrap">{r.entry_date}</td>
                  {columnPersons.map((n) => (
                    <td key={n} className="p-1 text-right">
                      <Input type="number" value={r.cash_by_person[n] ?? 0}
                        onChange={(e) => updateRow(r, { cash_by_person: { ...r.cash_by_person, [n]: Number(e.target.value) || 0 } })}
                        className="h-8 w-24 text-right font-mono" />
                    </td>
                  ))}
                  <td className="p-1 text-right">
                    <Input type="number" value={r.others} onChange={(e) => updateRow(r, { others: Number(e.target.value) || 0 })}
                      className="h-8 w-24 text-right font-mono" />
                  </td>
                  <td className="p-1 text-right">
                    <Input type="number" value={r.counter_cash} onChange={(e) => updateRow(r, { counter_cash: Number(e.target.value) || 0 })}
                      className="h-8 w-24 text-right font-mono" />
                  </td>
                  <td className="p-1 text-right">
                    <Input type="number" placeholder={String(expensesByDay[r.entry_date] ?? 0)}
                      value={r.today_expenses_override ?? ""}
                      onChange={(e) => updateRow(r, { today_expenses_override: e.target.value === "" ? null : Number(e.target.value) })}
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
          </table>
        </div>
      </Card>

      <Dialog open={personDialog} onOpenChange={setPersonDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Manage Persons</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {persons.map((p) => (
              <div key={p.id} className="flex items-center justify-between border rounded px-3 py-2">
                <span className="font-medium">{p.name}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removePerson(p)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {persons.length === 0 && <p className="text-sm text-muted-foreground">No persons yet.</p>}
          </div>
          <div className="flex items-end gap-2 pt-2 border-t">
            <div className="flex-1">
              <Label>New person name</Label>
              <Input value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)} placeholder="e.g. Ali Raza" />
            </div>
            <Button onClick={addPerson}><UserPlus className="h-4 w-4 mr-1" /> Add</Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPersonDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
