import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  ArrowLeft, Truck, Search, Download, Loader2, FileText, ArrowUpDown,
} from "lucide-react";
import { fmt, today } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/suppliers/report")({
  component: SupplierReportPage,
});

const num = (v: unknown) => Number(v) || 0;
const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", bank: "Bank", easypaisa: "EasyPaisa", jazzcash: "JazzCash", card: "Card",
};
const methodLabel = (m: string) => METHOD_LABEL[(m || "").toLowerCase()] ?? (m || "—");

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

interface Supplier { id: string; name: string; phone: string; }
interface Purchase { id: string; supplier_id: string; bill_no: string; amount: number; description: string; purchase_date: string; }
interface Payment { id: string; supplier_id: string; amount: number; method: string; notes: string; payment_date: string; created_by_name: string; }
interface Row { id: string; name: string; phone: string; bills: number; paid: number; outstanding: number; }
type SortKey = "bills" | "outstanding" | null;
type TabKey = "today" | "week" | "month" | "all" | "custom";

const DATE_TABS: { key: TabKey; label: string }[] = [
  { key: "today", label: "Today" }, { key: "week", label: "This Week" },
  { key: "month", label: "This Month" }, { key: "all", label: "All Time" },
];
const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDMY = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}-${MONTHS_ABBR[Number(m) - 1] ?? m}-${y}`;
};
function rangeFor(tab: TabKey): { from: string; to: string } {
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const t = today();
  if (tab === "week") { const d = new Date(); d.setDate(d.getDate() - 6); return { from: ymd(d), to: t }; }
  if (tab === "month") return { from: monthStart(), to: t };
  if (tab === "all") return { from: "2000-01-01", to: t };
  return { from: t, to: t };
}

function SupplierReportPage() {
  const [tab, setTab] = useState<TabKey>("today");
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [supplierId, setSupplierId] = useState("all");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("bills");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [drawer, setDrawer] = useState<Row | null>(null);

  async function load(f = from, t = to) {
    setLoading(true);
    const [{ data: sup }, { data: pur }, { data: pay }] = await Promise.all([
      supabase.from("suppliers" as any).select("id,name,phone").order("name"),
      supabase.from("supplier_purchases" as any)
        .select("id,supplier_id,bill_no,amount,description,purchase_date")
        .gte("purchase_date", f).lte("purchase_date", t),
      supabase.from("supplier_payments" as any)
        .select("id,supplier_id,amount,method,notes,payment_date,created_by_name")
        .gte("payment_date", f).lte("payment_date", t),
    ]);
    setSuppliers(((sup as any) ?? []) as Supplier[]);
    setPurchases(((pur as any) ?? []) as Purchase[]);
    setPayments(((pay as any) ?? []) as Payment[]);
    setLoading(false);
  }

  function pickTab(t: TabKey) {
    const r = rangeFor(t);
    setTab(t); setFrom(r.from); setTo(r.to);
    load(r.from, r.to);
  }

  // initial load (defaults to Today)
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const rows = useMemo<Row[]>(() => {
    const purBy: Record<string, number> = {};
    const payBy: Record<string, number> = {};
    for (const p of purchases) purBy[p.supplier_id] = (purBy[p.supplier_id] ?? 0) + num(p.amount);
    for (const p of payments) payBy[p.supplier_id] = (payBy[p.supplier_id] ?? 0) + num(p.amount);
    let list = suppliers
      .map((s) => ({
        id: s.id, name: s.name, phone: s.phone,
        bills: purBy[s.id] ?? 0, paid: payBy[s.id] ?? 0,
        outstanding: (purBy[s.id] ?? 0) - (payBy[s.id] ?? 0),
      }))
      .filter((r) => r.bills > 0 || r.paid > 0); // only suppliers with activity in the period
    if (supplierId !== "all") list = list.filter((r) => r.id === supplierId);
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const d = a[sortKey] - b[sortKey];
        return sortDir === "asc" ? d : -d;
      });
    }
    return list;
  }, [suppliers, purchases, payments, supplierId, sortKey, sortDir]);

  const supName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "—";

  // Latest payment date per supplier (within range), for the "Last paid" line.
  const lastPaid = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of payments) if (!m[p.supplier_id] || p.payment_date > m[p.supplier_id]) m[p.supplier_id] = p.payment_date;
    return m;
  }, [payments]);

  // Today's payments (for the Today banner).
  const todaysPayments = useMemo(() => payments.filter((p) => p.payment_date === today()), [payments]);

  const totals = useMemo(
    () => rows.reduce(
      (a, r) => ({ bills: a.bills + r.bills, paid: a.paid + r.paid, outstanding: a.outstanding + r.outstanding }),
      { bills: 0, paid: 0, outstanding: 0 },
    ),
    [rows],
  );

  const toggleSort = (k: Exclude<SortKey, null>) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  function exportExcel() {
    const wb = XLSX.utils.book_new();

    // Sheet 1 — Supplier Summary
    const s1 = rows.map((r) => ({
      Supplier: r.name, Phone: r.phone,
      "Bill Amount": r.bills, "Paid Amount": r.paid, Outstanding: r.outstanding,
    }));
    s1.push({ Supplier: "TOTAL", Phone: "", "Bill Amount": totals.bills, "Paid Amount": totals.paid, Outstanding: totals.outstanding });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s1), "Supplier Summary");

    // Sheet 2 — All Transactions
    const nameOf = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "—";
    const scope = (id: string) => supplierId === "all" || supplierId === id;
    const tx = [
      ...purchases.filter((p) => scope(p.supplier_id)).map((p) => ({
        Date: p.purchase_date, Supplier: nameOf(p.supplier_id), Type: "Bill",
        Amount: num(p.amount), Method: "", "Recorded By": "", Reference: p.bill_no || p.description || "",
      })),
      ...payments.filter((p) => scope(p.supplier_id)).map((p) => ({
        Date: p.payment_date, Supplier: nameOf(p.supplier_id), Type: "Payment",
        Amount: num(p.amount), Method: methodLabel(p.method), "Recorded By": p.created_by_name || "", Reference: p.notes || "",
      })),
    ].sort((a, b) => a.Date.localeCompare(b.Date));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tx), "All Transactions");

    // Sheet 3 — Per-Supplier Ledger (running balance)
    const ledger: Record<string, any>[] = [];
    for (const s of suppliers) {
      if (!scope(s.id)) continue;
      const events = [
        ...purchases.filter((p) => p.supplier_id === s.id).map((p) => ({ date: p.purchase_date, type: "Bill", amount: num(p.amount), ref: p.bill_no || p.description || "", method: "", by: "" })),
        ...payments.filter((p) => p.supplier_id === s.id).map((p) => ({ date: p.payment_date, type: "Payment", amount: num(p.amount), ref: p.notes || "", method: methodLabel(p.method), by: p.created_by_name || "" })),
      ].sort((a, b) => a.date.localeCompare(b.date));
      if (events.length === 0) continue;
      let bal = 0;
      ledger.push({ Supplier: s.name, Date: "", Type: "", Amount: "", Method: "", "Recorded By": "", Reference: "", Balance: "" });
      for (const e of events) {
        bal += e.type === "Bill" ? e.amount : -e.amount;
        ledger.push({ Supplier: "", Date: e.date, Type: e.type, Amount: e.amount, Method: e.method, "Recorded By": e.by, Reference: e.ref, Balance: bal });
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ledger.length ? ledger : [{ Note: "No transactions in range" }]), "Per-Supplier Ledger");

    XLSX.writeFile(wb, `ZICMart-Suppliers-${from}-to-${to}.xlsx`);
  }

  const SortHead = ({ k, children }: { k: Exclude<SortKey, null>; children: React.ReactNode }) => (
    <th className="px-4 py-3 text-right">
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground">
        {children} <ArrowUpDown className={`h-3 w-3 ${sortKey === k ? "text-primary" : "opacity-40"}`} />
      </button>
    </th>
  );

  return (
    <div className="flex flex-col min-h-screen bg-muted/30">
      <header className="border-b bg-white shadow-sm px-4 sm:px-6 py-4">
        <div className="flex items-center justify-between max-w-6xl mx-auto gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button asChild variant="ghost" size="icon" className="rounded-full">
              <Link to="/suppliers"><ArrowLeft className="h-5 w-5" /></Link>
            </Button>
            <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2 truncate">
              <Truck className="h-5 w-5 text-primary" /> Supplier Payments Report
            </h1>
          </div>
          <Button onClick={exportExcel} className="gap-2 shrink-0" disabled={loading || rows.length === 0}>
            <Download className="h-4 w-4" /> <span className="hidden sm:inline">Export Excel</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-6 max-w-6xl mx-auto w-full space-y-5">
        {/* Quick date tabs */}
        <div className="flex flex-wrap gap-2">
          {DATE_TABS.map((t) => (
            <Button key={t.key} size="sm" variant={tab === t.key ? "default" : "outline"} onClick={() => pickTab(t.key)}>
              {t.label}
            </Button>
          ))}
        </div>

        {/* Filters */}
        <Card className="p-4 bg-white shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_1.5fr_auto] gap-3 items-end">
            <div><Label className="text-xs">From Date</Label><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setTab("custom"); }} /></div>
            <div><Label className="text-xs">To Date</Label><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setTab("custom"); }} /></div>
            <div>
              <Label className="text-xs">Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Suppliers</SelectItem>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => load()} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Apply Filter
            </Button>
          </div>
        </Card>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="p-5 bg-white shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Total Bills</p>
            <p className="text-xl sm:text-2xl font-bold break-words">{fmt(totals.bills)}</p>
          </Card>
          <Card className="p-5 bg-white shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Total Paid</p>
            <p className="text-xl sm:text-2xl font-bold text-green-600 break-words">{fmt(totals.paid)}</p>
          </Card>
          <Card className="p-5 bg-white shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Outstanding</p>
            <p className={`text-xl sm:text-2xl font-bold break-words ${totals.outstanding > 0 ? "text-red-600" : "text-green-600"}`}>{fmt(totals.outstanding)}</p>
          </Card>
        </div>

        {/* Today's activity banner */}
        {tab === "today" && (
          <Card className="p-4 bg-green-50 border-green-200 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-800 mb-2">Today's Payments</p>
            {todaysPayments.length === 0 ? (
              <p className="text-sm text-green-900/70">No payments recorded today.</p>
            ) : (
              <div className="space-y-1 text-sm">
                {todaysPayments.map((p) => (
                  <div key={p.id} className="text-green-900">
                    <span className="font-medium">{supName(p.supplier_id)}</span> — {fmt(p.amount)} · {methodLabel(p.method)}
                    {p.created_by_name ? ` · by ${p.created_by_name}` : ""}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Main table */}
        <Card className="bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground border-b">
                <tr>
                  <th className="text-left px-4 py-3">Supplier</th>
                  <th className="text-left px-4 py-3">Phone</th>
                  <SortHead k="bills">Bill Amount</SortHead>
                  <th className="px-4 py-3 text-right">Paid Amount</th>
                  <SortHead k="outstanding">Outstanding</SortHead>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No supplier activity in this period.</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-semibold">
                      {r.name}
                      {lastPaid[r.id] && <div className="text-[11px] font-normal text-muted-foreground">Last paid: {fmtDMY(lastPaid[r.id])}</div>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.phone || "—"}</td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(r.bills)}</td>
                    <td className="px-4 py-3 text-right font-medium text-green-600">{fmt(r.paid)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${r.outstanding > 0 ? "text-red-600 bg-red-50" : "text-green-600"}`}>{fmt(r.outstanding)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => setDrawer(r)}>
                        <FileText className="h-3.5 w-3.5 mr-1" /> Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {!loading && rows.length > 0 && (
                <tfoot>
                  <tr className="bg-primary/10 font-bold border-t-2">
                    <td className="px-4 py-3" colSpan={2}>Totals</td>
                    <td className="px-4 py-3 text-right">{fmt(totals.bills)}</td>
                    <td className="px-4 py-3 text-right text-green-700">{fmt(totals.paid)}</td>
                    <td className={`px-4 py-3 text-right ${totals.outstanding > 0 ? "text-red-700" : "text-green-700"}`}>{fmt(totals.outstanding)}</td>
                    <td className="px-4 py-3"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      </div>

      {/* Details drawer */}
      <Sheet open={!!drawer} onOpenChange={(o) => { if (!o) setDrawer(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          {drawer && <DrawerBody row={drawer} from={from} to={to}
            bills={purchases.filter((p) => p.supplier_id === drawer.id)}
            pays={payments.filter((p) => p.supplier_id === drawer.id)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DrawerBody({ row, from, to, bills, pays }: {
  row: Row; from: string; to: string; bills: Purchase[]; pays: Payment[];
}) {
  const totalBilled = bills.reduce((s, b) => s + num(b.amount), 0);
  const totalPaid = pays.reduce((s, p) => s + num(p.amount), 0);
  const balance = totalBilled - totalPaid;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2"><Truck className="h-5 w-5 text-primary" /> {row.name}</SheetTitle>
      </SheetHeader>
      <p className="text-xs text-muted-foreground mt-1">{row.phone || "—"} · {from} → {to}</p>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Bills (Purchases)</div>
        {bills.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center">No bills in range.</p>
        ) : (
          <div className="space-y-1.5">
            {[...bills].sort((a, b) => a.purchase_date.localeCompare(b.purchase_date)).map((b) => (
              <div key={b.id} className="flex items-start justify-between gap-2 p-2.5 rounded-lg bg-yellow-50 border border-yellow-100 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{b.bill_no ? `#${b.bill_no}` : "Bill"} <span className="text-xs text-muted-foreground">· {b.purchase_date}</span></div>
                  {b.description && <div className="text-xs text-muted-foreground">{b.description}</div>}
                </div>
                <div className="font-semibold shrink-0">{fmt(b.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Payments Made</div>
        {pays.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center">No payments in range.</p>
        ) : (
          <div className="space-y-1.5">
            {[...pays].sort((a, b) => a.payment_date.localeCompare(b.payment_date)).map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-2 p-2.5 rounded-lg bg-green-50 border border-green-100 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{methodLabel(p.method)} <span className="text-xs text-muted-foreground">· {p.payment_date}</span></div>
                  <div className="text-xs text-muted-foreground">{p.created_by_name || "—"}{p.notes ? ` · ${p.notes}` : ""}</div>
                </div>
                <div className="font-semibold text-green-700 shrink-0">{fmt(p.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 border-t pt-3 space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Total Billed</span><span className="font-semibold">{fmt(totalBilled)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Total Paid</span><span className="font-semibold text-green-700">{fmt(totalPaid)}</span></div>
        <div className="flex justify-between text-base font-bold">
          <span>Balance Due</span>
          <span className={balance > 0 ? "text-red-600" : "text-green-600"}>{fmt(balance)}</span>
        </div>
      </div>
    </>
  );
}
