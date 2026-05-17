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

async function getBackCameraDeviceId(): Promise<string | null> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === "videoinput");
    const backCamera = videoDevices.find(
      (d) =>
        d.label.toLowerCase().includes("back") ||
        d.label.toLowerCase().includes("rear") ||
        d.label.toLowerCase().includes("environment"),
    );
    if (backCamera?.deviceId) return backCamera.deviceId;
    return videoDevices.length > 0 ? videoDevices[videoDevices.length - 1].deviceId : null;
  } catch {
    return null;
  }
}

async function startFallbackScanner(
  elementId: string,
  onCode: (code: string) => void,
  scannerRef: React.MutableRefObject<Html5QrcodeScanner | null>,
): Promise<void> {
  const { Html5Qrcode } = await import("html5-qrcode");
  const scanner = new Html5Qrcode(elementId);
  scannerRef.current = scanner;

  const deviceId = await getBackCameraDeviceId();
  const videoConstraints: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: "environment" };

  await scanner.start(
    videoConstraints,
    {
      fps: 10,
      qrbox: (viewfinderWidth: number, viewfinderHeight: number) => ({
        width: Math.min(viewfinderWidth, viewfinderHeight) * 0.7,
        height: Math.min(viewfinderWidth, viewfinderHeight) * 0.4,
      }),
      aspectRatio: 1.777778,
    },
    (code: string) => {
      scanner
        .stop()
        .catch(() => {})
        .finally(() => {
          onCode(code.trim());
        });
    },
    () => {},
  );
}

export function BarcodeScanner({ open, onClose, onScan }: BarcodeScannerProps) {
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const html5ScannerRef = useRef<Html5QrcodeScanner | null>(null);

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
    if (!isSupported) {
      const style = document.createElement("style");
      style.id = "scanner-video-fix";
      style.textContent = `
        #qr-reader-fallback video,
        #reader video,
        #qr-reader video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          display: block !important;
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          z-index: 1 !important;
          background: black !important;
          border-radius: 8px;
        }
        #qr-reader-fallback,
        #reader,
        #qr-reader {
          min-height: 300px !important;
          position: relative !important;
          overflow: hidden !important;
        }
        #qr-reader-fallback > div,
        #reader > div,
        #qr-reader > div {
          position: relative !important;
          z-index: 2 !important;
        }
      `;
      document.head.appendChild(style);
      return () => {
        document.getElementById("scanner-video-fix")?.remove();
      };
    }
  }, [isSupported]);

  useEffect(() => {
    if (!open || isSupported) return;
    let cancelled = false;
    setFallbackError(null);
    const timer = setTimeout(async () => {
      try {
        await startFallbackScanner(
          "qr-reader-fallback",
          (code) => {
            if (!cancelled) {
              cancelled = true;
              onClose();
              setTimeout(() => onScan(code), 200);
            }
          },
          html5ScannerRef,
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
      setTimeout(async () => {
        await start();
      }, 200);
    } else {
      setFallbackError(null);
      if (html5ScannerRef.current) {
        html5ScannerRef.current.stop().catch(() => {});
        html5ScannerRef.current = null;
      }
      setTimeout(async () => {
        try {
          await startFallbackScanner(
            "qr-reader-fallback",
            (code) => {
              onClose();
              setTimeout(() => onScan(code), 200);
            },
            html5ScannerRef,
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
            id={!isSupported ? "qr-reader-fallback" : undefined}
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
