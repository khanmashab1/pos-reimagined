import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { fmt } from "@/lib/format";
import { Loader2, Banknote } from "lucide-react";
import type { OpenSession } from "@/components/ShiftDialog";

/** Returns YYYY-MM-DD in Asia/Karachi timezone. */
export function karachiDate(d: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function yesterdayISO(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * At/after 12 AM (Asia/Karachi) prompts the cashier to manually record the
 * previous day's counter cash into the Manual Sale Report. Can also be opened
 * manually from the cashier UI via controlled `open`/`onOpenChange` props.
 */
export function MidnightCounterCashDialog({
  session,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  session: OpenSession | null;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const { fullName, user } = useAuth();
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = (v: boolean) => {
    onOpenChangeProp?.(v);
    if (openProp === undefined) setOpenInternal(v);
  };

  const [targetDate, setTargetDate] = useState<string>(karachiDate());
  const [amount, setAmount] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const lastDateRef = useRef<string>(karachiDate());

  const promptKey = (date: string) => `counter_cash_prompted_${date}`;

  // Auto-trigger at midnight rollover (only when not already externally controlled open).
  useEffect(() => {
    if (!session) return;

    const check = () => {
      const nowDate = karachiDate();
      const prevDate = lastDateRef.current;

      if (nowDate !== prevDate) {
        const yday = prevDate;
        lastDateRef.current = nowDate;
        if (!localStorage.getItem(promptKey(yday))) {
          setTargetDate(yday);
          setAmount("");
          setOpen(true);
        }
        return;
      }

      if (!open) {
        const yday = yesterdayISO(nowDate);
        if (!localStorage.getItem(promptKey(yday))) {
          setTargetDate(yday);
          setAmount("");
          setOpen(true);
        }
      }
    };

    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // When opened manually with no target date context, default to today.
  useEffect(() => {
    if (open && !targetDate) setTargetDate(karachiDate());
  }, [open, targetDate]);

  const save = async () => {
    const n = Number(amount);
    if (!amount || Number.isNaN(n) || n < 0) {
      toast.error("Enter counter cash amount");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("manual_sale_days").upsert(
      {
        entry_date: targetDate,
        counter_cash: n,
        created_by: user?.id ?? null,
        created_by_name: fullName ?? "",
      } as any,
      { onConflict: "entry_date", ignoreDuplicates: false },
    );
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    localStorage.setItem(promptKey(targetDate), "1");
    toast.success("Counter cash saved to Manual Sale Report");
    setAmount("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5" /> Enter Counter Cash
          </DialogTitle>
          <DialogDescription>
            Counter cash for <span className="font-semibold">{targetDate}</span>.
            Please count the drawer and enter the amount manually — this goes into the Manual Sale Report.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {session && (
            <div className="rounded-md border p-3 text-sm bg-muted/40">
              <div className="flex justify-between"><span className="text-muted-foreground">System expected</span><span className="font-medium">{fmt(session.expected_cash)}</span></div>
              <div className="text-xs text-muted-foreground mt-1">Verify by physically counting the drawer.</div>
            </div>
          )}
          <div>
            <Label>Counter Cash (Rs.)</Label>
            <Input
              type="number"
              step="0.01"
              autoFocus
              placeholder="Enter counted amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving || amount === ""}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save to Manual Sale Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
