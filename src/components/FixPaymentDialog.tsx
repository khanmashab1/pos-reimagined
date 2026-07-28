import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Pencil, Banknote, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { fmt } from "@/lib/format";

type PaymentMethod = "cash" | "card" | "easypasa" | "jazzcash";

interface Sale {
  id: string;
  bill_no: string;
  total: number;
  payment_type: string;
  created_at: string;
}

const OPTIONS: { id: PaymentMethod; label: string; cls: string }[] = [
  { id: "cash", label: "Cash", cls: "bg-primary text-white border-primary" },
  { id: "card", label: "Card", cls: "bg-blue-600 text-white border-blue-600" },
  { id: "easypasa", label: "EasyPaisa", cls: "bg-green-600 text-white border-green-600" },
  { id: "jazzcash", label: "JazzCash", cls: "bg-red-600 text-white border-red-600" },
];

export function FixPaymentDialog({
  open,
  onOpenChange,
  sessionId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sessionId: string | null;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    if (!sessionId) { setRows([]); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("sales")
      .select("id,bill_no,total,payment_type,created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) toast.error(error.message);
    setRows((data ?? []) as Sale[]);
    setLoading(false);
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, sessionId]);

  const change = async (sale: Sale, next: PaymentMethod) => {
    if (sale.payment_type === next) return;
    setSavingId(sale.id);
    const { error } = await supabase.rpc("change_sale_payment" as any, {
      _sale_id: sale.id,
      _new_payment: next,
    });
    setSavingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Bill ${sale.bill_no} → ${next}`);
    setRows(rs => rs.map(r => r.id === sale.id ? { ...r, payment_type: next } : r));
    onChanged?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Change Payment Type (Last 5 Bills)
          </DialogTitle>
        </DialogHeader>

        {!sessionId ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Start a shift first.</p>
        ) : loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No bills in this shift yet.</p>
        ) : (
          <div className="space-y-3 py-1 max-h-[60vh] overflow-y-auto">
            {rows.map(r => (
              <div key={r.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-start text-sm">
                  <div>
                    <div className="font-semibold">{r.bill_no}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleTimeString()} · current: <span className="font-medium">{r.payment_type}</span>
                    </div>
                  </div>
                  <div className="font-bold flex items-center gap-1">
                    {r.payment_type === "cash"
                      ? <Banknote className="h-3.5 w-3.5" />
                      : <CreditCard className="h-3.5 w-3.5" />}
                    {fmt(r.total)}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {OPTIONS.map(o => {
                    const active = r.payment_type === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        disabled={savingId === r.id || active}
                        onClick={() => change(r, o.id)}
                        className={`text-xs h-8 rounded border-2 font-medium transition-colors ${
                          active ? o.cls : "bg-white border-gray-300 text-gray-700 hover:bg-gray-100"
                        } disabled:opacity-60`}
                      >
                        {savingId === r.id ? <Loader2 className="h-3 w-3 animate-spin mx-auto" /> : o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
