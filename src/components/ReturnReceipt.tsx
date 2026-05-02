import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import { fmt } from "@/lib/format";

interface ReturnReceiptData {
  return_no: string;
  original_bill_no: string;
  reason: string;
  items: { product_name: string; qty: number; unit_price: number; subtotal: number }[];
  refund_amount: number;
  cashier_name: string;
  created_at: string;
  status?: "pending" | "approved" | "voided";
  void_reason?: string | null;
  voided_at?: string | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
}

export function ReturnReceipt({ ret, onClose }: { ret: ReturnReceiptData; onClose: () => void }) {
  const [store, setStore] = useState({ store_name: "ZIC Mart", address: "", phone: "", footer_message: "" });
  const portalRef = useRef<HTMLDivElement | null>(null);
  if (typeof document !== "undefined" && !portalRef.current) {
    const el = document.createElement("div");
    el.className = "print-portal-root";
    portalRef.current = el;
  }

  useEffect(() => {
    const el = portalRef.current;
    if (!el) return;
    document.body.appendChild(el);
    return () => { if (el.parentNode) el.parentNode.removeChild(el); };
  }, []);

  useEffect(() => {
    supabase.from("store_settings").select("store_name,address,phone,footer_message").eq("id", 1).single()
      .then(({ data }) => { if (data) setStore(data as any); });
  }, []);

  const date = new Date(ret.created_at);

  const Body = (
    <div className="font-mono text-[11px] leading-snug bg-white text-black">
      <div className="text-center">
        <div className="font-bold text-base">{store.store_name}</div>
        <div>{store.address}</div>
        <div>Tel: {store.phone}</div>
        <div className="mt-1 font-bold text-sm bg-black text-white px-2 py-0.5 inline-block">
          {ret.status === "voided" ? "VOID RECEIPT" : "RETURN RECEIPT"}
        </div>
      </div>
      {ret.status === "voided" && (
        <div className="text-center my-2 border-2 border-black border-dashed py-1 font-bold tracking-widest text-base">
          ★ VOIDED ★
        </div>
      )}
      <div className="border-t border-dashed border-black my-2" />
      <div>Return: <b>{ret.return_no}</b></div>
      <div>Original Bill: {ret.original_bill_no}</div>
      <div>Date: {date.toLocaleDateString()} {date.toLocaleTimeString()}</div>
      <div>Cashier: {ret.cashier_name}</div>
      {ret.reason && <div>Reason: {ret.reason}</div>}
      {ret.status && <div>Status: <b className="uppercase">{ret.status}</b></div>}
      {ret.status === "approved" && ret.approved_by_name && (
        <div>Approved by: {ret.approved_by_name}</div>
      )}
      {ret.status === "voided" && (
        <>
          {ret.void_reason && <div>Void reason: {ret.void_reason}</div>}
          {ret.voided_at && <div>Voided at: {new Date(ret.voided_at).toLocaleString()}</div>}
        </>
      )}
      <div className="border-t border-dashed border-black my-2" />

      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 font-bold">
        <span>Item</span><span className="text-right">Qty</span><span className="text-right">Price</span><span className="text-right">Refund</span>
      </div>
      <div className="border-t border-dashed border-black my-1" />
      {ret.items.map((i, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2">
          <span className="truncate">{i.product_name}</span>
          <span className="text-right">{i.qty}</span>
          <span className="text-right">{Number(i.unit_price).toFixed(0)}</span>
          <span className="text-right">{Number(i.subtotal).toFixed(0)}</span>
        </div>
      ))}
      <div className="border-t border-double border-black my-2" />
      <div className="flex justify-between font-bold text-sm">
        <span>TOTAL REFUND</span><span>{fmt(ret.refund_amount)}</span>
      </div>
      <div className="border-t border-dashed border-black my-2" />
      <div className="text-center mt-2">{store.footer_message}</div>
      <div className="text-center text-[9px] mt-1 opacity-70">Powered by ZIC Mart POS</div>
    </div>
  );

  return (
    <>
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-sm p-0 gap-0 no-print">
          <DialogHeader className="px-4 py-3 border-b">
            <DialogTitle>Return Processed</DialogTitle>
          </DialogHeader>
          <div className="p-4">{Body}</div>
          <DialogFooter className="px-4 py-3 border-t">
            <Button variant="outline" onClick={onClose}><X className="h-4 w-4 mr-1" /> Close</Button>
            <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {portalRef.current && createPortal(Body, portalRef.current)}
    </>
  );
}
