import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, RotateCcw, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fmt } from "@/lib/format";
import { ReturnReceipt } from "@/components/ReturnReceipt";

export const Route = createFileRoute("/returns")({
  component: CashierReturnsPage,
});

interface SaleItemRow {
  id: string; product_id: string | null; product_name: string;
  barcode: string; qty: number; unit_price: number; subtotal: number;
}

function CashierReturnsPage() {
  const { loading, user } = useAuth();
  const navigate = useNavigate();
  const [billNo, setBillNo] = useState("");
  const [sale, setSale] = useState<any>(null);
  const [items, setItems] = useState<SaleItemRow[]>([]);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [mySales, setMySales] = useState<any[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);

  async function loadMySales(uid: string) {
    setLoadingSales(true);
    const { data } = await supabase
      .from("sales")
      .select("id,bill_no,created_at,cashier_name,payment_type,items_count,discount,total")
      .eq("cashier_id", uid)
      .order("created_at", { ascending: false })
      .limit(50);
    setMySales(data ?? []);
    setLoadingSales(false);
  }

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

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
    toast.success(`Return ${res.return_no} submitted · awaiting admin approval`);
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
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-4 py-3 border-b bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent">
            <Link to="/pos"><ArrowLeft className="h-4 w-4 mr-1" /> POS</Link>
          </Button>
          <div className="font-bold flex items-center gap-2"><RotateCcw className="h-4 w-4" /> Returns</div>
        </div>
      </header>

      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
        <Card className="p-4">
          <div className="flex gap-2">
            <Input
              placeholder="Enter Bill Number (e.g. ZIC-20260504-0001)"
              value={billNo}
              onChange={e => setBillNo(e.target.value)}
              onKeyDown={e => e.key === "Enter" && lookup()}
              className="font-mono h-11"
              autoFocus
            />
            <Button onClick={lookup} className="h-11"><Search className="h-4 w-4 mr-1" /> Lookup</Button>
          </div>
        </Card>

        {sale && (
          <Card className="p-4 space-y-4">
            <div className="rounded-lg bg-muted px-4 py-3">
              <div className="font-mono font-semibold">{sale.bill_no}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(sale.created_at).toLocaleString()} · {sale.cashier_name} · Total {fmt(sale.total)}
              </div>
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No item details available for this bill.
              </p>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-xs uppercase">
                      <tr>
                        <th className="text-left p-3">Product</th>
                        <th className="text-right p-3">Sold</th>
                        <th className="text-right p-3">Price</th>
                        <th className="text-center p-3 w-28">Return</th>
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

                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {items.map(it => (
                    <div key={it.id} className="rounded-lg border p-3 space-y-2">
                      <div className="font-medium text-sm">{it.product_name}</div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Sold: {it.qty}</span>
                        <span>Price: {fmt(it.unit_price)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Label className="text-xs">Return:</Label>
                          <div className="flex items-center">
                            <Button type="button" size="sm" variant="outline" className="h-9 w-9 p-0"
                              onClick={() => setQty(it.id, it.qty, String((returnQty[it.id] || 0) - 1))}>−</Button>
                            <Input type="number" min={0} max={it.qty}
                              value={returnQty[it.id] ?? 0}
                              onChange={e => setQty(it.id, it.qty, e.target.value)}
                              className="w-14 h-9 mx-1 text-center" />
                            <Button type="button" size="sm" variant="outline" className="h-9 w-9 p-0"
                              onClick={() => setQty(it.id, it.qty, String((returnQty[it.id] || 0) + 1))}>+</Button>
                          </div>
                        </div>
                        <div className="text-sm font-semibold">
                          {fmt((returnQty[it.id] || 0) * Number(it.unit_price))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <Label>Reason</Label>
                  <Input placeholder="Damaged, wrong item, etc." value={reason} onChange={e => setReason(e.target.value)} />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t">
                  <div>
                    <div className="text-xs text-muted-foreground">Total Refund</div>
                    <div className="text-2xl font-bold text-primary">{fmt(totalRefund)}</div>
                  </div>
                  <Button onClick={submit} disabled={submitting || totalQty === 0} size="lg" className="w-full sm:w-auto">
                    {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    <RotateCcw className="h-4 w-4 mr-1" /> Submit Return
                  </Button>
                </div>
              </>
            )}
          </Card>
        )}
      </div>

      {receipt && <ReturnReceipt ret={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
