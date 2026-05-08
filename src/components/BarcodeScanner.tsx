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
  const html5QrCodeRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const processingRef = useRef(false);

  // Keep latest callbacks in refs so the scanner effect never needs to restart
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    processingRef.current = false;
    setError(null);

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;

        const scanner = new Html5Qrcode("barcode-scanner-region");
        html5QrCodeRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio: 1.0 },
          (decodedText: string) => {
            if (processingRef.current || cancelled) return;
            processingRef.current = true;

            // Stop scanner, close dialog, then fire onScan safely
            scanner.stop().catch(() => {}).finally(() => {
              if (cancelled) return;
              const code = decodedText;
              // Close first
              onCloseRef.current();
              // Then add to cart after dialog is gone
              setTimeout(() => {
                onScanRef.current(code);
                processingRef.current = false;
              }, 150);
            });
          },
          () => {} // ignore decode errors
        );
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Unable to access camera. Please allow camera permission.");
        }
      }
    };

    const timer = setTimeout(startScanner, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.stop().catch(() => {});
        html5QrCodeRef.current = null;
      }
    };
  }, [open]); // ← only re-runs when dialog opens/closes, NOT on every render

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onCloseRef.current(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" /> Scan Barcode
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div id="barcode-scanner-region" className="w-full rounded-lg overflow-hidden" />
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <p className="text-xs text-muted-foreground text-center">
            Point your camera at a barcode to scan
          </p>
          <Button variant="outline" className="w-full" onClick={() => onCloseRef.current()}>
            <X className="h-4 w-4 mr-2" /> Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}