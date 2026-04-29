import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt } from "@/lib/format";

interface Props {
  product: { id: string; name: string; barcode: string; sale_price: number };
  onClose: () => void;
}

export function BarcodeLabel({ product, onClose }: Props) {
  const [copies, setCopies] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current) {
      try {
        JsBarcode(svgRef.current, product.barcode, {
          format: "CODE128", width: 1.4, height: 36, displayValue: true, fontSize: 11, textMargin: 1, margin: 0,
        });
      } catch (e) { console.error(e); }
    }
  }, [product.barcode]);

  const handlePrint = () => {
    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) return;
    const svg = svgRef.current?.outerHTML ?? "";
    const labels = Array.from({ length: copies }).map(() => `
      <div class="label">
        <div class="shop">ZIC Mart</div>
        <div class="name">${product.name}</div>
        ${svg}
        <div class="price">${fmt(product.sale_price)}</div>
      </div>
    `).join("");
    w.document.write(`
      <html><head><title>Barcode</title>
      <style>
        @page { size: 50mm 30mm; margin: 1mm; }
        body { margin: 0; font-family: Arial, sans-serif; }
        .label { width: 48mm; height: 28mm; display: flex; flex-direction: column; align-items: center; justify-content: center; page-break-after: always; padding: 1mm; box-sizing: border-box; }
        .shop { font-size: 7pt; font-weight: bold; }
        .name { font-size: 7pt; max-width: 46mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
        .price { font-size: 9pt; font-weight: bold; margin-top: 1mm; }
        svg { width: 44mm; height: 12mm; }
      </style>
      </head><body>${labels}<scr` + `ipt>window.onload=()=>{window.print();setTimeout(()=>window.close(),300);}</scr` + `ipt></body></html>`);
    w.document.close();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Print Barcode Labels</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border p-4 flex flex-col items-center bg-white">
            <div className="text-xs font-bold">ZIC Mart</div>
            <div className="text-xs">{product.name}</div>
            <svg ref={svgRef} />
            <div className="text-sm font-bold">{fmt(product.sale_price)}</div>
          </div>
          <div>
            <Label>Number of copies</Label>
            <Input type="number" min={1} max={100} value={copies} onChange={e => setCopies(Math.max(1, +e.target.value))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handlePrint}>Print {copies} {copies === 1 ? "label" : "labels"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
