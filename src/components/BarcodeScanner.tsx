import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, X } from "lucide-react";

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}

export function BarcodeScanner({ open, onClose, onScan }: BarcodeScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<any>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    doneRef.current = false;
    setError(null);
    setScanning(true);

    let scanner: any = null;

    const start = async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        scanner = new Html5Qrcode("qr-reader");
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 150 } },
          (code: string) => {
            // Only fire once
            if (doneRef.current) return;
            doneRef.current = true;

            const result = code.trim();

            // Stop camera, close dialog, then call onScan
            scanner.stop()
              .catch(() => {})
              .finally(() => {
                onClose();
                setTimeout(() => onScan(result), 200);
              });
          },
          () => {}
        );
      } catch (e: any) {
        setError("Camera not available. Please allow camera access.");
        setScanning(false);
      }
    };

    const timer = setTimeout(start, 300);

    return () => {
      clearTimeout(timer);
      doneRef.current = true;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
      setScanning(false);
    };
  }, [open]); // ONLY depends on open — nothing else

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" /> Camera Scanner
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div id="qr-reader" className="w-full rounded-lg overflow-hidden min-h-[200px] bg-muted flex items-center justify-center">
            {!scanning && !error && <span className="text-sm text-muted-foreground">Starting camera...</span>}
          </div>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          {scanning && !error && (
            <p className="text-xs text-muted-foreground text-center">Point camera at barcode</p>
          )}
          <Button variant="outline" className="w-full" onClick={onClose}>
            <X className="h-4 w-4 mr-2" /> Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}