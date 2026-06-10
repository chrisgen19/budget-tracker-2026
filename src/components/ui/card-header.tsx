"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TINTS = {
  amber: "bg-amber-light text-amber",
  income: "bg-income-light text-income",
  expense: "bg-expense-light text-expense",
  neutral: "bg-cream-100 text-warm-500",
} as const;

interface CardHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  tint?: keyof typeof TINTS;
}

export function CardHeader({ icon: Icon, title, subtitle, action, tint = "amber" }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", TINTS[tint])}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h2 className="font-serif text-lg text-warm-700 truncate">{title}</h2>
          {subtitle && <p className="text-xs text-warm-300 truncate">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
