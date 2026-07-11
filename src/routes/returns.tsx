import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  // Per-item override of the *unit* refund price (after proportional discount).
  // undefined = use computed effective price.
  const [refundOverride, setRefundOverride] = useState<Record<string, number | undefined>>({});
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [mySales, setMySales] = useState<any[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);

  async function loadMySales(uid: string) {
    setLoadingSales(true);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("sales")
      .select("id,bill_no,created_at,cashier_name,payment_type,items_count,discount,total")
      .eq("cashier_id", uid)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);
    setMySales(data ?? []);
    setLoadingSales(false);
  }

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate({ to: "/login" }); return; }
    loadMySales(user.id);
  }, [loading, user, navigate]);

  async function lookup(bn?: string) {
    const q = (bn ?? billNo).trim();
    if (!q) return;
    setBillNo(q);
    setSale(null); setItems([]); setReturnQty({}); setRefundOverride({});
    const { data: s } = await supabase.from("sales")
      .select("*").eq("bill_no", q).maybeSingle();
    if (!s) { toast.error("Bill not found"); return; }
    const { data: it } = await supabase.from("sale_items").select("*").eq("sale_id", s.id);
    setSale(s);
    setItems((it ?? []) as SaleItemRow[]);
    const qmap: Record<string, number> = {};
    (it ?? []).forEach((r: any) => qmap[r.id] = 0);
    setReturnQty(qmap);
    setRefundOverride({});
  }

  // Discount ratio derived from the original sale (cart-level discount spread
  // proportionally across item subtotals). Handles item- and cart-level combos:
  // if item-level pricing was already stored in unit_price, the remaining
  // cart-level discount still gets a fair proportional share here.
  const discountRatio = useMemo(() => {
    if (!sale) return 0;
    const sub = Number(sale.subtotal ?? 0);
    const disc = Number(sale.discount ?? 0);
    if (sub <= 0 || disc <= 0) return 0;
    return Math.min(1, disc / sub);
  }, [sale]);

  function effectiveUnitPrice(unitPrice: number) {
    return Number((unitPrice * (1 - discountRatio)).toFixed(2));
  }

  function unitRefund(it: SaleItemRow) {
    const ov = refundOverride[it.id];
    return ov !== undefined ? ov : effectiveUnitPrice(Number(it.unit_price));
  }

  function setQty(id: string, max: number, v: string) {
    let n = Math.max(0, Math.min(max, parseInt(v || "0")));
    if (isNaN(n)) n = 0;
    setReturnQty(p => ({ ...p, [id]: n }));
  }

  function setOverride(id: string, v: string) {
    if (v === "" || v === null) { setRefundOverride(p => ({ ...p, [id]: undefined })); return; }
    const n = Math.max(0, parseFloat(v));
    if (isNaN(n)) return;
    setRefundOverride(p => ({ ...p, [id]: n }));
  }

  const totalRefund = items.reduce((s, it) => s + (returnQty[it.id] || 0) * unitRefund(it), 0);
  const totalQty = items.reduce((s, it) => s + (returnQty[it.id] || 0), 0);

  async function submit() {
    if (!sale) return;
    if (totalQty === 0) { toast.error("Select at least one item"); return; }
    setSubmitting(true);
    const payload = items
      .filter(it => (returnQty[it.id] || 0) > 0)
      .map(it => {
        const qty = returnQty[it.id];
        const refPrice = unitRefund(it);
        return {
          product_id: it.product_id,
          product_name: it.product_name,
          barcode: it.barcode,
          qty,
          unit_price: refPrice,
          subtotal: Number((qty * refPrice).toFixed(2)),
          // extra for receipt (ignored by RPC)
          original_unit_price: Number(it.unit_price),
        };
      });
    const { data, error } = await supabase.rpc("process_return", {
      _sale_id: sale.id,
      _items: payload.map(({ original_unit_price, ...p }) => p),
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
      sale_subtotal: Number(sale.subtotal ?? 0),
      sale_discount: Number(sale.discount ?? 0),
      discount_ratio: discountRatio,
    });
    setSale(null); setItems([]); setReturnQty({}); setRefundOverride({}); setReason(""); setBillNo("");
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const discountPct = discountRatio > 0 ? (discountRatio * 100) : 0;

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

      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
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
            <Button onClick={() => lookup()} className="h-11"><Search className="h-4 w-4 mr-1" /> Lookup</Button>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">My Recent Sales</div>
            {loadingSales && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {mySales.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No sales yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-xs uppercase">
                  <tr>
                    <th className="text-left p-2">Bill #</th>
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Cashier</th>
                    <th className="text-left p-2">Payment</th>
                    <th className="text-right p-2">Items</th>
                    <th className="text-right p-2">Discount</th>
                    <th className="text-right p-2">Cash</th>
                    <th className="text-right p-2">Online</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {mySales.map((s) => {
                    const isCash = String(s.payment_type ?? "cash").toLowerCase() === "cash";
                    return (
                      <tr key={s.id} className="border-t hover:bg-muted/40">
                        <td className="p-2 font-mono">{s.bill_no}</td>
                        <td className="p-2 whitespace-nowrap">{new Date(s.created_at).toLocaleString()}</td>
                        <td className="p-2">{s.cashier_name}</td>
                        <td className="p-2 capitalize">{s.payment_type ?? "cash"}</td>
                        <td className="p-2 text-right">{s.items_count}</td>
                        <td className="p-2 text-right">{fmt(s.discount)}</td>
                        <td className="p-2 text-right text-green-700">{isCash ? fmt(s.total) : "-"}</td>
                        <td className="p-2 text-right text-blue-700">{!isCash ? fmt(s.total) : "-"}</td>
                        <td className="p-2 text-right">
                          <Button size="sm" variant="outline" onClick={() => lookup(s.bill_no)}>Select</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {sale && (
          <Card className="p-4 space-y-4">
            <div className="rounded-lg bg-muted px-4 py-3">
              <div className="font-mono font-semibold">{sale.bill_no}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(sale.created_at).toLocaleString()} · {sale.cashier_name}
              </div>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div><div className="text-muted-foreground">Subtotal</div><div className="font-semibold">{fmt(sale.subtotal)}</div></div>
                <div><div className="text-muted-foreground">Discount</div><div className="font-semibold text-orange-600">− {fmt(sale.discount)}{discountPct ? ` (${discountPct.toFixed(1)}%)` : ""}</div></div>
                <div><div className="text-muted-foreground">Paid Total</div><div className="font-semibold text-primary">{fmt(sale.total)}</div></div>
                <div><div className="text-muted-foreground">Payment</div><div className="font-semibold capitalize">{sale.payment_type}</div></div>
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
                        <th className="text-right p-3">Original</th>
                        <th className="text-right p-3">Discount</th>
                        <th className="text-right p-3">Paid / unit</th>
                        <th className="text-center p-3 w-24">Return Qty</th>
                        <th className="text-right p-3 w-36">Refund / unit</th>
                        <th className="text-right p-3">Refund</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(it => {
                        const orig = Number(it.unit_price);
                        const eff = effectiveUnitPrice(orig);
                        const perUnitDisc = orig - eff;
                        const refPrice = unitRefund(it);
                        const qty = returnQty[it.id] || 0;
                        const overridden = refundOverride[it.id] !== undefined;
                        return (
                          <tr key={it.id} className="border-t">
                            <td className="p-3">{it.product_name}</td>
                            <td className="text-right p-3">{it.qty}</td>
                            <td className="text-right p-3">{fmt(orig)}</td>
                            <td className="text-right p-3 text-orange-600">− {fmt(perUnitDisc)}</td>
                            <td className="text-right p-3 font-medium">{fmt(eff)}</td>
                            <td className="p-3 text-center">
                              <Input type="number" min={0} max={it.qty}
                                value={qty}
                                onChange={e => setQty(it.id, it.qty, e.target.value)}
                                className="w-20 mx-auto text-center" />
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-1 justify-end">
                                <Input type="number" min={0} step="0.01"
                                  value={refPrice}
                                  onChange={e => setOverride(it.id, e.target.value)}
                                  className={`w-24 text-right ${overridden ? "border-primary" : ""}`} />
                                {overridden && (
                                  <Button type="button" size="sm" variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setOverride(it.id, "")}>reset</Button>
                                )}
                              </div>
                            </td>
                            <td className="text-right p-3 font-semibold">
                              {fmt(qty * refPrice)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {items.map(it => {
                    const orig = Number(it.unit_price);
                    const eff = effectiveUnitPrice(orig);
                    const perUnitDisc = orig - eff;
                    const refPrice = unitRefund(it);
                    const qty = returnQty[it.id] || 0;
                    const overridden = refundOverride[it.id] !== undefined;
                    return (
                      <div key={it.id} className="rounded-lg border p-3 space-y-2">
                        <div className="font-medium text-sm">{it.product_name}</div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div><div className="text-muted-foreground">Original</div><div>{fmt(orig)}</div></div>
                          <div><div className="text-muted-foreground">Discount</div><div className="text-orange-600">− {fmt(perUnitDisc)}</div></div>
                          <div><div className="text-muted-foreground">Paid</div><div className="font-semibold">{fmt(eff)}</div></div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Label className="text-xs">Qty:</Label>
                            <div className="flex items-center">
                              <Button type="button" size="sm" variant="outline" className="h-9 w-9 p-0"
                                onClick={() => setQty(it.id, it.qty, String(qty - 1))}>−</Button>
                              <Input type="number" min={0} max={it.qty}
                                value={qty}
                                onChange={e => setQty(it.id, it.qty, e.target.value)}
                                className="w-14 h-9 mx-1 text-center" />
                              <Button type="button" size="sm" variant="outline" className="h-9 w-9 p-0"
                                onClick={() => setQty(it.id, it.qty, String(qty + 1))}>+</Button>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">of {it.qty}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs whitespace-nowrap">Refund / unit (Rs):</Label>
                          <Input type="number" min={0} step="0.01"
                            value={refPrice}
                            onChange={e => setOverride(it.id, e.target.value)}
                            className={`h-9 text-right ${overridden ? "border-primary" : ""}`} />
                          {overridden && (
                            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs"
                              onClick={() => setOverride(it.id, "")}>reset</Button>
                          )}
                        </div>
                        <div className="flex justify-between text-sm pt-1 border-t">
                          <span className="text-muted-foreground">Refund</span>
                          <span className="font-semibold">{fmt(qty * refPrice)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div>
                  <Label>Reason</Label>
                  <Input placeholder="Damaged, wrong item, etc." value={reason} onChange={e => setReason(e.target.value)} />
                </div>

                <p className="text-xs text-muted-foreground">
                  Refund defaults to the discounted price actually paid. You can override any Refund/unit for partial/damaged returns.
                </p>

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
