"use client";

import { useRef } from "react";
import { Camera, ImagePlus } from "lucide-react";
import { Modal } from "@/components/ui/modal";

interface ScanReceiptSheetProps {
  open: boolean;
  onClose: () => void;
  onFileSelected: (file: File) => void;
}

export function ScanReceiptSheet({
  open,
  onClose,
  onFileSelected,
}: ScanReceiptSheetProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
      onClose();
    }
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  return (
    <Modal open={open} onClose={onClose} title="Scan Receipt">
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
