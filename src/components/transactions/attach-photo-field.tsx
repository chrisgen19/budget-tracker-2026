"use client";

import { useRef, type RefObject } from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReceiptPhotoInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  onSelect: (file: File) => void;
}

/**
 * The hidden file input behind the photo field. Exported so a form can mount it once outside
 * anything that swaps views: the viewer's Replace opens it while the field itself is hidden.
 */
export function ReceiptPhotoInput({ inputRef, onSelect }: ReceiptPhotoInputProps) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      className="hidden"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const file = e.target.files?.[0];
        // Cleared so choosing the same file again still fires a change.
        e.target.value = "";
        if (file) onSelect(file);
      }}
    />
  );
}

interface AttachPhotoFieldProps {
  hasPhoto: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
  /**
   * An input the caller mounts itself with `ReceiptPhotoInput`, so it stays reachable while
   * this field is not rendered. Without one the field renders its own.
   */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** True while a save is in flight: a change made then would not be the one saved. */
  disabled?: boolean;
}

/**
 * The receipt photo field: a dashed "Attach photo" button when there is none, and
 * "Replace photo · Remove photo" when one is shown. No `capture`, so a phone offers the
 * library as well as the camera: a receipt is as often a saved screenshot as a fresh shot.
 */
export function AttachPhotoField({
  hasPhoto,
  onSelect,
  onRemove,
  inputRef: sharedRef,
  disabled = false,
}: AttachPhotoFieldProps) {
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = sharedRef ?? ownRef;
  const openPicker = () => inputRef.current?.click();
  const input = sharedRef ? null : <ReceiptPhotoInput inputRef={ownRef} onSelect={onSelect} />;

  if (hasPhoto) {
    return (
      <div className="-my-3 flex items-center gap-1 text-xs text-warm-400">
        {input}
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          className="min-h-11 px-1 hover:text-warm-600 transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          Replace photo
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="min-h-11 px-1 hover:text-expense transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          Remove photo
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-semibold text-warm-600 mb-2">
        Receipt photo <span className="font-normal text-warm-300">(Optional)</span>
      </p>
      {input}
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        className={cn(
          "w-full min-h-11 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-[1.5px] border-dashed border-cream-400 text-sm text-warm-400 hover:text-warm-600 hover:border-warm-300 transition-colors",
          "disabled:opacity-50 disabled:pointer-events-none",
        )}
      >
        <Paperclip className="w-4 h-4" aria-hidden="true" />
        Attach photo
      </button>
    </div>
  );
}
