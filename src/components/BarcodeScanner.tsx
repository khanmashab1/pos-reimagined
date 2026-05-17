import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, X, RefreshCw } from "lucide-react";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}

interface Html5QrcodeScanner {
  stop: () => Promise<void>;
}

export function BarcodeScanner({ open, onClose, onScan }: BarcodeScannerProps) {
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const html5ScannerRef = useRef<Html5QrcodeScanner | null>(null);

  const handleScan = (code: string) => {
    onClose();
    setTimeout(() => onScan(code), 200);
  };

  const { videoRef, canvasRef, scanning, error, isSupported, start, stop } = useBarcodeScanner({
    onScan: handleScan,
    fps: 10,
    facingMode: "environment",
  });

  // Primary: custom canvas-based scanner (Chromium)
  useEffect(() => {
    if (!open || !isSupported) return;
    let cancelled = false;
    const container = videoContainerRef.current;
    const timer = setTimeout(async () => {
      await start();
      if (!cancelled && videoRef.current && container) {
        container.appendChild(videoRef.current);
        videoElRef.current = videoRef.current;
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop();
      if (videoElRef.current && container) {
        try {
          container.removeChild(videoElRef.current);
        } catch {
          // element may already be removed
        }
        videoElRef.current = null;
      }
    };
  }, [open, isSupported, start, stop, videoRef]);

  // Fallback: html5-qrcode for non-Chromium browsers (Firefox, Safari)
  useEffect(() => {
    if (!open || isSupported) return;
    let cancelled = false;
    setFallbackError(null);
    const timer = setTimeout(async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const scanner = new Html5Qrcode("qr-reader-fallback");
        html5ScannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 150 } },
          (code: string) => {
            if (cancelled) return;
            cancelled = true;
            scanner
              .stop()
              .catch(() => {})
              .finally(() => {
                onClose();
                setTimeout(() => onScan(code.trim()), 200);
              });
          },
          () => {},
        );
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = (e as Error)?.message?.toLowerCase() || "";
          if (msg.includes("permission") || msg.includes("notallowed"))
            setFallbackError("Camera access denied. Please allow camera permissions.");
          else if (msg.includes("notfound")) setFallbackError("No camera found.");
          else setFallbackError("Camera not available.");
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (html5ScannerRef.current) {
        html5ScannerRef.current.stop().catch(() => {});
        html5ScannerRef.current = null;
      }
    };
  }, [open, isSupported, onClose, onScan]);

  const handleRetry = () => {
    if (isSupported) {
      stop();
      if (videoElRef.current && videoContainerRef.current) {
        try {
          videoContainerRef.current.removeChild(videoElRef.current);
        } catch {
          // element may already be removed
        }
        videoElRef.current = null;
      }
      setTimeout(async () => {
        await start();
        if (videoRef.current && videoContainerRef.current) {
          videoContainerRef.current.appendChild(videoRef.current);
          videoElRef.current = videoRef.current;
        }
      }, 200);
    } else {
      // Retry fallback scanner
      setFallbackError(null);
      if (html5ScannerRef.current) {
        html5ScannerRef.current.stop().catch(() => {});
        html5ScannerRef.current = null;
      }
      setTimeout(async () => {
        try {
          const { Html5Qrcode } = await import("html5-qrcode");
          const scanner = new Html5Qrcode("qr-reader-fallback");
          html5ScannerRef.current = scanner;
          await scanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 250, height: 150 } },
            (code: string) => {
              scanner
                .stop()
                .catch(() => {})
                .finally(() => {
                  onClose();
                  setTimeout(() => onScan(code.trim()), 200);
                });
            },
            () => {},
          );
        } catch (e: unknown) {
          const msg = (e as Error)?.message?.toLowerCase() || "";
          if (msg.includes("permission") || msg.includes("notallowed"))
            setFallbackError("Camera access denied. Please allow camera permissions.");
          else if (msg.includes("notfound")) setFallbackError("No camera found.");
          else setFallbackError("Camera not available.");
        }
      }, 200);
    }
  };

  const currentError = isSupported ? error : fallbackError;
  const currentScanning = isSupported ? scanning : !currentError && open;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" /> Camera Scanner
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div
            ref={videoContainerRef}
            id={!isSupported ? "qr-reader-fallback" : undefined}
            className="w-full rounded-lg overflow-hidden min-h-[200px] bg-muted relative"
          >
            {scanning && isSupported && (
              <div className="absolute inset-0 pointer-events-none z-10">
                <div className="absolute inset-0 border-2 border-primary/50 rounded-lg" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-16 border-2 border-primary rounded-md animate-pulse" />
              </div>
            )}
            {!currentScanning && !currentError && (
              <div className="min-h-[200px] flex items-center justify-center">
                <span className="text-sm text-muted-foreground">Starting camera...</span>
              </div>
            )}
          </div>
          {currentError && (
            <div className="space-y-2">
              <p className="text-sm text-destructive text-center">{currentError}</p>
              <Button variant="outline" className="w-full" onClick={handleRetry}>
                <RefreshCw className="h-4 w-4 mr-2" /> Retry
              </Button>
            </div>
          )}
          {currentScanning && !currentError && (
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
