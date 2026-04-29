import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, RotateCcw, Printer, CheckCircle2, Ban, Clock } from "lucide-react";
import { toast } from "sonner";
import { fmt } from "@/lib/format";
import { ReturnReceipt } from "@/components/ReturnReceipt";

export const Route = createFileRoute("/admin/returns")({
  component: ReturnsPage,
});

interface SaleItemRow {
  id: string; product_id: string | null; product_name: string;
  barcode: string; qty: number; unit_price: number; subtotal: number;
}

type Status = "pending" | "approved" | "voided";

function StatusBadge({ status }: { status: Status }) {
  if (status === "approved") return <Badge className="bg-success text-success-foreground"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>;
  if (status === "voided") return <Badge variant="destructive"><Ban className="h-3 w-3 mr-1" />Voided</Badge>;
  return <Badge className="bg-warning text-warning-foreground"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
}

function ReturnsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [billNo, setBillNo] = useState("");
  const [sale, setSale] = useState<any>(null);
  const [items, setItems] = useState<SaleItemRow[]>([]);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [receipt, setReceipt] = useState<any>(null);
  const [viewing, setViewing] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");

  useEffect(() => { loadHistory(); }, []);

  async function loadHistory() {
    const { data } = await supabase.from("returns")
      .select("*").order("created_at", { ascending: false }).limit(200);
    setHistory(data ?? []);
  }

  async function lookup() {
    if (!billNo.trim()) return;
    setSale(null); setItems([]); setReturnQty({});
    const { data: s } = await supabase.from("sales")
      .select("*").eq("bill_no", billNo.trim()).maybeSingle();
    if (!s) { toast.error("Bill not found"); return; }
    const { data: it } = await supabase.from("sale_items").select("*").eq("sale_id", s.id);
    setSale(s);
    setItems((it ?? []) as SaleItemRow[]);
    const q: Record<string, number> = {};
    (it ?? []).forEach((r: any) => q[r.id] = 0);
    setReturnQty(q);
  }

  function setQty(id: string, max: number, v: string) {
    let n = Math.max(0, Math.min(max, parseInt(v || "0")));
    if (isNaN(n)) n = 0;
    setReturnQty(p => ({ ...p, [id]: n }));
  }

  const totalRefund = items.reduce((s, it) => s + (returnQty[it.id] || 0) * Number(it.unit_price), 0);
  const totalQty = items.reduce((s, it) => s + (returnQty[it.id] || 0), 0);

  async function submit() {
    if (!sale) return;
    if (totalQty === 0) { toast.error("Select at least one item"); return; }
    setSubmitting(true);
    const payload = items
      .filter(it => (returnQty[it.id] || 0) > 0)
      .map(it => ({
        product_id: it.product_id,
        product_name: it.product_name,
        barcode: it.barcode,
        qty: returnQty[it.id],
        unit_price: Number(it.unit_price),
        subtotal: returnQty[it.id] * Number(it.unit_price),
      }));
    const { data, error } = await supabase.rpc("process_return", {
      _sale_id: sale.id,
      _items: payload,
      _reason: reason,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    const res = data as any;
    toast.success(`Return ${res.return_no} created · awaiting admin approval`);
    setReceipt({
      return_no: res.return_no,
      original_bill_no: sale.bill_no,
      reason,
      items: payload,
      refund_amount: res.refund,
      cashier_name: sale.cashier_name,
      created_at: new Date().toISOString(),
      status: "pending",
    });
    setSale(null); setItems([]); setReturnQty({}); setReason(""); setBillNo("");
    loadHistory();
  }

  async function approve(r: any) {
    const { error } = await supabase.rpc("approve_return", { _return_id: r.id });
    if (error) { toast.error(error.message); return; }
    toast.success(`Approved ${r.return_no} · stock restored`);
    loadHistory();
  }

  async function confirmVoid() {
    if (!voidTarget) return;
    const { error } = await supabase.rpc("void_return", {
      _return_id: voidTarget.id, _reason: voidReason,
    });
    if (error) { toast.error(error.message); setVoidTarget(null); return; }
    toast.success(`${voidTarget.return_no} voided`);
    const r = voidTarget;
    const { data: ri } = await supabase.from("return_items").select("*").eq("return_id", r.id);
    setReceipt({
      return_no: r.return_no,
      original_bill_no: r.original_bill_no,
      reason: r.reason,
      items: ri ?? [],
      refund_amount: r.refund_amount,
      cashier_name: r.cashier_name,
      created_at: r.created_at,
      status: "voided",
      void_reason: voidReason,
      voided_at: new Date().toISOString(),
    });
    setVoidTarget(null); setVoidReason("");
    loadHistory();
  }

  async function viewReturn(r: any) {
    const { data: ri } = await supabase.from("return_items").select("*").eq("return_id", r.id);
    setViewing({
      return_no: r.return_no,
      original_bill_no: r.original_bill_no,
      reason: r.reason,
      items: ri ?? [],
      refund_amount: r.refund_amount,
      cashier_name: r.cashier_name,
      created_at: r.created_at,
      status: r.status,
      void_reason: r.void_reason,
      voided_at: r.voided_at,
      approved_by_name: r.approved_by_name,
      approved_at: r.approved_at,
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter(r => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.return_no?.toLowerCase().includes(q) ||
        r.original_bill_no?.toLowerCase().includes(q) ||
        r.cashier_name?.toLowerCase().includes(q)
      );
    });
  }, [history, search, statusFilter]);

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><RotateCcw className="h-7 w-7" /> Returns</h1>
        <p className="text-muted-foreground">Process refunds. Stock is restored only after admin approval.</p>
      </div>

      <Card className="p-5">
        <div className="flex gap-2 mb-4">
          <Input placeholder="Enter Bill Number (e.g. ZIC-20260429-0001)" value={billNo}
            onChange={e => setBillNo(e.target.value)}
            onKeyDown={e => e.key === "Enter" && lookup()}
            className="font-mono" />
          <Button onClick={lookup}><Search className="h-4 w-4 mr-1" /> Lookup</Button>
        </div>

        {sale && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
              <div>
                <div className="font-mono font-semibold">{sale.bill_no}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(sale.created_at).toLocaleString()} · {sale.cashier_name} · Total {fmt(sale.total)}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-xs uppercase">
                  <tr>
                    <th className="text-left p-3">Product</th>
                    <th className="text-right p-3">Sold Qty</th>
                    <th className="text-right p-3">Unit Price</th>
                    <th className="text-center p-3 w-32">Return Qty</th>
                    <th className="text-right p-3">Refund</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it.id} className="border-t">
                      <td className="p-3">{it.product_name}</td>
                      <td className="text-right p-3">{it.qty}</td>
                      <td className="text-right p-3">{fmt(it.unit_price)}</td>
                      <td className="p-3 text-center">
                        <Input type="number" min={0} max={it.qty}
                          value={returnQty[it.id] ?? 0}
                          onChange={e => setQty(it.id, it.qty, e.target.value)}
                          className="w-20 mx-auto text-center" />
                      </td>
                      <td className="text-right p-3 font-semibold">
                        {fmt((returnQty[it.id] || 0) * Number(it.unit_price))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Reason for Return</Label>
                <Input placeholder="Damaged, wrong item, etc." value={reason} onChange={e => setReason(e.target.value)} />
              </div>
              <div className="flex items-end justify-end gap-4">
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Total Refund</div>
                  <div className="text-2xl font-bold">{fmt(totalRefund)}</div>
                </div>
                <Button onClick={submit} disabled={submitting || totalQty === 0} size="lg">
                  <RotateCcw className="h-4 w-4 mr-1" /> Submit for Approval
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <h3 className="font-semibold">Returns</h3>
          <div className="flex gap-2 flex-1 md:max-w-xl md:ml-auto">
            <Input
              placeholder="Search by return #, bill #, or cashier"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="flex gap-1">
              {(["all", "pending", "approved", "voided"] as const).map(s => (
                <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm"
                  onClick={() => setStatusFilter(s)} className="capitalize">{s}</Button>
              ))}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No returns match your filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase">
                <tr>
                  <th className="text-left p-3">Return #</th>
                  <th className="text-left p-3">Original Bill</th>
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">Cashier</th>
                  <th className="text-right p-3">Items</th>
                  <th className="text-right p-3">Refund</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="font-mono p-3">{r.return_no}</td>
                    <td className="font-mono p-3">{r.original_bill_no}</td>
                    <td className="p-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="p-3">{r.cashier_name}</td>
                    <td className="text-right p-3">{r.items_count}</td>
                    <td className="text-right p-3 font-semibold">{fmt(r.refund_amount)}</td>
                    <td className="p-3"><StatusBadge status={r.status} /></td>
                    <td className="text-right p-3 whitespace-nowrap">
                      {isAdmin && r.status === "pending" && (
                        <Button variant="ghost" size="sm" onClick={() => approve(r)} title="Approve">
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        </Button>
                      )}
                      {isAdmin && r.status !== "voided" && (
                        <Button variant="ghost" size="sm" onClick={() => setVoidTarget(r)} title="Void">
                          <Ban className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => viewReturn(r)} title="View receipt">
                        <Printer className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {receipt && <ReturnReceipt ret={receipt} onClose={() => setReceipt(null)} />}
      {viewing && <ReturnReceipt ret={viewing} onClose={() => setViewing(null)} />}

      <AlertDialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void return {voidTarget?.return_no}?</AlertDialogTitle>
            <AlertDialogDescription>
              {voidTarget?.status === "approved"
                ? "This will reverse the stock restoration and mark the return as voided."
                : "This will mark the pending return as voided. No stock changes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label>Reason (optional)</Label>
            <Input value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Customer changed mind, error, etc." />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmVoid} className="bg-destructive text-destructive-foreground">
              Void Return
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
