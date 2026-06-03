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
import { Loader2, Pencil, Eye, Truck } from "lucide-react";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

export const Route = createFileRoute("/admin/shifts")({
  component: ShiftsPage,
});

interface Session {
  id: string;
  user_name: string;
  opening_cash: number;
  cash_sales: number;
  online_sales: number;
  cash_paid_out: number;
  closing_cash: number | null;
  expected_cash: number;
  difference: number | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
}

interface Payout {
  id: string;
  amount: number;
  method: string | null;
  notes: string | null;
  payment_date: string;
  created_at: string;
  created_by_name: string | null;
  suppliers: { name: string } | null;
}

/**
 * The edit form keeps its own state so typing in it doesn't re-render the (up to 200-row) shifts table.
 */
function EditShiftDialog({
  target,
  onClose,
  onSaved,
}: {
  target: Session | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    opening_cash: "",
    closing_cash: "",
    cash_sales: "",
    online_sales: "",
    cash_paid_out: "",
    expected_cash: "",
    difference: "",
    user_name: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setForm({
      opening_cash: String(target.opening_cash),
      closing_cash: target.closing_cash != null ? String(target.closing_cash) : "",
      cash_sales: String(target.cash_sales),
      online_sales: String(target.online_sales),
      cash_paid_out: String(target.cash_paid_out),
      expected_cash: String(target.expected_cash),
      difference: target.difference != null ? String(target.difference) : "",
      user_name: target.user_name,
    });
  }, [target]);

  const save = async () => {
    if (!target) return;
    setSaving(true);
    const { error } = await supabase.rpc("admin_update_shift", {
      _session_id: target.id,
      _opening_cash: Number(form.opening_cash),
      _closing_cash: form.closing_cash === "" ? null : Number(form.closing_cash),
      _cash_sales: Number(form.cash_sales),
      _online_sales: Number(form.online_sales),
      _cash_paid_out: Number(form.cash_paid_out),
      _expected_cash: Number(form.expected_cash),
      _difference: form.difference === "" ? null : Number(form.difference),
      _user_name: form.user_name,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Shift updated");
    onClose();
    onSaved();
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Edit Shift
          </DialogTitle>
        </DialogHeader>
        {target && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {target.user_name} · {new Date(target.opened_at).toLocaleDateString()}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cashier Name</Label>
                <Input
                  value={form.user_name}
                  onChange={(e) => setForm({ ...form, user_name: e.target.value })}
                />
              </div>
              <div>
                <Label>Opening Cash</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.opening_cash}
                  onChange={(e) => setForm({ ...form, opening_cash: e.target.value })}
                />
              </div>
              <div>
                <Label>Cash Sales</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.cash_sales}
                  onChange={(e) => setForm({ ...form, cash_sales: e.target.value })}
                />
              </div>
              <div>
                <Label>Online Payment</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.online_sales}
                  onChange={(e) => setForm({ ...form, online_sales: e.target.value })}
                />
              </div>
              <div>
                <Label>Cash Paid to Suppliers</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.cash_paid_out}
                  onChange={(e) => setForm({ ...form, cash_paid_out: e.target.value })}
                />
              </div>
              <div>
                <Label>Expected Cash</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.expected_cash}
                  onChange={(e) => setForm({ ...form, expected_cash: e.target.value })}
                />
              </div>
              <div>
                <Label>Closing Cash</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.closing_cash}
                  onChange={(e) => setForm({ ...form, closing_cash: e.target.value })}
                  placeholder="Leave empty if not closed"
                />
              </div>
              <div>
                <Label>Difference</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.difference}
                  onChange={(e) => setForm({ ...form, difference: e.target.value })}
                  placeholder="Leave empty if not closed"
                />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShiftsPage() {
  const [rows, setRows] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<Session | null>(null);
  const [detailTarget, setDetailTarget] = useState<Session | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("cash_sessions")
      .select(
        "id,user_name,opening_cash,cash_sales,online_sales,cash_paid_out,closing_cash,expected_cash,difference,status,opened_at,closed_at",
      )
      .order("opened_at", { ascending: false })
      .limit(200);
    setRows((data ?? []) as Session[]);
    setLoading(false);
  };

  const totals = rows.reduce(
    (a, r) => ({
      cash: a.cash + Number(r.cash_sales || 0),
      online: a.online + Number(r.online_sales || 0),
      diff: a.diff + Number(r.difference || 0),
    }),
    { cash: 0, online: 0, diff: 0 },
  );

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Cashier Shifts</h1>
        <p className="text-muted-foreground">Sessions opened and closed by cashiers</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total Shifts</div>
          <div className="text-2xl font-bold">{rows.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total Cash Sales</div>
          <div className="text-2xl font-bold">{fmt(totals.cash)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total Online Sales</div>
          <div className="text-2xl font-bold">{fmt(totals.online)}</div>
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
        ) : isMobile ? (
          /* Mobile */
          <div className="divide-y">
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
                      onClick={() => setEditTarget(r)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-y-1 text-sm">
                  <span className="text-muted-foreground">Opening</span>
                  <span className="text-right">{fmt(r.opening_cash)}</span>
                  <span className="text-muted-foreground">Closing</span>
                  <span className="text-right">
                    {r.closing_cash != null ? fmt(r.closing_cash) : "—"}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full mt-1"
                  onClick={() => setDetailTarget(r)}
                >
                  <Eye className="h-3.5 w-3.5 mr-1" /> Detail
                </Button>
              </div>
            ))}
          </div>
        ) : (
          /* Desktop */
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3">Cashier</th>
                  <th className="px-4 py-3">Opened</th>
                  <th className="px-4 py-3">Closed</th>
                  <th className="px-4 py-3 text-right">Opening</th>
                  <th className="px-4 py-3 text-right">Closing</th>
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
                    <td className="px-4 py-3 text-right">
                      {r.closing_cash != null ? fmt(r.closing_cash) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={r.status === "open" ? "default" : "secondary"}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" onClick={() => setDetailTarget(r)}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> Detail
                      </Button>
                      <Button size="sm" variant="ghost" className="ml-1" onClick={() => setEditTarget(r)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <EditShiftDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={load}
      />

      <ShiftDetailDialog
        target={detailTarget}
        onClose={() => setDetailTarget(null)}
      />
    </div>
  );
}

/**
 * Read-only per-shift breakdown: cash vs online sales, plus the supplier cash
 * payouts (with supplier name) that were recorded against this shift.
 */
function ShiftDetailDialog({
  target,
  onClose,
}: {
  target: Session | null;
  onClose: () => void;
}) {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!target) return;
    setLoading(true);
    supabase
      .from("supplier_payments" as any)
      .select("id,amount,method,notes,payment_date,created_at,created_by_name,suppliers(name)")
      .eq("session_id", target.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setPayouts((data ?? []) as unknown as Payout[]);
        setLoading(false);
      });
  }, [target]);

  const isCash = (m: string | null) => (m ?? "").trim().toLowerCase() === "cash";
  const cashTotal = payouts
    .filter((p) => isCash(p.method))
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" /> Shift Detail
          </DialogTitle>
        </DialogHeader>
        {target && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {target.user_name} · {new Date(target.opened_at).toLocaleString()}
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <DRow label="Opening Cash" value={fmt(target.opening_cash)} />
              <DRow label="Cash Sales" value={fmt(target.cash_sales)} />
              <DRow label="Online Sales" value={fmt(target.online_sales)} />
              <DRow label="Cash Paid to Suppliers" value={fmt(target.cash_paid_out)} />
              <DRow label="Expected Cash" value={fmt(target.expected_cash)} bold />
              <DRow
                label="Closing Cash"
                value={target.closing_cash != null ? fmt(target.closing_cash) : "—"}
              />
              <DRow
                label="Difference"
                value={target.difference != null ? fmt(Number(target.difference)) : "—"}
                bold
              />
            </div>

            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5" /> Supplier Payouts
              </div>
              {loading ? (
                <div className="py-6 flex justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : payouts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No supplier payments during this shift.
                </p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {payouts.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-start justify-between gap-2 p-3 border rounded-lg text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{p.suppliers?.name ?? "—"}</div>
                        {p.notes && (
                          <div className="text-xs text-muted-foreground">{p.notes}</div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {p.created_by_name || "—"} · {new Date(p.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold">{fmt(p.amount)}</div>
                        <Badge variant={isCash(p.method) ? "default" : "secondary"} className="mt-1">
                          {isCash(p.method) ? "Cash drawer" : "Bank"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {payouts.length > 0 && (
                <div className="flex justify-between pt-3 mt-2 border-t font-semibold text-sm">
                  <span>Total cash from drawer</span>
                  <span>{fmt(cashTotal)}</span>
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "font-bold" : "font-medium"}>{value}</span>
    </div>
  );
}
