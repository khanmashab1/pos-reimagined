import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Wallet, Receipt, Truck, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { fmt } from "@/lib/format";

export const Route = createFileRoute("/admin/suppliers")({
  component: SuppliersPage,
});

interface Supplier {
  id: string; name: string; phone: string; address: string; notes: string;
  total_purchases: number; total_paid: number; balance: number;
}
interface BillRow {
  id: string; amount: number; bill_no: string; description: string;
  purchase_date: string; supplier_id: string; created_at?: string;
  created_by_name?: string;
}

function SuppliersPage() {
  const [items, setItems] = useState<Supplier[]>([]);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", address: "", notes: "" });
  const [detail, setDetail] = useState<Supplier | null>(null);
  const [billSearch, setBillSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: bd }] = await Promise.all([
      supabase.rpc("get_suppliers_summary" as any),
      supabase.from("supplier_purchases" as any).select("*")
        .order("created_at", { ascending: false }).limit(300),
    ]);
    if (error) toast.error(error.message);
    setItems(((data as any) ?? []) as Supplier[]);
    setBills(((bd as any) ?? []) as BillRow[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm({ name: "", phone: "", address: "", notes: "" }); setOpen(true); };
  const openEdit = (s: Supplier) => {
    setEditing(s); setForm({ name: s.name, phone: s.phone, address: s.address, notes: s.notes }); setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Name required");
    if (editing) {
      const { error } = await supabase.from("suppliers" as any).update(form).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Updated");
    } else {
      const { error } = await supabase.from("suppliers" as any).insert(form);
      if (error) return toast.error(error.message);
      toast.success("Supplier added");
    }
    setOpen(false); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this supplier and all its records?")) return;
    const { error } = await supabase.from("suppliers" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  };

  const totals = items.reduce((acc, s) => ({
    purchases: acc.purchases + Number(s.total_purchases),
    paid: acc.paid + Number(s.total_paid),
    balance: acc.balance + Number(s.balance),
  }), { purchases: 0, paid: 0, balance: 0 });

  return (
    <div className="p-4 pt-16 md:p-8 md:pt-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pl-12 md:pl-0">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Suppliers</h1>
          <p className="text-muted-foreground text-sm">{items.length} suppliers</p>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Add Supplier</Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3"><div className="text-[11px] uppercase text-muted-foreground">Total Purchases</div><div className="text-lg font-bold">{fmt(totals.purchases)}</div></Card>
        <Card className="p-3"><div className="text-[11px] uppercase text-muted-foreground">Total Paid</div><div className="text-lg font-bold text-success">{fmt(totals.paid)}</div></Card>
        <Card className="p-3"><div className="text-[11px] uppercase text-muted-foreground">Outstanding</div><div className="text-lg font-bold text-destructive">{fmt(totals.balance)}</div></Card>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm text-center py-12">Loading…</p>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground"><Truck className="h-8 w-8 mx-auto mb-2 opacity-50" />No suppliers yet.</Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(s => (
            <Card key={s.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{s.name}</div>
                  {s.phone && <div className="text-xs text-muted-foreground">{s.phone}</div>}
                  {s.address && <div className="text-xs text-muted-foreground truncate">{s.address}</div>}
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t">
                <div><div className="text-[10px] uppercase text-muted-foreground">Bills</div><div className="text-sm font-semibold">{fmt(s.total_purchases)}</div></div>
                <div><div className="text-[10px] uppercase text-muted-foreground">Paid</div><div className="text-sm font-semibold text-success">{fmt(s.total_paid)}</div></div>
                <div><div className="text-[10px] uppercase text-muted-foreground">Left</div><div className={`text-sm font-bold ${Number(s.balance) > 0 ? "text-destructive" : "text-success"}`}>{fmt(s.balance)}</div></div>
              </div>
              <Button variant="outline" size="sm" className="w-full" onClick={() => setDetail(s)}>Manage</Button>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit" : "Add"} Supplier</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {detail && <SupplierDetail supplier={detail} onClose={() => { setDetail(null); load(); }} />}
    </div>
  );
}

interface Entry { id: string; amount: number; created_at: string; }
interface Purchase extends Entry { bill_no: string; description: string; purchase_date: string; }
interface Payment extends Entry { method: string; notes: string; payment_date: string; }

function SupplierDetail({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [tab, setTab] = useState<"purchase" | "payment">("purchase");
  const [pf, setPf] = useState({ amount: "", bill_no: "", description: "", purchase_date: new Date().toISOString().slice(0, 10) });
  const [paf, setPaf] = useState({ amount: "", method: "cash", notes: "", payment_date: new Date().toISOString().slice(0, 10) });

  const load = async () => {
    const [{ data: p }, { data: pa }] = await Promise.all([
      supabase.from("supplier_purchases" as any).select("*").eq("supplier_id", supplier.id).order("purchase_date", { ascending: false }),
      supabase.from("supplier_payments" as any).select("*").eq("supplier_id", supplier.id).order("payment_date", { ascending: false }),
    ]);
    setPurchases(((p as any) ?? []) as Purchase[]);
    setPayments(((pa as any) ?? []) as Payment[]);
  };
  useEffect(() => { load(); }, [supplier.id]);

  const totalP = purchases.reduce((s, x) => s + Number(x.amount), 0);
  const totalPa = payments.reduce((s, x) => s + Number(x.amount), 0);
  const balance = totalP - totalPa;

  const addPurchase = async () => {
    if (!pf.amount) return toast.error("Amount required");
    const { data: { user } } = await supabase.auth.getUser();
    const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user!.id).maybeSingle();
    const { error } = await supabase.from("supplier_purchases" as any).insert({
      supplier_id: supplier.id,
      amount: Number(pf.amount),
      bill_no: pf.bill_no, description: pf.description, purchase_date: pf.purchase_date,
      created_by: user!.id, created_by_name: prof?.full_name ?? "",
    });
    if (error) return toast.error(error.message);
    toast.success("Purchase added");
    setPf({ amount: "", bill_no: "", description: "", purchase_date: new Date().toISOString().slice(0, 10) });
    load();
  };

  const addPayment = async () => {
    if (!paf.amount) return toast.error("Amount required");
    // record_supplier_payment stamps created_by + the caller's open shift (if any) server-side.
    const { error } = await supabase.rpc("record_supplier_payment" as any, {
      _supplier_id: supplier.id,
      _amount: Number(paf.amount),
      _method: paf.method,
      _notes: paf.notes,
      _payment_date: paf.payment_date,
    });
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
          <DialogTitle className="flex items-center gap-2"><Truck className="h-5 w-5" /> {supplier.name}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          <Card className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Bills</div><div className="font-bold">{fmt(totalP)}</div></Card>
          <Card className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Paid</div><div className="font-bold text-success">{fmt(totalPa)}</div></Card>
          <Card className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Left</div><div className={`font-bold ${balance > 0 ? "text-destructive" : "text-success"}`}>{fmt(balance)}</div></Card>
        </div>

        <div className="flex gap-1 border-b">
          <Button size="sm" variant={tab === "purchase" ? "default" : "ghost"} onClick={() => setTab("purchase")}><Receipt className="h-3.5 w-3.5 mr-1" /> Purchases</Button>
          <Button size="sm" variant={tab === "payment" ? "default" : "ghost"} onClick={() => setTab("payment")}><Wallet className="h-3.5 w-3.5 mr-1" /> Payments</Button>
        </div>

        {tab === "purchase" ? (
          <div className="space-y-3">
            <Card className="p-3 space-y-2 bg-muted/40">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Amount *</Label><Input type="number" step="0.01" value={pf.amount} onChange={e => setPf({ ...pf, amount: e.target.value })} /></div>
                <div><Label className="text-xs">Date</Label><Input type="date" value={pf.purchase_date} onChange={e => setPf({ ...pf, purchase_date: e.target.value })} /></div>
                <div><Label className="text-xs">Bill #</Label><Input value={pf.bill_no} onChange={e => setPf({ ...pf, bill_no: e.target.value })} /></div>
                <div><Label className="text-xs">Description</Label><Input value={pf.description} onChange={e => setPf({ ...pf, description: e.target.value })} /></div>
              </div>
              <Button size="sm" className="w-full" onClick={addPurchase}><Plus className="h-3.5 w-3.5 mr-1" /> Add Purchase</Button>
            </Card>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {purchases.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">No purchases.</p> : purchases.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2 border rounded text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{fmt(p.amount)} <span className="text-xs text-muted-foreground">· {p.purchase_date}</span></div>
                    <div className="text-xs text-muted-foreground truncate">{p.bill_no && `#${p.bill_no} · `}{p.description || "—"}</div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => del("supplier_purchases", p.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Card className="p-3 space-y-2 bg-muted/40">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Amount *</Label><Input type="number" step="0.01" value={paf.amount} onChange={e => setPaf({ ...paf, amount: e.target.value })} /></div>
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
                <div><Label className="text-xs">Notes</Label><Input value={paf.notes} onChange={e => setPaf({ ...paf, notes: e.target.value })} /></div>
              </div>
              <Button size="sm" className="w-full" onClick={addPayment}><Plus className="h-3.5 w-3.5 mr-1" /> Add Payment</Button>
            </Card>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {payments.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">No payments.</p> : payments.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2 border rounded text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-success">{fmt(p.amount)} <span className="text-xs text-muted-foreground">· {p.payment_date} · {p.method}</span></div>
                    {p.notes && <div className="text-xs text-muted-foreground truncate">{p.notes}</div>}
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => del("supplier_payments", p.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter><Button variant="outline" onClick={onClose}><ArrowLeft className="h-4 w-4 mr-1" /> Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
