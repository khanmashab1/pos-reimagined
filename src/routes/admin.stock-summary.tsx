import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, ArrowLeft, CheckCircle2, XCircle, Clock, Search, Pencil } from "lucide-react";
import { fmt } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/stock-summary")({
  component: AdminStockSummary,
});

interface StockEntry {
  id: string;
  product_id: string;
  cashier_id: string;
  cashier_name: string;
  product_name: string;
  barcode: string;
  qty: number;
  unit_name: string | null;
  qty_in_unit: number | null;
  notes: string;
  status: string;
  created_at: string;
  approved_by_name?: string;
  approved_at?: string;
  rejected_by_name?: string;
  rejected_at?: string;
  rejection_reason?: string;
  purchase_price?: number;
  sale_price?: number;
}


interface StockSummary {
  product_id: string;
  product_name: string;
  barcode: string;
  total_qty: number;
  entry_count: number;
  first_entry: string;
  last_entry: string;
}


type Tab = "pending" | "approved" | "rejected";

function fmtQty(entry: StockEntry): string {
  if (entry.qty_in_unit != null && entry.unit_name) {
    return `+${entry.qty_in_unit} ${entry.unit_name}`;
  }
  return `+${entry.qty}`;
}

function AdminStockSummary() {
  const { loading, user, role } = useAuth();
  const [entries, setEntries] = useState<StockEntry[]>([]);
  const [summary, setSummary] = useState<StockSummary[]>([]);
  const [tab, setTab] = useState<Tab>("pending");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dataLoading, setDataLoading] = useState(true);
  const [rejectTarget, setRejectTarget] = useState<StockEntry | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [priceTarget, setPriceTarget] = useState<StockEntry | null>(null);
  const [priceCost, setPriceCost] = useState("");
  const [priceSale, setPriceSale] = useState("");
  const [qtyTarget, setQtyTarget] = useState<StockEntry | null>(null);
  const [qtyValue, setQtyValue] = useState("");

  const openPriceEdit = (entry: StockEntry) => {
    setPriceTarget(entry);
    setPriceCost(String(entry.purchase_price ?? 0));
    setPriceSale(String(entry.sale_price ?? 0));
  };

  const openQtyEdit = (entry: StockEntry) => {
    setQtyTarget(entry);
    setQtyValue(String(entry.qty_in_unit != null ? entry.qty_in_unit : entry.qty));
  };

  const saveQty = async () => {
    if (!qtyTarget) return;
    const val = Number(qtyValue);
    if (!Number.isFinite(val) || val <= 0) {
      toast.error("Enter a valid quantity");
      return;
    }
    setActionLoading(true);
    let updates: { qty: number; qty_in_unit?: number } = { qty: val };
    if (qtyTarget.qty_in_unit != null && qtyTarget.qty_in_unit > 0) {
      const ratio = qtyTarget.qty / qtyTarget.qty_in_unit;
      updates = { qty: Math.round(val * ratio), qty_in_unit: val };
    }
    const { error } = await supabase
      .from("stock_entries")
      .update(updates)
      .eq("id", qtyTarget.id);
    setActionLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Updated qty for ${qtyTarget.product_name}`);
    setQtyTarget(null);
    fetchData();
  };

  const savePrices = async () => {
    if (!priceTarget) return;
    const cost = Number(priceCost);
    const sale = Number(priceSale);
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(sale) || sale < 0) {
      toast.error("Enter valid prices");
      return;
    }
    setActionLoading(true);
    const { error } = await supabase
      .from("products")
      .update({ purchase_price: cost, sale_price: sale })
      .eq("id", priceTarget.product_id);
    setActionLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Updated prices for ${priceTarget.product_name}`);
    setPriceTarget(null);
    fetchData();
  };


  useEffect(() => {
    if (role !== "admin") {
      window.location.href = "/pos";
      return;
    }
    fetchData();
  }, [role, tab, dateFrom, dateTo]);

  const fetchData = async () => {
    setDataLoading(true);
    try {
      let q = supabase
        .from("stock_entries")
        .select(
          "id, product_id, cashier_id, cashier_name, qty, unit_name, qty_in_unit, notes, status, created_at, approved_by_name, approved_at, rejected_by_name, rejected_at, rejection_reason",
        )
        .order("created_at", { ascending: false });

      q = q.eq("status", tab);

      if (dateFrom) {
        q = q.gte("created_at", `${dateFrom}T00:00:00`);
      }
      if (dateTo) {
        q = q.lte("created_at", `${dateTo}T23:59:59`);
      }

      const { data, error } = await q;

      if (error) {
        console.error("Error fetching stock entries:", error);
        return;
      }

      if (!data) return;

      const productIds = [...new Set(data.map((e) => e.product_id))];
      const { data: products } = await supabase
        .from("products")
        .select("id, name, barcode, purchase_price, sale_price")
        .in("id", productIds);

      const productMap = new Map(products?.map((p) => [p.id, p]) ?? []);

      const enriched = data.map((e) => ({
        ...e,
        product_name: productMap.get(e.product_id)?.name ?? "Unknown",
        barcode: productMap.get(e.product_id)?.barcode ?? "",
        purchase_price: productMap.get(e.product_id)?.purchase_price ?? 0,
        sale_price: productMap.get(e.product_id)?.sale_price ?? 0,
      })) as StockEntry[];


      setEntries(enriched);

      const summaryMap = new Map<string, StockSummary>();
      enriched.forEach((entry) => {
        const key = entry.product_id;
        if (!summaryMap.has(key)) {
          summaryMap.set(key, {
            product_id: entry.product_id,
            product_name: entry.product_name,
            barcode: entry.barcode,
            total_qty: 0,
            entry_count: 0,
            first_entry: entry.created_at,
            last_entry: entry.created_at,
          });
        }
        const s = summaryMap.get(key)!;
        s.total_qty += entry.qty;
        s.entry_count += 1;
        s.first_entry =
          new Date(entry.created_at) < new Date(s.first_entry) ? entry.created_at : s.first_entry;
        s.last_entry =
          new Date(entry.created_at) > new Date(s.last_entry) ? entry.created_at : s.last_entry;
      });

      setSummary(Array.from(summaryMap.values()).sort((a, b) => b.total_qty - a.total_qty));
    } finally {
      setDataLoading(false);
    }
  };

  const approve = async (entry: StockEntry) => {
    setActionLoading(true);
    const { error } = await supabase.rpc("approve_stock_entry", { _entry_id: entry.id });
    setActionLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${entry.product_name} ${fmtQty(entry)} approved · stock updated`);
    fetchData();
  };

  const approveAll = async () => {
    const pending = entries.filter((e) => e.status === "pending");
    if (pending.length === 0) return;
    if (!confirm(`Approve all ${pending.length} pending stock entries?`)) return;
    setActionLoading(true);
    const results = await Promise.all(
      pending.map((e) => supabase.rpc("approve_stock_entry", { _entry_id: e.id })),
    );
    setActionLoading(false);
    const errs = results.filter((r) => r.error);
    if (errs.length) toast.error(`${errs.length} failed · ${pending.length - errs.length} approved`);
    else toast.success(`Approved ${pending.length} entries · stock updated`);
    fetchData();
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    setActionLoading(true);
    const { error } = await supabase.rpc("reject_stock_entry", {
      _entry_id: rejectTarget.id,
      _reason: rejectReason,
    });
    setActionLoading(false);
    if (error) {
      toast.error(error.message);
      setRejectTarget(null);
      return;
    }
    toast.success(`${rejectTarget.product_name} +${rejectTarget.qty} rejected`);
    setRejectTarget(null);
    setRejectReason("");
    fetchData();
  };

  const TABS: { key: Tab; label: string; icon: typeof Clock }[] = [
    { key: "pending", label: "Pending", icon: Clock },
    { key: "approved", label: "Approved", icon: CheckCircle2 },
    { key: "rejected", label: "Rejected", icon: XCircle },
  ];

  const totals = useMemo(
    () => ({
      pending: entries.filter((e) => e.status === "pending").length,
      approved: entries.filter((e) => e.status === "approved").reduce((s, e) => s + e.qty, 0),
    }),
    [entries],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="border-b bg-card p-4">
        <div className="flex items-center gap-3 mb-4">
          <Button asChild variant="ghost" size="icon">
            <Link to="/admin/dashboard">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <h1 className="text-xl font-bold">Stock Entry Summary</h1>
        </div>

        <div className="flex gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="From"
            className="text-sm"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="To"
            className="text-sm"
          />
        </div>

        <div className="flex gap-1 mt-3">
          {TABS.map((t) => (
            <Button
              key={t.key}
              variant={tab === t.key ? "default" : "outline"}
              size="sm"
              onClick={() => setTab(t.key)}
              className="gap-1.5"
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </Button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4">
        {dataLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : tab === "pending" ? (
          <PendingView
            entries={entries}
            totals={totals}
            onApprove={approve}
            onApproveAll={approveAll}
            onReject={setRejectTarget}
            onEditPrices={openPriceEdit}
            onEditQty={openQtyEdit}
            actionLoading={actionLoading}
          />
        ) : (
          <HistoryView entries={entries} summary={summary} tab={tab} onEditPrices={openPriceEdit} />
        )}

      </div>

      <Dialog open={!!rejectTarget} onOpenChange={() => setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" /> Reject Stock Entry
            </DialogTitle>
          </DialogHeader>
          {rejectTarget && (
            <div className="space-y-3 py-2">
              <p className="text-sm">
                <strong>{rejectTarget.product_name}</strong> {fmtQty(rejectTarget)}
                <span className="text-muted-foreground ml-2">by {rejectTarget.cashier_name}</span>
              </p>
              <div>
                <Label>Reason for rejection</Label>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Required — explain why this entry was rejected"
                  rows={3}
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmReject}
              disabled={actionLoading || !rejectReason.trim()}
            >
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reject Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!priceTarget} onOpenChange={() => setPriceTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" /> Edit Prices
            </DialogTitle>
          </DialogHeader>
          {priceTarget && (
            <div className="space-y-3 py-2">
              <p className="text-sm">
                <strong>{priceTarget.product_name}</strong>
                <span className="text-muted-foreground ml-2">{priceTarget.barcode}</span>
              </p>
              <div>
                <Label>Cost (Purchase price)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceCost}
                  onChange={(e) => setPriceCost(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Sale price</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceSale}
                  onChange={(e) => setPriceSale(e.target.value)}
                  className="mt-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Updates the product's prices for all future sales.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceTarget(null)}>
              Cancel
            </Button>
            <Button onClick={savePrices} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function PendingView({
  entries,
  totals,
  onApprove,
  onApproveAll,
  onReject,
  onEditPrices,
  onEditQty,
  actionLoading,
}: {
  entries: StockEntry[];
  totals: { pending: number; approved: number };
  onApprove: (e: StockEntry) => void;
  onApproveAll: () => void;
  onReject: (e: StockEntry) => void;
  onEditPrices: (e: StockEntry) => void;
  onEditQty: (e: StockEntry) => void;
  actionLoading: boolean;
}) {

  const pending = entries.filter((e) => e.status === "pending");

  return (
    <div className="space-y-3 max-w-6xl">
      {pending.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card className="p-4 bg-amber-50 border-l-4 border-l-amber-500">
            <div className="text-sm text-muted-foreground">Pending Approvals</div>
            <div className="text-3xl font-bold text-amber-700">{pending.length}</div>
          </Card>
          <Card className="p-4 bg-blue-50 border-l-4 border-l-blue-500">
            <div className="text-sm text-muted-foreground">Total Units Pending</div>
            <div className="text-3xl font-bold text-blue-700">
              {pending.reduce((s, e) => s + e.qty, 0)}
            </div>
          </Card>
          <Card className="p-4 bg-green-50 border-l-4 border-l-green-500">
            <div className="text-sm text-muted-foreground">Approved Today</div>
            <div className="text-3xl font-bold text-green-700">{totals.approved}</div>
          </Card>
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={onApproveAll} disabled={actionLoading} className="bg-green-600 hover:bg-green-700">
            <CheckCircle2 className="h-4 w-4 mr-1" /> Approve All ({pending.length})
          </Button>
        </div>
      )}

      {pending.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500 opacity-50" />
          <p className="text-lg font-medium">All caught up!</p>
          <p className="text-sm">No pending stock entries to review.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted">
                <tr>
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">Product</th>
                  <th className="text-left p-3">Barcode</th>
                  <th className="text-left p-3">Cashier</th>
                  <th className="text-right p-3">Qty</th>
                  <th className="text-right p-3">Cost</th>
                  <th className="text-right p-3">Sale</th>
                  <th className="text-left p-3">Notes</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((entry) => (
                  <tr key={entry.id} className="border-b hover:bg-muted/50">
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                    <td className="p-3 font-medium">{entry.product_name}</td>
                    <td className="p-3 text-xs">{entry.barcode}</td>
                    <td className="p-3">{entry.cashier_name}</td>
                    <td className="p-3 text-right font-bold text-green-600">{fmtQty(entry)}</td>
                    <td className="p-3 text-right text-xs">{fmt(entry.purchase_price ?? 0)}</td>
                    <td className="p-3 text-right text-xs font-medium">
                      <button
                        onClick={() => onEditPrices(entry)}
                        className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                        title="Edit prices"
                      >
                        {fmt(entry.sale_price ?? 0)}
                        <Pencil className="h-3 w-3 opacity-60" />
                      </button>
                    </td>

                    <td className="p-3 text-xs text-muted-foreground truncate max-w-[120px]" title={entry.notes || undefined}>
                      {entry.notes || "-"}
                    </td>

                    <td className="p-3 text-right whitespace-nowrap">
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={() => onApprove(entry)}
                          disabled={actionLoading}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-destructive border-destructive/30 hover:bg-destructive/10"
                          onClick={() => onReject(entry)}
                          disabled={actionLoading}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function HistoryView({
  entries,
  summary,
  tab,
  onEditPrices,
}: {
  entries: StockEntry[];
  summary: StockSummary[];
  tab: string;
  onEditPrices: (e: StockEntry) => void;
}) {

  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? entries.filter(
        (e) =>
          e.product_name.toLowerCase().includes(search.toLowerCase()) ||
          e.cashier_name.toLowerCase().includes(search.toLowerCase()),
      )
    : entries;

  const totals = filtered.reduce(
    (a, e) => ({
      qty: a.qty + e.qty,
      count: a.count + 1,
    }),
    { qty: 0, count: 0 },
  );

  return (
    <div className="space-y-3 max-w-6xl">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4 bg-muted">
          <div className="text-sm text-muted-foreground">Total Entries</div>
          <div className="text-3xl font-bold">{totals.count}</div>
        </Card>
        <Card className="p-4 bg-muted">
          <div className="text-sm text-muted-foreground">
            Total Units {tab === "approved" ? "Added" : "Attempted"}
          </div>
          <div className="text-3xl font-bold">{totals.qty}</div>
        </Card>
        <Card className="p-4 bg-muted">
          <div className="text-sm text-muted-foreground">Unique Products</div>
          <div className="text-3xl font-bold">{summary.length}</div>
        </Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by product or cashier..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted">
              <tr>
                <th className="text-left p-3">Date & Time</th>
                <th className="text-left p-3">Product</th>
                <th className="text-left p-3">Barcode</th>
                <th className="text-left p-3">Cashier</th>
                <th className="text-right p-3">Qty</th>
                <th className="text-right p-3">Cost</th>
                <th className="text-right p-3">Sale</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Notes</th>
                {tab === "rejected" && <th className="text-left p-3">Reason</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={tab === "rejected" ? 10 : 9}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No entries found
                  </td>
                </tr>
              ) : (
                filtered.map((entry) => (
                  <tr key={entry.id} className="border-b hover:bg-muted/50">
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                    <td className="p-3 font-medium">{entry.product_name}</td>
                    <td className="p-3 text-xs">{entry.barcode}</td>
                    <td className="p-3">{entry.cashier_name}</td>
                    <td className="p-3 text-right font-bold text-green-600">{fmtQty(entry)}</td>
                    <td className="p-3 text-right text-xs">{fmt(entry.purchase_price ?? 0)}</td>
                    <td className="p-3 text-right text-xs font-medium">
                      <button
                        onClick={() => onEditPrices(entry)}
                        className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                        title="Edit prices"
                      >
                        {fmt(entry.sale_price ?? 0)}
                        <Pencil className="h-3 w-3 opacity-60" />
                      </button>
                    </td>


                    <td className="p-3">
                      {entry.status === "approved" ? (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-medium">
                          Approved{entry.approved_by_name ? ` by ${entry.approved_by_name}` : ""}
                        </span>
                      ) : (
                        <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded-full font-medium">
                          Rejected{entry.rejected_by_name ? ` by ${entry.rejected_by_name}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground max-w-[120px] truncate">
                      {entry.notes || "-"}
                    </td>
                    {tab === "rejected" && (
                      <td className="p-3 text-xs text-muted-foreground max-w-[150px] truncate">
                        {entry.rejection_reason || "-"}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
