/**
 * ASSET VERIFICATION — Tactical Scanner (3 scans: EXTERIOR / INTERIOR / WORKSTATION).
 *
 * Delegates each scan to the reducer through `onCompleteScan(tier, previewUrl)`.
 * Tier is inferred from the current `scansCompleted` count (0→t1, 1→t2, 2→t3)
 * so the switchboard can fire SET_PREP_PREVIEW + SECURE_PREP_TASK in order.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Check, Shield, Lock } from "lucide-react";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";

interface Props {
  scansCompleted: number;
  onCompleteScan: (tier: 1 | 2 | 3, previewDataUrl?: string | null) => void;
}

const SCAN_LABELS = ["EXTERIOR", "INTERIOR", "WORKSTATION"] as const;
const SCAN_DESCRIPTIONS = [
  "Scan vehicle exterior — confirm clean",
  "Scan vehicle interior — confirm organized",
  "Scan flyer workstation — confirm stocked",
] as const;

export default function AssetVerification({
  scansCompleted,
  onCompleteScan,
}: Props) {
  const [isScanning, setIsScanning] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [time, setTime] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const currentScan = Math.min(scansCompleted, 2);
  const tier = (currentScan + 1) as 1 | 2 | 3;

  useEffect(() => {
    const update = () =>
      setTime(new Date().toLocaleTimeString("en-US", { hour12: false }));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  const processScan = useCallback(() => {
    setIsScanning(true);
    sounds.shutter();
    haptics.shutter();
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 150);

    setTimeout(() => {
      setIsScanning(false);
      setShowConfirm(true);
      sounds.scanConfirm();
      haptics.impact();
    }, 1000);

    setTimeout(() => {
      setShowConfirm(false);
      const capturedPreview = previewUrlRef.current;
      setPreviewUrl(null);
      previewUrlRef.current = null;
      onCompleteScan(tier, capturedPreview);
      if (fileRef.current) fileRef.current.value = "";
    }, 1800);
  }, [onCompleteScan, tier]);

  const handleCapture = useCallback(() => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      fileRef.current?.click();
    } else {
      processScan();
    }
  }, [processScan]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      previewUrlRef.current = url;
      processScan();
    },
    [processScan]
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-black relative overflow-hidden flex flex-col"
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      <AnimatePresence>
        {showFlash && (
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-white z-50"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center"
          >
            <div className="text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", damping: 8 }}
                className="w-20 h-20 border-2 border-neon mx-auto mb-4 flex items-center justify-center"
              >
                <Check className="w-10 h-10 text-neon" />
              </motion.div>
              <p className="text-[10px] tracking-[0.4em] text-neon uppercase font-semibold">
                Scan Verified
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[8px] tracking-[0.4em] text-neon/50 uppercase">
              Asset Verification
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Scan {currentScan + 1} of 3
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-neon/50" />
            <span className="text-[9px] text-neon/50 tracking-wider uppercase">
              Secure
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 flex gap-2">
        {SCAN_LABELS.map((label, i) => (
          <div key={label} className="flex-1">
            <div
              className={`h-[3px] mb-2 transition-all duration-500 ${
                i < scansCompleted
                  ? "bg-neon shadow-[0_0_6px_oklch(0.85_0.25_155/0.5)]"
                  : i === currentScan
                    ? "bg-neon/30 animate-pulse-neon"
                    : "bg-border/20"
              }`}
            />
            <div className="flex items-center gap-1.5">
              {i < scansCompleted ? (
                <Check className="w-3 h-3 text-neon" />
              ) : i === currentScan ? (
                <div className="w-2 h-2 border border-neon rotate-45 animate-pulse-neon" />
              ) : (
                <Lock className="w-2.5 h-2.5 text-muted-foreground/30" />
              )}
              <span
                className={`text-[7px] tracking-[0.15em] uppercase font-semibold ${
                  i < scansCompleted
                    ? "text-neon"
                    : i === currentScan
                      ? "text-foreground/80"
                      : "text-muted-foreground/30"
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex-1 relative mx-4 my-2 border border-neon/15 overflow-hidden bg-void-light/50">
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Scan preview"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute left-0 right-0 h-px bg-neon/20" />
          <div className="absolute top-0 bottom-0 w-px bg-neon/20" />
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            className="w-16 h-16 border border-neon/40"
            style={{ clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" }}
          />
          <div className="absolute w-6 h-6 border border-neon/60" />
          <div className="absolute w-1 h-1 bg-neon" />
        </div>

        <div className="absolute top-3 left-3 w-8 h-8 border-t-2 border-l-2 border-neon/50" />
        <div className="absolute top-3 right-3 w-8 h-8 border-t-2 border-r-2 border-neon/50" />
        <div className="absolute bottom-3 left-3 w-8 h-8 border-b-2 border-l-2 border-neon/50" />
        <div className="absolute bottom-3 right-3 w-8 h-8 border-b-2 border-r-2 border-neon/50" />

        {isScanning && (
          <motion.div
            initial={{ top: "0%" }}
            animate={{ top: "100%" }}
            transition={{ duration: 0.8, ease: "linear", repeat: 1 }}
            className="absolute left-0 right-0 h-0.5 bg-neon shadow-[0_0_16px_oklch(0.85_0.25_155),0_0_4px_oklch(0.85_0.25_155)]"
          />
        )}

        <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end pointer-events-none">
          <p className="text-[7px] text-neon/40 tracking-wider font-mono">
            {time}
          </p>
          <p
            className={`text-[7px] tracking-wider font-mono ${
              isScanning
                ? "text-amber animate-pulse-neon"
                : "text-neon/40"
            }`}
          >
            {isScanning ? "PROCESSING..." : "READY"}
          </p>
        </div>
      </div>

      <div className="px-4 py-3 text-center">
        <p className="font-display font-extrabold text-2xl uppercase tracking-wider text-foreground">
          {SCAN_LABELS[currentScan]}
        </p>
        <p className="text-[10px] text-muted-foreground mt-1">
          {SCAN_DESCRIPTIONS[currentScan]}
        </p>
      </div>

      <div className="px-4 pb-8 pt-2">
        <button
          onClick={handleCapture}
          disabled={isScanning || showConfirm}
          className="w-full py-4 border-2 border-neon/80 flex items-center justify-center gap-3
                     active:bg-neon/10 transition-all disabled:opacity-30 disabled:border-neon/20
                     hover:shadow-[0_0_16px_oklch(0.85_0.25_155/0.2)]"
        >
          <Camera className="w-5 h-5 text-neon" />
          <span className="font-display font-extrabold text-lg uppercase tracking-wider text-neon">
            {isScanning ? "Scanning..." : showConfirm ? "Verified" : "Capture"}
          </span>
        </button>
      </div>
    </motion.div>
  );
}
