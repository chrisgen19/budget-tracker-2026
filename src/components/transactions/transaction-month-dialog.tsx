"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

interface TransactionMonthDialogProps {
  open: boolean;
  onClose: () => void;
  year: number;
  onYearChange: (year: number) => void;
  selectedMonth: string;
  currentMonth: string;
  onSelect: (month: string) => void;
}

export function TransactionMonthDialog({
  open,
  onClose,
  year,
  onYearChange,
  selectedMonth,
  currentMonth,
  onSelect,
}: TransactionMonthDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="Choose month">
      <div className="space-y-5">
        <div className="flex items-center justify-between rounded-xl bg-cream-50 p-1">
          <button type="button" onClick={() => onYearChange(year - 1)} aria-label="Previous year" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-warm-400 transition-colors hover:bg-white hover:text-warm-700">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="font-serif text-xl text-warm-700">{year}</span>
          <button type="button" onClick={() => onYearChange(year + 1)} aria-label="Next year" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-warm-400 transition-colors hover:bg-white hover:text-warm-700">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {MONTH_NAMES.map((monthName, index) => {
            const value = `${year}-${String(index + 1).padStart(2, "0")}`;
            const selected = selectedMonth === value;
            return (
              <button key={monthName} type="button" onClick={() => onSelect(value)} aria-pressed={selected} className={cn("min-h-11 rounded-xl border px-2 text-sm font-medium transition-colors", selected ? "border-amber bg-amber-light/35 text-amber-dark" : "border-cream-200 text-warm-500 hover:border-cream-300 hover:bg-cream-50 hover:text-warm-700")}>
                {monthName.slice(0, 3)}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 border-t border-cream-200 pt-4">
          <button type="button" onClick={() => onSelect("ALL")} className="min-h-11 flex-1 rounded-xl border border-cream-200 px-3 text-sm font-semibold text-warm-500 transition-colors hover:bg-cream-50 hover:text-warm-700">All time</button>
          <button type="button" onClick={() => onSelect(currentMonth)} className="min-h-11 flex-1 rounded-xl bg-amber px-3 text-sm font-semibold text-white transition-colors hover:bg-amber-dark">This month</button>
        </div>
      </div>
    </Modal>
  );
}
