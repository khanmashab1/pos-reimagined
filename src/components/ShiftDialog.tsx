import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { EXPENSE_RECIPIENTS } from "@/lib/expense-recipients";

export interface OpenSession {
  id: string;
  opening_cash: number;
  cash_sales: number;
  online_sales: number;
  cash_paid_out: number;
  expenses: number;
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

  const submit = async () => {
    if (closing === "") return toast.error("Enter closing cash");
    setBusy(true);
    const { error } = await supabase.rpc("close_shift", { _closing_cash: Number(closing) || 0 });
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
        <div className="space-y-2 py-2">
          <label className="text-sm font-medium">Closing Cash (counted)</label>
          <Input type="number" autoFocus value={closing} onChange={e => setClosing(e.target.value)}
            placeholder="0" onKeyDown={e => e.key === "Enter" && submit()} />
          <p className="text-xs text-muted-foreground">Count the cash in the drawer and enter the total.</p>
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

/**
 * Records an expense (cash handed out from the drawer) against the open shift.
 * The amount is subtracted from expected drawer cash at close.
 */
export function ExpenseDialog({ open, onOpenChange, onRecorded }: {
  open: boolean; onOpenChange: (v: boolean) => void; onRecorded: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [customName, setCustomName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setAmount(""); setRecipient(""); setCustomName(""); } }, [open]);

  const submit = async () => {
    const amt = Number(amount);
    if (!(amt > 0)) return toast.error("Enter a valid amount");
    if (!recipient) return toast.error("Select who received the cash");
    const givenTo = recipient === "Other" ? customName.trim() : recipient;
    if (recipient === "Other" && !givenTo) return toast.error("Mention the name");
    setBusy(true);
    const { error } = await supabase.rpc("record_expense" as any, {
      _amount: amt,
      _description: givenTo,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Expense recorded — deducted from drawer");
    onRecorded();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Add Expense</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium">Amount</label>
            <Input type="number" autoFocus value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0" onKeyDown={e => e.key === "Enter" && submit()} />
          </div>
          <div>
            <label className="text-sm font-medium">Given to</label>
            <Select value={recipient} onValueChange={setRecipient}>
              <SelectTrigger><SelectValue placeholder="Select name" /></SelectTrigger>
              <SelectContent>
                {EXPENSE_RECIPIENTS.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                <SelectItem value="Other">Other…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {recipient === "Other" && (
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input autoFocus value={customName} onChange={e => setCustomName(e.target.value)}
                placeholder="Mention the name" onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            This cash leaves the drawer and is subtracted from your expected cash at shift close.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Record Expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
