import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ArrowLeft, Truck, Wallet, Receipt, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fmt } from "@/lib/format";

export const Route = createFileRoute("/suppliers")({
  component: SuppliersPage,
});

interface Supplier {
  id: string; name: string; phone: string; address: string;
  total_purchases: number; total_paid: number; balance: number;
}
interface Purchase { id: string; amount: number; bill_no: string; description: string; purchase_date: string; }
interface Payment  { id: string; amount: number; method: string; notes: string; payment_date: string; }

function SuppliersPage() {
  const { loading, user, fullName } = useAuth();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [busy, setBusy] = useState(true);
  const [detail, setDetail] = useState<Supplier | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  const load = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("get_suppliers_summary" as any);
    if (error) toast.error(error.message);
    setSuppliers(((data as any) ?? []) as Supplier[]);
    setBusy(false);
  };
  useEffect(() => { load(); }, []);

  const totals = suppliers.reduce((a, s) => ({
    purchases: a.purchases + Number(s.total_purchases),
    paid: a.paid + Number(s.total_paid),
    balance: a.balance + Number(s.balance),
  }), { purchases: 0, paid: 0, balance: 0 });

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="border-b bg-card p-4 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link to="/pos"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Truck className="h-5 w-5" /> Suppliers</h1>
          <p className="text-xs text-muted-foreground">{fullName}</p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 max-w-3xl mx-auto w-full space-y-4">
        {/* Totals */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3 border-l-4 border-l-blue-500">
            <div className="text-xs text-muted-foreground">Total Bills</div>
            <div className="text-lg font-bold">{fmt(totals.purchases)}</div>
          </Card>
          <Card className="p-3 border-l-4 border-l-green-500">
            <div className="text-xs text-muted-foreground">Total Paid</div>
            <div className="text-lg font-bold text-green-600">{fmt(totals.paid)}</div>
          </Card>
          <Card className="p-3 border-l-4 border-l-red-500">
            <div className="text-xs text-muted-foreground">Outstanding</div>
            <div className="text-lg font-bold text-red-600">{fmt(totals.balance)}</div>
          </Card>
        </div>

        {/* Suppliers list */}
        {busy ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : suppliers.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <Truck className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No suppliers found.
          </Card>
        ) : (
          <div className="space-y-3">
            {suppliers.map(s => (
              <Card key={s.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{s.name}</div>
                    {s.phone && <div className="text-xs text-muted-foreground">{s.phone}</div>}
                    {s.address && <div className="text-xs text-muted-foreground truncate">{s.address}</div>}
                  </div>
                  <Button size="sm" onClick={() => setDetail(s)}>Manage</Button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center mt-3 pt-3 border-t">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Bills</div>
                    <div className="text-sm font-semibold">{fmt(s.total_purchases)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Paid</div>
                    <div className="text-sm font-semibold text-green-600">{fmt(s.total_paid)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Left</div>
                    <div className={`text-sm font-bold ${Number(s.balance) > 0 ? "text-red-600" : "text-green-600"}`}>{fmt(s.balance)}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {detail && <SupplierDetail supplier={detail} onClose={() => { setDetail(null); load(); }} />}
    </div>
  );
}

function SupplierDetail({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [payments, setPayments]   = useState<Payment[]>([]);
  const [tab, setTab] = useState<"purchase" | "payment">("purchase");
  const [pf,  setPf]  = useState({ amount: "", bill_no: "", description: "", purchase_date: new Date().toISOString().slice(0, 10) });
  const [paf, setPaf] = useState({ amount: "", method: "cash", notes: "", payment_date: new Date().toISOString().slice(0, 10) });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [{ data: p }, { data: pa }] = await Promise.all([
      supabase.from("supplier_purchases" as any).select("*").eq("supplier_id", supplier.id).order("purchase_date", { ascending: false }),
      supabase.from("supplier_payments"  as any).select("*").eq("supplier_id", supplier.id).order("payment_date",  { ascending: false }),
    ]);
    setPurchases(((p as any) ?? []) as Purchase[]);
    setPayments(((pa as any)  ?? []) as Payment[]);
  };
  useEffect(() => { load(); }, [supplier.id]);

  const totalP  = purchases.reduce((s, x) => s + Number(x.amount), 0);
  const totalPa = payments.reduce((s, x)  => s + Number(x.amount), 0);
  const balance = totalP - totalPa;

  const addPurchase = async () => {
    if (!pf.amount) return toast.error("Amount required");
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user!.id).maybeSingle();
    const { error } = await supabase.from("supplier_purchases" as any).insert({
      supplier_id: supplier.id, amount: Number(pf.amount),
      bill_no: pf.bill_no, description: pf.description, purchase_date: pf.purchase_date,
      created_by: user!.id, created_by_name: prof?.full_name ?? "",
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Purchase added");
    setPf({ amount: "", bill_no: "", description: "", purchase_date: new Date().toISOString().slice(0, 10) });
    load();
  };

  const addPayment = async () => {
    if (!paf.amount) return toast.error("Amount required");
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user!.id).maybeSingle();
    const { error } = await supabase.from("supplier_payments" as any).insert({
      supplier_id: supplier.id, amount: Number(paf.amount),
      method: paf.method, notes: paf.notes, payment_date: paf.payment_date,
      created_by: user!.id, created_by_name: prof?.full_name ?? "",
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Payment recorded");
    setPaf({ amount: "", method: "cash", notes: "", payment_date: new Date().toISOString().slice(0, 10) });
    load();
  };

  const del = async (table: string, id: string) => {
    if (!confirm("Delete this entry?")) return;
    const { error } = await supabase.from(table as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Truck className="h-5 w-5" /> {supplier.name}</DialogTitle>
        </DialogHeader>

        {/* Balances */}
        <div className="grid grid-cols-3 gap-2">
          <Card className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Bills</div><div className="font-bold text-sm">{fmt(totalP)}</div></Card>
          <Card className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Paid</div><div className="font-bold text-sm text-green-600">{fmt(totalPa)}</div></Card>
          <Card className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Left</div><div className={`font-bold text-sm ${balance > 0 ? "text-red-600" : "text-green-600"}`}>{fmt(balance)}</div></Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          <Button size="sm" variant={tab === "purchase" ? "default" : "ghost"} onClick={() => setTab("purchase")}>
            <Receipt className="h-3.5 w-3.5 mr-1" /> Purchases
          </Button>
          <Button size="sm" variant={tab === "payment" ? "default" : "ghost"} onClick={() => setTab("payment")}>
            <Wallet className="h-3.5 w-3.5 mr-1" /> Payments
          </Button>
        </div>

        {tab === "purchase" ? (
          <div className="space-y-3">
            <Card className="p-3 space-y-2 bg-muted/40">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Amount *</Label><Input type="number" value={pf.amount} onChange={e => setPf({ ...pf, amount: e.target.value })} /></div>
                <div><Label className="text-xs">Date</Label><Input type="date" value={pf.purchase_date} onChange={e => setPf({ ...pf, purchase_date: e.target.value })} /></div>
                <div><Label className="text-xs">Bill #</Label><Input value={pf.bill_no} onChange={e => setPf({ ...pf, bill_no: e.target.value })} /></div>
                <div><Label className="text-xs">Description</Label><Input value={pf.description} onChange={e => setPf({ ...pf, description: e.target.value })} /></div>
              </div>
              <Button size="sm" className="w-full" onClick={addPurchase} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />} Add Purchase
              </Button>
            </Card>
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {purchases.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">No purchases yet.</p> : purchases.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2 border rounded text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{fmt(p.amount)} <span className="text-xs text-muted-foreground">· {p.purchase_date}</span></div>
                    <div className="text-xs text-muted-foreground truncate">{p.bill_no && `#${p.bill_no} · `}{p.description || "—"}</div>
                  </div>
                  <button onClick={() => del("supplier_purchases", p.id)} className="text-red-500 hover:text-red-700 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Card className="p-3 space-y-2 bg-muted/40">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Amount *</Label><Input type="number" value={paf.amount} onChange={e => setPaf({ ...paf, amount: e.target.value })} /></div>
                <div><Label className="text-xs">Date</Label><Input type="date" value={paf.payment_date} onChange={e => setPaf({ ...paf, payment_date: e.target.value })} /></div>
                <div><Label className="text-xs">Method</Label><Input value={paf.method} onChange={e => setPaf({ ...paf, method: e.target.value })} placeholder="cash / bank" /></div>
                <div><Label className="text-xs">Notes</Label><Input value={paf.notes} onChange={e => setPaf({ ...paf, notes: e.target.value })} /></div>
              </div>
              <Button size="sm" className="w-full" onClick={addPayment} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />} Record Payment
              </Button>
            </Card>
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {payments.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">No payments yet.</p> : payments.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2 border rounded text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-green-600">{fmt(p.amount)} <span className="text-xs text-muted-foreground">· {p.payment_date} · {p.method}</span></div>
                    {p.notes && <div className="text-xs text-muted-foreground truncate">{p.notes}</div>}
                  </div>
                  <button onClick={() => del("supplier_payments", p.id)} className="text-red-500 hover:text-red-700 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}