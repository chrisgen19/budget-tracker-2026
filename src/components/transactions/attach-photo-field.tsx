"use client";

import { useRef, type RefObject } from "react";
import { Paperclip } from "lucide-react";

interface AttachPhotoFieldProps {
  hasPhoto: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
  /** Lets the form open this same picker from elsewhere, e.g. the viewer's Replace. */
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * The receipt photo field: a dashed "Attach photo" button when there is none, and
 * "Replace photo · Remove photo" when one is shown. No `capture`, so a phone offers the
 * library as well as the camera: a receipt is as often a saved screenshot as a fresh shot.
 */
export function AttachPhotoField({ hasPhoto, onSelect, onRemove, inputRef: sharedRef }: AttachPhotoFieldProps) {
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = sharedRef ?? ownRef;
  const openPicker = () => inputRef.current?.click();

  const input = (
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

  if (hasPhoto) {
    return (
      <div className="-my-3 flex items-center gap-1 text-xs text-warm-400">
        {input}
        <button
          type="button"
          onClick={openPicker}
          className="min-h-11 px-1 hover:text-warm-600 transition-colors"
        >
          Replace photo
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={onRemove}
          className="min-h-11 px-1 hover:text-expense transition-colors"
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
        className="w-full min-h-11 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-[1.5px] border-dashed border-cream-400 text-sm text-warm-400 hover:text-warm-600 hover:border-warm-300 transition-colors"
      >
        <Paperclip className="w-4 h-4" aria-hidden="true" />
        Attach photo
      </button>
    </div>
  );
}
