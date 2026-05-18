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

export function BarcodeScanner({ open, onClose, onScan }: BarcodeScannerProps) {
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [fallbackScanning, setFallbackScanning] = useState(false);
  const quaggaInitRef = useRef(false);

  const handleScan = (code: string) => {
    onClose();
    setTimeout(() => onScan(code), 200);
  };

  const { videoRef, scanning, error, isSupported, start, stop } = useBarcodeScanner({
    onScan: handleScan,
    fps: 10,
    facingMode: "environment",
  });

  useEffect(() => {
    if (!open || !isSupported) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      await start();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop();
    };
  }, [open, isSupported, start, stop]);

  useEffect(() => {
    if (!open || isSupported || quaggaInitRef.current) return;

    let cancelled = false;
    setFallbackError(null);
    quaggaInitRef.current = true;

    const timer = setTimeout(async () => {
      try {
        const Quagga = (await import("@ericblade/quagga2")).default;

        Quagga.init(
          {
            inputStream: {
              type: "LiveStream",
              target: document.getElementById("quagga-container")!,
              constraints: {
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
            },
            decoder: {
              readers: [
                "ean_reader",
                "ean_8_reader",
                "code_128_reader",
                "code_39_reader",
                "upc_reader",
                "upc_e_reader",
                "i2of5_reader",
                "codabar_reader",
              ],
            },
            locate: true,
            frequency: 10,
          },
          (err: Error | null) => {
            if (err) {
              console.error("Quagga init error:", err);
              setFallbackError("Camera not available. Please allow camera access.");
              quaggaInitRef.current = false;
              return;
            }
            if (!cancelled) {
              setFallbackScanning(true);
              Quagga.start();
            }
          },
        );

        Quagga.onDetected((result) => {
          if (cancelled) return;
          const code = result.codeResult?.code;
          if (code) {
            cancelled = true;
            Quagga.stop();
            quaggaInitRef.current = false;
            setFallbackScanning(false);
            onClose();
            setTimeout(() => onScan(code.trim()), 200);
          }
        });
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = (e as Error)?.message?.toLowerCase() || "";
          if (msg.includes("permission") || msg.includes("notallowed"))
            setFallbackError("Camera access denied. Please allow camera permissions.");
          else if (msg.includes("notfound")) setFallbackError("No camera found.");
          else setFallbackError("Camera not available.");
          quaggaInitRef.current = false;
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      import("@ericblade/quagga2").then((m) => m.default.stop()).catch(() => {});
      quaggaInitRef.current = false;
      setFallbackScanning(false);
    };
  }, [open, isSupported, onClose, onScan]);

  const handleRetry = () => {
    if (isSupported) {
      stop();
      setTimeout(async () => {
        await start();
      }, 200);
    } else {
      setFallbackError(null);
      import("@ericblade/quagga2").then((m) => m.default.stop()).catch(() => {});
      quaggaInitRef.current = false;
      setFallbackScanning(false);
      setTimeout(() => {
        setFallbackError(null);
      }, 200);
    }
  };

  const currentError = isSupported ? error : fallbackError;
  const currentScanning = isSupported ? scanning : fallbackScanning;

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
            id={!isSupported ? "quagga-container" : undefined}
            className="relative w-full h-80 overflow-hidden rounded-lg bg-black"
          >
            {isSupported && (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
            {scanning && isSupported && (
              <div className="absolute inset-0 pointer-events-none z-10">
                <div className="absolute inset-0 border-2 border-primary/50 rounded-lg" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-16 border-2 border-primary rounded-md animate-pulse" />
              </div>
            )}
            {!currentScanning && !currentError && (
              <div className="absolute inset-0 flex items-center justify-center">
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
