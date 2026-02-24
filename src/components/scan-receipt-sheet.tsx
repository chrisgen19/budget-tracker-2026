"use client";

import { useRef, useState } from "react";
import { Camera, ImagePlus, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";

interface ScanReceiptSheetProps {
  open: boolean;
  onClose: () => void;
  onFileSelected: (file: File) => void;
  onMultipleFilesSelected: (files: File[]) => void;
  isScanning?: boolean;
  error?: string | null;
  maxUploadFiles: number;
  /** null = unlimited, 0 = none remaining, positive = remaining count */
  scansRemaining: number | null;
}

export function ScanReceiptSheet({
  open,
  onClose,
  onFileSelected,
  onMultipleFilesSelected,
  isScanning,
  error,
  maxUploadFiles,
  scansRemaining,
}: ScanReceiptSheetProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
    e.target.value = "";
  };

  // Cap upload count by both maxUploadFiles and remaining scans
  const effectiveMaxFiles =
    scansRemaining !== null
      ? Math.min(maxUploadFiles, scansRemaining)
      : maxUploadFiles;

  const handleUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (files.length > effectiveMaxFiles) {
      const reason =
        scansRemaining !== null && scansRemaining < maxUploadFiles
          ? `You have ${scansRemaining} scan${scansRemaining === 1 ? "" : "s"} remaining this month.`
          : `You can upload up to ${maxUploadFiles} images at a time.`;
      setUploadError(reason);
      e.target.value = "";
      return;
    }

    setUploadError(null);
    onMultipleFilesSelected(Array.from(files));
    e.target.value = "";
  };

  return (
    <Modal open={open} onClose={onClose} title="Scan Receipt">
      {isScanning ? (
        /* Scanning state */
        <div className="flex flex-col items-center justify-center py-8 gap-4">
          <div className="w-12 h-12 border-3 border-cream-300 border-t-amber rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-sm font-medium text-warm-600">
              Scanning receipt...
            </p>
            <p className="text-xs text-warm-400 mt-1">
              This may take a few seconds
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Error message */}
          {(error || uploadError) && (
            <div className="flex items-start gap-3 mb-4 p-3 rounded-xl bg-expense-light/50 border border-expense/20">
              <AlertCircle className="w-5 h-5 text-expense shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-expense font-medium">{error || uploadError}</p>
                <p className="text-xs text-warm-400 mt-1">
                  {uploadError ? "Please select fewer images" : "Try again with a clearer photo"}
                </p>
              </div>
            </div>
          )}

          {/* Scan limit info */}
          {scansRemaining !== null && (
            <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-xl bg-cream-100 border border-cream-200">
              <Info className="w-4 h-4 text-warm-400 shrink-0" />
              <p className="text-xs text-warm-500">
                {scansRemaining === 0
                  ? "No scans remaining this month"
                  : `${scansRemaining} scan${scansRemaining === 1 ? "" : "s"} remaining this month`}
              </p>
            </div>
          )}

          {/* Default buttons */}
          <div className="space-y-3">
            <button
              type="button"
              disabled={scansRemaining === 0}
              onClick={() => cameraInputRef.current?.click()}
              className={cn(
                "flex items-center gap-4 w-full px-4 py-4 rounded-xl border border-cream-300 transition-colors",
                scansRemaining === 0
                  ? "bg-cream-100 opacity-50 cursor-not-allowed"
                  : "bg-cream-50/50 hover:bg-cream-100 text-warm-600"
              )}
            >
              <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
                <Camera className="w-5 h-5 text-amber-dark" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium">Take Photo</p>
                <p className="text-xs text-warm-400">
                  Use your camera to capture a receipt
                </p>
              </div>
            </button>

            <button
              type="button"
              disabled={scansRemaining === 0}
              onClick={() => uploadInputRef.current?.click()}
              className={cn(
                "flex items-center gap-4 w-full px-4 py-4 rounded-xl border border-cream-300 transition-colors",
                scansRemaining === 0
                  ? "bg-cream-100 opacity-50 cursor-not-allowed"
                  : "bg-cream-50/50 hover:bg-cream-100 text-warm-600"
              )}
            >
              <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
                <ImagePlus className="w-5 h-5 text-amber-dark" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium">Upload Image</p>
                <p className="text-xs text-warm-400">
                  Choose one or more receipt photos
                </p>
              </div>
            </button>
          </div>
        </>
      )}

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraChange}
        className="hidden"
      />
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleUploadChange}
        className="hidden"
      />
    </Modal>
  );
}
