import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, ShoppingCart, User } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/access-pos")({
  component: AccessPosPage,
});

interface Cashier {
  id: string;
  full_name: string | null;
  username: string | null;
  is_active: boolean;
}

function AccessPosPage() {
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role");
      const ids = (roles ?? []).map(r => r.user_id);
      if (ids.length === 0) { setLoading(false); return; }
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, username, is_active")
        .in("id", ids);
      const roleMap = new Map((roles ?? []).map(r => [r.user_id, r.role]));
      const list = (profs ?? [])
        .filter((p: any) => roleMap.get(p.id) === "cashier" && p.is_active !== false)
        .map((p: any) => ({ id: p.id, full_name: p.full_name, username: p.username, is_active: p.is_active !== false }));
      list.sort((a, b) => (a.full_name || a.username || "").localeCompare(b.full_name || b.username || ""));
      setCashiers(list);
      setLoading(false);
    })();
  }, []);

  function openAs(c: Cashier) {
    const name = c.full_name || c.username || "Cashier";
    try {
      sessionStorage.setItem("pos_impersonate", JSON.stringify({ id: c.id, name }));
    } catch {}
    toast.success(`Opening POS as ${name}`);
    navigate({ to: "/pos" });
  }

  const filtered = cashiers.filter(c => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (c.full_name || "").toLowerCase().includes(q)
      || (c.username || "").toLowerCase().includes(q);
  });

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Access Cashier POS</h1>
        <p className="text-sm text-muted-foreground">
          Open the POS as any cashier without needing their password. You remain signed in as admin.
        </p>
      </div>

      <Input
        placeholder="Search cashiers…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">No cashiers found.</Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map(c => (
            <Card key={c.id} className="p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <User className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate">{c.full_name || c.username}</div>
                  {c.username && c.full_name && (
                    <div className="text-xs text-muted-foreground truncate">@{c.username}</div>
                  )}
                </div>
              </div>
              <Button size="sm" onClick={() => openAs(c)}>
                <ShoppingCart className="h-4 w-4 mr-1" /> Open POS
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
