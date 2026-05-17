import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Search, FileBarChart, Eye, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/lib/format";
import { Receipt } from "@/components/Receipt";

export const Route = createFileRoute("/admin/reports")({
  component: ReportsPage,
});

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function ReportsPage() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(todayStr());
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<any>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;

  async function load() {
    setLoading(true);
    const fromIso = new Date(from + "T00:00:00").toISOString();
    const toIso = new Date(to + "T23:59:59.999").toISOString();
    const { data } = await supabase
      .from("sales")
      .select("*")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false });
    setSales(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    setPage(0);
  }, [search, from, to, paymentFilter]);

  useEffect(() => {
    load();
  }, []);

  const filtered = sales.filter(
    (s) =>
      (!search ||
        s.bill_no.toLowerCase().includes(search.toLowerCase()) ||
        s.cashier_name.toLowerCase().includes(search.toLowerCase())) &&
      (paymentFilter === "all" || s.payment_type === paymentFilter),
  );

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const totals = filtered.reduce(
    (acc, s) => ({
      total: acc.total + Number(s.total),
      bills: acc.bills + 1,
      items: acc.items + Number(s.items_count),
    }),
    { total: 0, bills: 0, items: 0 },
  );

  function exportCSV() {
    const rows = [
      [
        "Bill No",
        "Date",
        "Cashier",
        "Items",
        "Subtotal",
        "Discount",
        "Tax",
        "Total",
        "Cash",
        "Change",
        "Payment",
      ],
      ...filtered.map((s) => [
        s.bill_no,
        new Date(s.created_at).toISOString(),
        s.cashier_name,
        s.items_count,
        s.subtotal,
        s.discount,
        s.tax_amount,
        s.total,
        s.cash_received,
        s.change_returned,
        s.payment_type,
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function viewInvoice(s: any) {
    const { data: it } = await supabase.from("sale_items").select("*").eq("sale_id", s.id);
    setViewing({
      bill_no: s.bill_no,
      items: (it ?? []).map((r: any) => ({
        name: r.product_name,
        barcode: r.barcode,
        qty: r.qty,
        sale_price: Number(r.unit_price),
      })),
      subtotal: Number(s.subtotal),
      tax_amount: Number(s.tax_amount),
      discount: Number(s.discount),
      total: Number(s.total),
      cash_received: Number(s.cash_received),
      change_returned: Number(s.change_returned),
      cashier_name: s.cashier_name,
      created_at: s.created_at,
    });
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <FileBarChart className="h-7 w-7" /> Sales Reports
        </h1>
        <p className="text-muted-foreground">Filter, browse, and export invoices</p>
      </div>

      <Card className="p-5">
        <div className="grid md:grid-cols-[1fr_1fr_1.5fr_1fr_auto_auto] gap-3 items-end">
          <div>
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label>Search</Label>
            <Input
              placeholder="Bill no or cashier"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <Label>Payment</Label>
            <Select value={paymentFilter} onValueChange={setPaymentFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="easypasa">EasyPaisa</SelectItem>
                <SelectItem value="jazzcash">JazzCash</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={load} disabled={loading}>
            <Search className="h-4 w-4 mr-1" /> Apply
          </Button>
          <Button variant="outline" onClick={exportCSV} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-5">
          <Stat label="Total Sales" value={fmt(totals.total)} />
          <Stat label="Bills" value={String(totals.bills)} />
          <Stat label="Items Sold" value={String(totals.items)} />
        </div>
      </Card>

      <Card className="p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase">
              <tr>
                <th className="text-left p-3">Bill #</th>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Cashier</th>
                <th className="text-left p-3">Payment</th>
                <th className="text-right p-3">Items</th>
                <th className="text-right p-3">Discount</th>
                <th className="text-right p-3">Total</th>
                <th className="text-right p-3"></th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    No sales in this range.
                  </td>
                </tr>
              ) : (
                paginated.map((s) => (
                  <tr key={s.id} className="border-t hover:bg-muted/40">
                    <td className="font-mono p-3">{s.bill_no}</td>
                    <td className="p-3">{new Date(s.created_at).toLocaleString()}</td>
                    <td className="p-3">{s.cashier_name}</td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          s.payment_type === "cash"
                            ? "bg-green-100 text-green-800"
                            : s.payment_type === "card"
                              ? "bg-blue-100 text-blue-800"
                              : s.payment_type === "easypasa"
                                ? "bg-emerald-100 text-emerald-800"
                                : s.payment_type === "jazzcash"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {s.payment_type === "cash"
                          ? "Cash"
                          : s.payment_type === "card"
                            ? "Card"
                            : s.payment_type === "easypasa"
                              ? "EasyPaisa"
                              : s.payment_type === "jazzcash"
                                ? "JazzCash"
                                : (s.payment_type ?? "—")}
                      </span>
                    </td>
                    <td className="text-right p-3">{s.items_count}</td>
                    <td className="text-right p-3">{fmt(s.discount)}</td>
                    <td className="text-right p-3 font-semibold">{fmt(s.total)}</td>
                    <td className="text-right p-3">
                      <Button variant="ghost" size="sm" onClick={() => viewInvoice(s)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t">
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages} · {filtered.length} bills
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {viewing && <Receipt sale={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}
