import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { fmt } from "@/lib/format";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/shifts")({
  component: ShiftsPage,
});

interface Session {
  id: string;
  user_name: string;
  opening_cash: number;
  cash_sales: number;
  closing_cash: number | null;
  expected_cash: number;
  difference: number | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
}

function ShiftsPage() {
  const [rows, setRows] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<Session | null>(null);
  const [editForm, setEditForm] = useState({
    opening_cash: "",
    closing_cash: "",
    cash_sales: "",
    expected_cash: "",
    difference: "",
    user_name: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("cash_sessions")
      .select("*")
      .order("opened_at", { ascending: false })
      .limit(200);
    setRows((data ?? []) as Session[]);
    setLoading(false);
  };

  const openEdit = (r: Session) => {
    setEditTarget(r);
    setEditForm({
      opening_cash: String(r.opening_cash),
      closing_cash: r.closing_cash != null ? String(r.closing_cash) : "",
      cash_sales: String(r.cash_sales),
      expected_cash: String(r.expected_cash),
      difference: r.difference != null ? String(r.difference) : "",
      user_name: r.user_name,
    });
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setSaving(true);
    const { error } = await supabase.rpc("admin_update_shift", {
      _session_id: editTarget.id,
      _opening_cash: Number(editForm.opening_cash),
      _closing_cash: editForm.closing_cash === "" ? null : Number(editForm.closing_cash),
      _cash_sales: Number(editForm.cash_sales),
      _expected_cash: Number(editForm.expected_cash),
      _difference: editForm.difference === "" ? null : Number(editForm.difference),
      _user_name: editForm.user_name,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Shift updated");
    setEditTarget(null);
    load();
  };

  const totals = rows.reduce(
    (a, r) => ({
      cash: a.cash + Number(r.cash_sales || 0),
      diff: a.diff + Number(r.difference || 0),
    }),
    { cash: 0, diff: 0 },
  );

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Cashier Shifts</h1>
        <p className="text-muted-foreground">Sessions opened and closed by cashiers</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total Shifts</div>
          <div className="text-2xl font-bold">{rows.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total Cash Sales</div>
          <div className="text-2xl font-bold">{fmt(totals.cash)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Net Difference</div>
          <div
            className={`text-2xl font-bold ${totals.diff === 0 ? "" : totals.diff > 0 ? "text-green-600" : "text-destructive"}`}
          >
            {fmt(totals.diff)}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">No shifts yet.</p>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-4 py-3">Cashier</th>
                    <th className="px-4 py-3">Opened</th>
                    <th className="px-4 py-3">Closed</th>
                    <th className="px-4 py-3 text-right">Opening</th>
                    <th className="px-4 py-3 text-right">Cash Sales</th>
                    <th className="px-4 py-3 text-right">Expected</th>
                    <th className="px-4 py-3 text-right">Closing</th>
                    <th className="px-4 py-3 text-right">Diff</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 font-medium">{r.user_name || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(r.opened_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.closed_at ? new Date(r.closed_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">{fmt(r.opening_cash)}</td>
                      <td className="px-4 py-3 text-right">{fmt(r.cash_sales)}</td>
                      <td className="px-4 py-3 text-right">{fmt(r.expected_cash)}</td>
                      <td className="px-4 py-3 text-right">
                        {r.closing_cash != null ? fmt(r.closing_cash) : "—"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold ${r.difference == null ? "" : Number(r.difference) === 0 ? "" : Number(r.difference) > 0 ? "text-green-600" : "text-destructive"}`}
                      >
                        {r.difference != null ? fmt(Number(r.difference)) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={r.status === "open" ? "default" : "secondary"}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y">
              {rows.map((r) => (
                <div key={r.id} className="p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">{r.user_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(r.opened_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={r.status === "open" ? "default" : "secondary"}>
                        {r.status}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => openEdit(r)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-y-1 text-sm">
                    <span className="text-muted-foreground">Opening</span>
                    <span className="text-right">{fmt(r.opening_cash)}</span>
                    <span className="text-muted-foreground">Cash Sales</span>
                    <span className="text-right">{fmt(r.cash_sales)}</span>
                    <span className="text-muted-foreground">Expected</span>
                    <span className="text-right">{fmt(r.expected_cash)}</span>
                    <span className="text-muted-foreground">Closing</span>
                    <span className="text-right">
                      {r.closing_cash != null ? fmt(r.closing_cash) : "—"}
                    </span>
                    <span className="text-muted-foreground">Difference</span>
                    <span
                      className={`text-right font-semibold ${r.difference == null ? "" : Number(r.difference) === 0 ? "" : Number(r.difference) > 0 ? "text-green-600" : "text-destructive"}`}
                    >
                      {r.difference != null ? fmt(Number(r.difference)) : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" /> Edit Shift
            </DialogTitle>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                {editTarget.user_name} · {new Date(editTarget.opened_at).toLocaleDateString()}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Cashier Name</Label>
                  <Input
                    value={editForm.user_name}
                    onChange={(e) => setEditForm({ ...editForm, user_name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Opening Cash</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.opening_cash}
                    onChange={(e) => setEditForm({ ...editForm, opening_cash: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Cash Sales</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.cash_sales}
                    onChange={(e) => setEditForm({ ...editForm, cash_sales: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Expected Cash</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.expected_cash}
                    onChange={(e) => setEditForm({ ...editForm, expected_cash: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Closing Cash</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.closing_cash}
                    onChange={(e) => setEditForm({ ...editForm, closing_cash: e.target.value })}
                    placeholder="Leave empty if not closed"
                  />
                </div>
                <div>
                  <Label>Difference</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editForm.difference}
                    onChange={(e) => setEditForm({ ...editForm, difference: e.target.value })}
                    placeholder="Leave empty if not closed"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
