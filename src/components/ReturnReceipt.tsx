import { useEffect, useState } from "react";
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
}

export function ReturnReceipt({ ret, onClose }: { ret: ReturnReceiptData; onClose: () => void }) {
  const [store, setStore] = useState({ store_name: "ZIC Mart", address: "", phone: "", footer_message: "" });

  useEffect(() => {
    supabase.from("store_settings").select("store_name,address,phone,footer_message").eq("id", 1).single()
      .then(({ data }) => { if (data) setStore(data as any); });
  }, []);

  const date = new Date(ret.created_at);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b no-print">
          <DialogTitle>Return Processed</DialogTitle>
        </DialogHeader>

        <div className="print-area p-4 font-mono text-[11px] leading-snug bg-white text-black">
          <div className="text-center">
            <div className="font-bold text-base">{store.store_name}</div>
            <div>{store.address}</div>
            <div>Tel: {store.phone}</div>
            <div className="mt-1 font-bold text-sm bg-black text-white px-2 py-0.5 inline-block">RETURN RECEIPT</div>
          </div>
          <div className="border-t border-dashed border-black my-2" />
          <div>Return: <b>{ret.return_no}</b></div>
          <div>Original Bill: {ret.original_bill_no}</div>
          <div>Date: {date.toLocaleDateString()} {date.toLocaleTimeString()}</div>
          <div>Cashier: {ret.cashier_name}</div>
          {ret.reason && <div>Reason: {ret.reason}</div>}
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

        <DialogFooter className="px-4 py-3 border-t no-print">
          <Button variant="outline" onClick={onClose}><X className="h-4 w-4 mr-1" /> Close</Button>
          <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
