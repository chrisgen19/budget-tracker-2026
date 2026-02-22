"use client";

import { useRef } from "react";
import { Camera, ImagePlus, AlertCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";

interface ScanReceiptSheetProps {
  open: boolean;
  onClose: () => void;
  onFileSelected: (file: File) => void;
  isScanning?: boolean;
  error?: string | null;
}

export function ScanReceiptSheet({
  open,
  onClose,
  onFileSelected,
  isScanning,
  error,
}: ScanReceiptSheetProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
      // Parent controls sheet lifecycle now — don't close here
    }
    // Reset so the same file can be re-selected
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
          {error && (
            <div className="flex items-start gap-3 mb-4 p-3 rounded-xl bg-expense-light/50 border border-expense/20">
              <AlertCircle className="w-5 h-5 text-expense shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-expense font-medium">{error}</p>
                <p className="text-xs text-warm-400 mt-1">
                  Try again with a clearer photo
                </p>
              </div>
            </div>
          )}

          {/* Default buttons */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex items-center gap-4 w-full px-4 py-4 rounded-xl border border-cream-300 bg-cream-50/50 hover:bg-cream-100 text-warm-600 transition-colors"
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
              onClick={() => uploadInputRef.current?.click()}
              className="flex items-center gap-4 w-full px-4 py-4 rounded-xl border border-cream-300 bg-cream-50/50 hover:bg-cream-100 text-warm-600 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
                <ImagePlus className="w-5 h-5 text-amber-dark" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium">Upload Image</p>
                <p className="text-xs text-warm-400">
                  Choose a receipt photo from your gallery
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
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
    </Modal>
  );
}
