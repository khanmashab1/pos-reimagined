import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ArrowLeft, Truck, Wallet, Receipt, Plus, Trash2, Phone, MapPin, Search, FileBarChart } from "lucide-react";
import { toast } from "sonner";
import { fmt } from "@/lib/format";

export const Route = createFileRoute("/suppliers")({
  component: SuppliersPage,
});

interface Supplier {
  id: string; name: string; phone: string; address: string; notes: string;
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
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

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

  const saveSupplier = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    setSaving(true);
    const { error } = await supabase.from("suppliers" as any).insert({
      name: form.name.trim(), phone: form.phone.trim(),
      address: form.address.trim(), notes: form.notes.trim(),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Supplier added");
    setAddOpen(false);
    setForm({ name: "", phone: "", address: "", notes: "" });
    load();
  };

  const totals = suppliers.reduce((a, s) => ({
    purchases: a.purchases + Number(s.total_purchases),
    paid: a.paid + Number(s.total_paid),
    balance: a.balance + Number(s.balance),
  }), { purchases: 0, paid: 0, balance: 0 });

  const filtered = search.trim()
    ? suppliers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.phone.includes(search))
    : suppliers;

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="flex flex-col min-h-screen bg-muted/30">
      {/* Header */}
      <header className="border-b bg-white shadow-sm px-6 py-4">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="rounded-full">
              <Link to="/pos"><ArrowLeft className="h-5 w-5" /></Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Truck className="h-5 w-5 text-primary" /> Suppliers
              </h1>
              <p className="text-xs text-muted-foreground">{fullName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="gap-2">
              <Link to="/suppliers/report"><FileBarChart className="h-4 w-4" /> View Report</Link>
            </Button>
            <Button onClick={() => setAddOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> New Supplier
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-6 max-w-5xl mx-auto w-full space-y-5">

        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="p-5 bg-white shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Total Bills</p>
            <p className="text-2xl font-bold text-foreground">{fmt(totals.purchases)}</p>
          </Card>
          <Card className="p-5 bg-white shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Total Paid</p>
            <p className="text-2xl font-bold text-green-600">{fmt(totals.paid)}</p>
          </Card>
          <Card className="p-5 bg-white shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Outstanding</p>
            <p className={`text-2xl font-bold ${totals.balance > 0 ? "text-red-600" : "text-green-600"}`}>{fmt(totals.balance)}</p>
          </Card>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9 bg-white shadow-sm"
            placeholder="Search suppliers by name or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Suppliers Table */}
        <Card className="bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground border-b">
                  <th className="text-left px-5 py-3">Supplier</th>
                  <th className="text-left px-5 py-3">Contact</th>
                  <th className="text-right px-5 py-3">Bills</th>
                  <th className="text-right px-5 py-3">Paid</th>
                  <th className="text-right px-5 py-3">Outstanding</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {busy ? (
                  <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">
                    <Truck className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    {search ? "No suppliers match your search." : "No suppliers yet. Add one to get started."}
                  </td></tr>
                ) : filtered.map(s => (
                  <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-foreground">{s.name}</div>
                      {s.address && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3" />{s.address}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {s.phone ? (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Phone className="h-3 w-3" />{s.phone}
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-5 py-4 text-right font-medium">{fmt(s.total_purchases)}</td>
                    <td className="px-5 py-4 text-right font-medium text-green-600">{fmt(s.total_paid)}</td>
                    <td className="px-5 py-4 text-right">
                      <span className={`font-bold ${Number(s.balance) > 0 ? "text-red-600" : "text-green-600"}`}>
                        {fmt(s.balance)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Button size="sm" variant="outline" onClick={() => setDetail(s)}>Manage</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Add Supplier Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Truck className="h-4 w-4" /> New Supplier</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Name <span className="text-red-500">*</span></Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Supplier name" /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="03xxxxxxxxx" /></div>
            <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="City / area" /></div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={saveSupplier} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Add Supplier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    // record_supplier_payment stamps created_by + the caller's open shift (session_id)
    // server-side, and a cash payment is auto-subtracted from the drawer at shift close.
    const { error } = await supabase.rpc("record_supplier_payment" as any, {
      _supplier_id: supplier.id,
      _amount: Number(paf.amount),
      _method: paf.method,
      _notes: paf.notes,
      _payment_date: paf.payment_date,
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" /> {supplier.name}
          </DialogTitle>
        </DialogHeader>

        {/* Balance Cards */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3 text-center bg-muted/30">
            <div className="text-xs uppercase text-muted-foreground font-semibold">Total Bills</div>
            <div className="text-lg font-bold mt-1">{fmt(totalP)}</div>
          </Card>
          <Card className="p-3 text-center bg-green-50">
            <div className="text-xs uppercase text-muted-foreground font-semibold">Total Paid</div>
            <div className="text-lg font-bold text-green-600 mt-1">{fmt(totalPa)}</div>
          </Card>
          <Card className={`p-3 text-center ${balance > 0 ? "bg-red-50" : "bg-green-50"}`}>
            <div className="text-xs uppercase text-muted-foreground font-semibold">Outstanding</div>
            <div className={`text-lg font-bold mt-1 ${balance > 0 ? "text-red-600" : "text-green-600"}`}>{fmt(balance)}</div>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b pb-0">
          <button
            onClick={() => setTab("purchase")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "purchase" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Receipt className="h-4 w-4" /> Purchases
          </button>
          <button
            onClick={() => setTab("payment")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "payment" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Wallet className="h-4 w-4" /> Payments
          </button>
        </div>

        {tab === "purchase" ? (
          <div className="space-y-4">
            <Card className="p-4 bg-muted/30 space-y-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Add Purchase</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Amount *</Label><Input type="number" value={pf.amount} onChange={e => setPf({ ...pf, amount: e.target.value })} placeholder="0.00" /></div>
                <div><Label className="text-xs">Date</Label><Input type="date" value={pf.purchase_date} onChange={e => setPf({ ...pf, purchase_date: e.target.value })} /></div>
                <div><Label className="text-xs">Bill #</Label><Input value={pf.bill_no} onChange={e => setPf({ ...pf, bill_no: e.target.value })} placeholder="optional" /></div>
                <div><Label className="text-xs">Description</Label><Input value={pf.description} onChange={e => setPf({ ...pf, description: e.target.value })} placeholder="optional" /></div>
              </div>
              <Button size="sm" className="w-full" onClick={addPurchase} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />} Add Purchase
              </Button>
            </Card>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {purchases.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No purchases recorded.</p>
              ) : purchases.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-3 border rounded-lg bg-white text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{fmt(p.amount)} <span className="text-xs text-muted-foreground font-normal">· {p.purchase_date}</span></div>
                    <div className="text-xs text-muted-foreground">{p.bill_no && `Bill #${p.bill_no} · `}{p.description || "—"}</div>
                  </div>
                  <button onClick={() => del("supplier_purchases", p.id)} className="text-red-400 hover:text-red-600 p-1 flex-shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Card className="p-4 bg-muted/30 space-y-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Record Payment</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Amount *</Label><Input type="number" value={paf.amount} onChange={e => setPaf({ ...paf, amount: e.target.value })} placeholder="0.00" /></div>
                <div><Label className="text-xs">Date</Label><Input type="date" value={paf.payment_date} onChange={e => setPaf({ ...paf, payment_date: e.target.value })} /></div>
                <div>
                  <Label className="text-xs">Method</Label>
                  <Select value={paf.method} onValueChange={v => setPaf({ ...paf, method: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash (from drawer)</SelectItem>
                      <SelectItem value="bank">Bank / Online</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Notes</Label><Input value={paf.notes} onChange={e => setPaf({ ...paf, notes: e.target.value })} placeholder="optional" /></div>
              </div>
              <p className="text-xs text-muted-foreground">Cash reduces the open drawer at shift close.</p>
              <Button size="sm" className="w-full" onClick={addPayment} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />} Record Payment
              </Button>
            </Card>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No payments recorded.</p>
              ) : payments.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-3 border rounded-lg bg-white text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-green-600">{fmt(p.amount)} <span className="text-xs text-muted-foreground font-normal">· {p.payment_date} · {p.method}</span></div>
                    {p.notes && <div className="text-xs text-muted-foreground">{p.notes}</div>}
                  </div>
                  <button onClick={() => del("supplier_payments", p.id)} className="text-red-400 hover:text-red-600 p-1 flex-shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
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