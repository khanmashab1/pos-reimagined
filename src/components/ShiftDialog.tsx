import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { fmt } from "@/lib/format";
import { toast } from "sonner";

export interface OpenSession {
  id: string;
  opening_cash: number;
  cash_sales: number;
  expected_cash: number;
  opened_at: string;
}

export function StartShiftDialog({ open, onOpenChange, onStarted }: {
  open: boolean; onOpenChange: (v: boolean) => void; onStarted: (s: OpenSession) => void;
}) {
  const [opening, setOpening] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setOpening(""); }, [open]);

  const submit = async () => {
    const amt = Number(opening);
    if (!(amt >= 0)) return toast.error("Enter a valid opening cash amount");
    setBusy(true);
    const { error: e1 } = await supabase.rpc("open_shift", { _opening_cash: amt });
    if (e1) { setBusy(false); return toast.error(e1.message); }
    const { data, error: e2 } = await supabase.rpc("get_open_session");
    setBusy(false);
    if (e2) return toast.error(e2.message);
    onStarted(data as unknown as OpenSession);
    onOpenChange(false);
    toast.success("Shift started");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Start Shift</DialogTitle></DialogHeader>
        <div className="space-y-2 py-2">
          <label className="text-sm font-medium">Opening Cash</label>
          <Input type="number" autoFocus value={opening} onChange={e => setOpening(e.target.value)}
            placeholder="0" onKeyDown={e => e.key === "Enter" && submit()} />
          <p className="text-xs text-muted-foreground">Enter the cash currently in the drawer.</p>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Start Shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CloseShiftDialog({ open, onOpenChange, session, onClosed }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  session: OpenSession | null; onClosed: () => void;
}) {
  const [closing, setClosing] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setClosing(""); }, [open]);

  if (!session) return null;
  const closeNum = Number(closing) || 0;
  const diff = closeNum - session.expected_cash;

  const submit = async () => {
    if (closing === "") return toast.error("Enter closing cash");
    setBusy(true);
    const { error } = await supabase.rpc("close_shift", { _closing_cash: closeNum });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Shift closed");
    onClosed();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Close Shift</DialogTitle></DialogHeader>
        <div className="space-y-2 py-2 text-sm">
          <Row label="Opening Cash" value={fmt(session.opening_cash)} />
          <Row label="Cash Sales" value={fmt(session.cash_sales)} />
          <Row label="Expected Cash" value={fmt(session.expected_cash)} bold />
          <div className="pt-2">
            <label className="text-sm font-medium">Closing Cash (counted)</label>
            <Input type="number" autoFocus value={closing} onChange={e => setClosing(e.target.value)}
              placeholder="0" onKeyDown={e => e.key === "Enter" && submit()} />
          </div>
          {closing !== "" && (
            <div className={`flex justify-between pt-2 border-t font-semibold ${diff === 0 ? "" : diff > 0 ? "text-green-600" : "text-destructive"}`}>
              <span>Difference</span><span>{fmt(diff)}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Close Shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "font-bold" : "font-medium"}>{value}</span>
    </div>
  );
}
