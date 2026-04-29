import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, Search, Printer } from "lucide-react";
import { toast } from "sonner";
import { fmt } from "@/lib/format";
import { BarcodeLabel } from "@/components/BarcodeLabel";

export const Route = createFileRoute("/admin/products")({
  component: ProductsPage,
});

interface Product {
  id: string; barcode: string; name: string; category_id: string | null;
  purchase_price: number; sale_price: number; stock: number; min_stock_alert: number; is_active: boolean;
}
interface Cat { id: string; name: string; }

const empty: Omit<Product, "id"> = {
  barcode: "", name: "", category_id: null,
  purchase_price: 0, sale_price: 0, stock: 0, min_stock_alert: 5, is_active: true,
};

function genBarcode() {
  return "ZIC" + Date.now().toString().slice(-9) + Math.floor(Math.random() * 10);
}

function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<Omit<Product, "id">>(empty);
  const [printing, setPrinting] = useState<Product | null>(null);

  const load = async () => {
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("products").select("*").order("created_at", { ascending: false }),
      supabase.from("categories").select("id,name").order("name"),
    ]);
    setItems((p ?? []) as Product[]);
    setCats((c ?? []) as Cat[]);
  };
  useEffect(() => { load(); }, []);

  const filtered = items.filter(p => {
    if (filter !== "all" && p.category_id !== filter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.barcode.includes(search)) return false;
    return true;
  });

  const openNew = () => { setForm({ ...empty, barcode: genBarcode() }); setEditing(null); setOpen(true); };
  const openEdit = (p: Product) => { setForm(p); setEditing(p); setOpen(true); };

  const save = async () => {
    if (!form.name.trim() || !form.barcode.trim()) return toast.error("Name and barcode are required");
    const payload = {
      ...form,
      purchase_price: Number(form.purchase_price),
      sale_price: Number(form.sale_price),
      stock: Number(form.stock),
      min_stock_alert: Number(form.min_stock_alert),
    };
    if (editing) {
      const { error } = await supabase.from("products").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Product updated");
    } else {
      const { error } = await supabase.from("products").insert(payload);
      if (error) return toast.error(error.message);
      toast.success("Product added");
    }
    setOpen(false); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  };

  const stockBadge = (p: Product) => {
    if (p.stock === 0) return <Badge variant="destructive">Out</Badge>;
    if (p.stock <= p.min_stock_alert) return <Badge className="bg-warning text-warning-foreground">Low ({p.stock})</Badge>;
    return <Badge className="bg-success text-success-foreground">{p.stock}</Badge>;
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Products</h1>
          <p className="text-muted-foreground">{items.length} items in catalog</p>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Add Product</Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by name or barcode" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {cats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Product</th>
                <th className="text-left px-4 py-3">Barcode</th>
                <th className="text-right px-4 py-3">Cost</th>
                <th className="text-right px-4 py-3">Price</th>
                <th className="text-center px-4 py-3">Stock</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center text-muted-foreground py-10">No products found.</td></tr>
              )}
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{cats.find(c => c.id === p.category_id)?.name ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{p.barcode}</td>
                  <td className="px-4 py-3 text-right">{fmt(p.purchase_price)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{fmt(p.sale_price)}</td>
                  <td className="px-4 py-3 text-center">{stockBadge(p)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setPrinting(p)} title="Print barcode"><Printer className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit" : "Add"} Product</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Product Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Barcode</Label>
              <div className="flex gap-2">
                <Input value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} />
                <Button type="button" variant="outline" onClick={() => setForm({ ...form, barcode: genBarcode() })}>Gen</Button>
              </div>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.category_id ?? "none"} onValueChange={v => setForm({ ...form, category_id: v === "none" ? null : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {cats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Purchase Price</Label><Input type="number" step="0.01" value={form.purchase_price} onChange={e => setForm({ ...form, purchase_price: +e.target.value })} /></div>
            <div><Label>Sale Price</Label><Input type="number" step="0.01" value={form.sale_price} onChange={e => setForm({ ...form, sale_price: +e.target.value })} /></div>
            <div><Label>Stock</Label><Input type="number" value={form.stock} onChange={e => setForm({ ...form, stock: +e.target.value })} /></div>
            <div><Label>Low Stock Alert</Label><Input type="number" value={form.min_stock_alert} onChange={e => setForm({ ...form, min_stock_alert: +e.target.value })} /></div>
            <div className="col-span-2 text-sm text-muted-foreground">
              Profit margin: <span className="font-semibold text-foreground">{form.sale_price > 0 ? (((form.sale_price - form.purchase_price) / form.sale_price) * 100).toFixed(1) : 0}%</span>
            </div>
          </div>
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {printing && <BarcodeLabel product={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}
