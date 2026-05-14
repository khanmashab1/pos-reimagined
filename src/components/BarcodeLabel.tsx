import { useEffect, useRef, useState } from "react";
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Small delay to ensure dialog DOM is fully rendered
    const timer = setTimeout(async () => {
      try {
        const JsBarcode = (await import("jsbarcode")).default;
        const canvas = canvasRef.current;
        if (!canvas) return;

        JsBarcode(canvas, product.barcode, {
          format: "CODE128",
          width: 2,
          height: 50,
          displayValue: true,
          fontSize: 12,
          textMargin: 2,
          margin: 4,
          background: "#ffffff",
          lineColor: "#000000",
        });

        setBarcodeDataUrl(canvas.toDataURL("image/png"));
      } catch (e: any) {
        console.error("Barcode error:", e);
        setError("Could not generate barcode: " + e.message);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [product.barcode]);

  const handlePrint = () => {
    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) return;

    const imgTag = barcodeDataUrl
      ? `<img src="${barcodeDataUrl}" style="width:44mm;height:14mm;" />`
      : `<div style="font-size:8pt;">${product.barcode}</div>`;

    const labels = Array.from({ length: copies }).map(() => `
      <div class="label">
        <div class="shop">ZIC Mart</div>
        <div class="name">${product.name}</div>
        ${imgTag}
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
        img { width: 44mm; }
      </style>
      </head><body>${labels}<scr` + `ipt>window.onload=()=>{window.print();setTimeout(()=>window.close(),500);}</scr` + `ipt></body></html>`);
    w.document.close();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Print Barcode Labels</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {/* Hidden canvas used to generate barcode */}
          <canvas ref={canvasRef} style={{ display: "none" }} />

          {/* Preview */}
          <div className="rounded-lg border p-4 flex flex-col items-center bg-white gap-1">
            <div className="text-xs font-bold text-black">ZIC Mart</div>
            <div className="text-xs text-black">{product.name}</div>
            {error ? (
              <div className="text-xs text-red-500 py-2">{error}</div>
            ) : barcodeDataUrl ? (
              <img src={barcodeDataUrl} alt="barcode" className="w-48" />
            ) : (
              <div className="text-xs text-gray-400 py-4">Generating barcode...</div>
            )}
            <div className="text-sm font-bold text-black">{fmt(product.sale_price)}</div>
          </div>

          <div>
            <Label>Number of copies</Label>
            <Input
              type="number" min={1} max={100} value={copies}
              onChange={e => setCopies(Math.max(1, +e.target.value))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handlePrint} disabled={!barcodeDataUrl}>
            Print {copies} {copies === 1 ? "label" : "labels"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}