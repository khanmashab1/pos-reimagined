import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/categories")({
  component: CategoriesPage,
});

interface Cat { id: string; name: string; count?: number; }

function CategoriesPage() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Cat | null>(null);
  const [name, setName] = useState("");

  const load = async () => {
    const { data: c } = await supabase.from("categories").select("id,name").order("name");
    const { data: p } = await supabase.from("products").select("category_id");
    const counts = (p ?? []).reduce<Record<string, number>>((m, x) => {
      if (x.category_id) m[x.category_id] = (m[x.category_id] ?? 0) + 1;
      return m;
    }, {});
    setCats((c ?? []).map(x => ({ ...x, count: counts[x.id] ?? 0 })));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!name.trim()) return;
    if (editing) {
      const { error } = await supabase.from("categories").update({ name: name.trim() }).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Category updated");
    } else {
      const { error } = await supabase.from("categories").insert({ name: name.trim() });
      if (error) return toast.error(error.message);
      toast.success("Category added");
    }
    setOpen(false); setName(""); setEditing(null); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Categories</h1>
          <p className="text-muted-foreground">Organize your product catalog</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setName(""); setEditing(null); } }}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Add Category</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Category</DialogTitle></DialogHeader>
            <Input placeholder="Category name" value={name} onChange={e => setName(e.target.value)} autoFocus />
            <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <div className="divide-y">
          {cats.length === 0 && <p className="p-8 text-center text-muted-foreground">No categories yet.</p>}
          {cats.map(c => (
            <div key={c.id} className="flex items-center justify-between px-5 py-3.5">
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.count} products</div>
              </div>
              <div className="flex gap-2">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(c); setName(c.name); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
