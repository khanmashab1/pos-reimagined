import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import { fmt } from "@/lib/format";

interface Sale {
  bill_no: string;
  items: { name: string; barcode: string; qty: number; sale_price: number }[];
  subtotal: number; tax_amount: number; discount: number; total: number;
  cash_received: number; change_returned: number;
  cashier_name: string; created_at: string;
}

export function Receipt({ sale, onClose }: { sale: Sale; onClose: () => void }) {
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

  const date = new Date(sale.created_at);

  const print = () => {
    window.print();
  };

  const ReceiptBody = (
    <div className="font-mono text-[11px] leading-snug bg-white text-black">
      <div className="text-center">
        <div className="font-bold text-base">{store.store_name}</div>
        <div>{store.address}</div>
        <div>Tel: {store.phone}</div>
      </div>
      <div className="border-t border-dashed border-black my-2" />
      <div>Bill: <b>{sale.bill_no}</b></div>
      <div>Date: {date.toLocaleDateString()} {date.toLocaleTimeString()}</div>
      <div>Cashier: {sale.cashier_name}</div>
      <div className="border-t border-dashed border-black my-2" />

      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 font-bold">
        <span>Item</span><span className="text-right">Qty</span><span className="text-right">Price</span><span className="text-right">Total</span>
      </div>
      <div className="border-t border-dashed border-black my-1" />
      {sale.items.map((i, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2">
          <span className="truncate">{i.name}</span>
          <span className="text-right">{i.qty}</span>
          <span className="text-right">{Number(i.sale_price).toFixed(0)}</span>
          <span className="text-right">{(i.qty * Number(i.sale_price)).toFixed(0)}</span>
        </div>
      ))}
      <div className="border-t border-dashed border-black my-2" />

      <Line l="Subtotal" r={fmt(sale.subtotal)} />
      {sale.discount > 0 && <Line l="Discount" r={`- ${fmt(sale.discount)}`} />}
      {sale.tax_amount > 0 && <Line l="Tax" r={fmt(sale.tax_amount)} />}
      <div className="border-t border-double border-black my-1.5" />
      <Line l="GRAND TOTAL" r={fmt(sale.total)} bold />
      <div className="border-t border-double border-black my-1.5" />
      <Line l="Cash" r={fmt(sale.cash_received)} />
      <Line l="Change" r={fmt(sale.change_returned)} />

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
            <DialogTitle>Sale Complete</DialogTitle>
          </DialogHeader>
          <div className="p-4">{ReceiptBody}</div>
          <DialogFooter className="px-4 py-3 border-t">
            <Button variant="outline" onClick={onClose}><X className="h-4 w-4 mr-1" /> Close</Button>
            <Button onClick={print}><Printer className="h-4 w-4 mr-1" /> Print Receipt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {portalRef.current && createPortal(ReceiptBody, portalRef.current)}
    </>
  );
}

function Line({ l, r, bold }: { l: string; r: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-bold text-sm" : ""}`}>
      <span>{l}</span><span>{r}</span>
    </div>
  );
}
