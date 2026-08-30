"use client";

import type { CSSProperties, ReactNode } from "react";
import { Download, FolderInput, Loader2, Pencil, Tags, Trash2, X } from "lucide-react";
import { useBillReminders } from "@/components/bills/bill-reminder-provider";
import { useInstallBanner } from "@/components/pwa/install-banner-context";
import { TransactionSelectionCheckbox } from "@/components/transactions/transaction-selection-checkbox";
import { getFabBottom } from "@/components/ui/bottom-overlay-clearance";
import { cn } from "@/lib/utils";

interface TransactionBulkActionBarProps {
  selectedCount: number;
  visibleCount: number;
  matchingCount: number | null;
  visibleState: "none" | "some" | "all";
  layout: "infinite" | "pagination";
  allMatchingPending: boolean;
  editPending: boolean;
  exportPending: boolean;
  updatePending: boolean;
  onToggleVisible: () => void;
  onSelectAllMatching: () => void;
  onEdit: () => void;
  onCategory: () => void;
  onLabels: () => void;
  onExport: () => void;
  onDelete: () => void;
  onClear: () => void;
}

function ActionButton({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  mobile = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  mobile?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        mobile ? "min-w-0 flex-col gap-0.5 px-1 text-[10px]" : "gap-1.5 px-3 text-xs",
        danger
          ? "text-expense hover:bg-expense-light"
          : "text-warm-500 hover:bg-cream-100",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

export function TransactionBulkActionBar(props: TransactionBulkActionBarProps) {
  const { bannerVisible, bannerHeight: installBannerHeight } = useInstallBanner();
  const { bannerHeight: billBannerHeight } = useBillReminders();
  const mobileBottom = getFabBottom({
    billBannerHeight,
    installBannerVisible: bannerVisible,
    installBannerHeight,
  });
  const scopeLabel = props.layout === "infinite" ? "loaded" : "on this page";
  const canSelectAllMatching =
    props.visibleState === "all" &&
    props.matchingCount !== null &&
    props.matchingCount > props.selectedCount;
  const selectedLabel = `${props.selectedCount} selected`;
  const scopeSummary = `${props.visibleCount} ${scopeLabel} · ${
    props.matchingCount === null ? "matching count loading" : `${props.matchingCount} matching`
  }`;

  const renderSelectAll = () =>
    canSelectAllMatching ? (
      <button
        type="button"
        onClick={props.onSelectAllMatching}
        disabled={props.allMatchingPending}
        className="min-h-11 rounded-lg px-2.5 text-xs font-semibold text-amber-dark underline-offset-2 hover:bg-amber-light/60 hover:underline disabled:opacity-50"
      >
        {props.allMatchingPending
          ? "Selecting…"
          : `Select all ${props.matchingCount} matching`}
      </button>
    ) : null;

  return (
    <>
      <div className="sticky top-16 z-20 hidden border-b border-amber/25 bg-amber-light/25 px-3 py-2 backdrop-blur-sm sm:block lg:top-0">
        <div className="flex flex-wrap items-center gap-2">
          <TransactionSelectionCheckbox
            label={`Select all ${props.visibleCount} ${scopeLabel} transactions`}
            state={props.visibleState}
            onChange={props.onToggleVisible}
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-warm-700">{selectedLabel}</p>
            <p className="text-[11px] text-warm-400">
              {scopeSummary}
            </p>
          </div>
          {renderSelectAll()}
          <div className="flex-1" />
          {props.selectedCount === 1 && (
            <ActionButton
              icon={props.editPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Pencil className="h-3.5 w-3.5" />}
              label={props.editPending ? "Loading transaction" : "Edit transaction"}
              onClick={props.onEdit}
              disabled={props.editPending}
            />
          )}
          <ActionButton
            icon={<FolderInput className="h-3.5 w-3.5" />}
            label="Category"
            onClick={props.onCategory}
            disabled={props.updatePending || props.editPending}
          />
          <ActionButton
            icon={<Tags className="h-3.5 w-3.5" />}
            label="Labels"
            onClick={props.onLabels}
            disabled={props.updatePending || props.editPending}
          />
          <ActionButton
            icon={<Download className="h-3.5 w-3.5" />}
            label="Export"
            onClick={props.onExport}
            disabled={props.exportPending}
          />
          <ActionButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Delete"
            onClick={props.onDelete}
            disabled={props.editPending}
            danger
          />
          <button
            type="button"
            onClick={props.onClear}
            aria-label="Clear transaction selection"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-warm-400 hover:bg-cream-100 hover:text-warm-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        style={{ "--selection-bottom": mobileBottom } as CSSProperties}
        className="fixed inset-x-2 z-40 rounded-2xl border border-amber/30 bg-white/95 p-2 shadow-soft-lg backdrop-blur-md bottom-[calc(var(--selection-bottom)+env(safe-area-inset-bottom))] sm:hidden"
      >
        <div className="flex items-center gap-1 px-1">
          <TransactionSelectionCheckbox
            label={`Select all ${props.visibleCount} ${scopeLabel} transactions`}
            state={props.visibleState}
            onChange={props.onToggleVisible}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-warm-700">{selectedLabel}</p>
            <p className="truncate text-[10px] text-warm-400">{scopeSummary}</p>
          </div>
          <button
            type="button"
            onClick={props.onClear}
            aria-label="Clear transaction selection"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-warm-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {canSelectAllMatching && (
          <div className="flex justify-center border-t border-amber/15 py-0.5">
            {renderSelectAll()}
          </div>
        )}
        <div className={cn("grid", props.selectedCount === 1 ? "grid-cols-5" : "grid-cols-4")}>
          {props.selectedCount === 1 && (
            <ActionButton
              icon={props.editPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Pencil className="h-4 w-4" />}
              label={props.editPending ? "Loading" : "Edit"}
              onClick={props.onEdit}
              disabled={props.editPending}
              mobile
            />
          )}
          <ActionButton
            icon={<FolderInput className="h-4 w-4" />}
            label="Category"
            onClick={props.onCategory}
            disabled={props.updatePending || props.editPending}
            mobile
          />
          <ActionButton
            icon={<Tags className="h-4 w-4" />}
            label="Labels"
            onClick={props.onLabels}
            disabled={props.updatePending || props.editPending}
            mobile
          />
          <ActionButton
            icon={<Download className="h-4 w-4" />}
            label="Export"
            onClick={props.onExport}
            disabled={props.exportPending}
            mobile
          />
          <ActionButton
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            onClick={props.onDelete}
            disabled={props.editPending}
            danger
            mobile
          />
        </div>
      </div>
    </>
  );
}
