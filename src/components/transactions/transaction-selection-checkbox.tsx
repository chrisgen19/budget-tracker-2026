"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface TransactionSelectionCheckboxProps {
  label: string;
  state: "none" | "some" | "all";
  onChange: () => void;
  className?: string;
}
export function TransactionSelectionCheckbox({
  label,
  state,
  onChange,
  className,
}: TransactionSelectionCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);

  return (
    <label
      className={cn(
        "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg focus-within:ring-2 focus-within:ring-amber/40",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={state === "all"}
        onChange={onChange}
        aria-label={label}
        className="h-5 w-5 cursor-pointer rounded border-cream-300 accent-amber"
      />
    </label>
  );
}
