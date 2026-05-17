import { useRef, useState, useCallback, useEffect } from "react";

declare global {
  interface Window {
    BarcodeDetector: new (options?: { formats?: string[] }) => {
      detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>;
    };
  }
}

interface DetectedBarcode {
  rawValue: string;
  format: string;
}

interface UseBarcodeScannerOptions {
  onScan: (code: string) => void;
  fps?: number;
  facingMode?: "user" | "environment";
}

export function useBarcodeScanner({
  onScan,
  fps = 10,
  facingMode = "environment",
}: UseBarcodeScannerOptions) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastDetectTimeRef = useRef(0);
  const onScanRef = useRef(onScan);
  const doneRef = useRef(false);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const isSupported = typeof window !== "undefined" && "BarcodeDetector" in window;

  const detectFrame = useCallback(() => {
    if (!canvasRef.current || !videoRef.current || doneRef.current) return;
    const video = videoRef.current;
    if (video.readyState < 2) {
      rafRef.current = requestAnimationFrame(detectFrame);
      return;
    }
    const now = performance.now();
    if (now - lastDetectTimeRef.current >= 1000 / fps) {
      lastDetectTimeRef.current = now;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const detector = new window.BarcodeDetector({
          formats: [
            "ean_13",
            "ean_8",
            "code_128",
            "code_39",
            "upc_a",
            "upc_e",
            "itf",
            "codabar",
            "qr_code",
          ],
        });
        detector
          .detect(canvas)
          .then((barcodes: DetectedBarcode[]) => {
            if (barcodes.length > 0 && !doneRef.current) {
              doneRef.current = true;
              onScanRef.current(barcodes[0].rawValue.trim());
            }
          })
          .catch(() => {});
      }
    }
    rafRef.current = requestAnimationFrame(detectFrame);
  }, [fps]);

  const start = useCallback(async () => {
    setError(null);
    doneRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (!videoRef.current) {
        videoRef.current = document.createElement("video");
        videoRef.current.style.width = "100%";
        videoRef.current.style.height = "100%";
        videoRef.current.style.objectFit = "cover";
        videoRef.current.style.display = "block";
        videoRef.current.style.position = "absolute";
        videoRef.current.style.top = "0";
        videoRef.current.style.left = "0";
        videoRef.current.style.zIndex = "1";
        videoRef.current.setAttribute("playsinline", "true");
        videoRef.current.setAttribute("muted", "true");
        videoRef.current.setAttribute("autoplay", "true");
      }
      const video = videoRef.current;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play();
      if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
      setScanning(true);
      rafRef.current = requestAnimationFrame(detectFrame);
    } catch (e: unknown) {
      const msg = (e as Error)?.message?.toLowerCase() || "";
      if (msg.includes("permission") || msg.includes("notallowed"))
        setError("Camera access denied. Please allow camera permissions.");
      else if (msg.includes("notfound")) setError("No camera found.");
      else setError("Camera not available.");
    }
  }, [facingMode, detectFrame]);

  const stop = useCallback(() => {
    doneRef.current = true;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }, []);

  useEffect(
    () => () => {
      stop();
    },
    [stop],
  );

  return { videoRef, canvasRef, scanning, error, isSupported, start, stop };
}
