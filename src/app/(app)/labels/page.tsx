"use client";

import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Tag, Clock, Play, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { LabelForm } from "@/components/labels/label-form";
import { QuickLabelPicker } from "@/components/labels/quick-label-picker";
import { ActionFab } from "@/components/ui/action-fab";
import {
  useLabelsQuery,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
  useApplyLabelSchedule,
  useQuickLabelsQuery,
  useSaveQuickLabels,
  type TypeChangeConfirmation,
} from "@/hooks/use-labels";
import type { LabelInput } from "@/lib/validations";
import type { LabelWithCountAndSchedules } from "@/types";

export default function LabelsPage() {
  const [showForm, setShowForm] = useState(false);
  const [showQuickPicker, setShowQuickPicker] = useState(false);
  const [editingLabel, setEditingLabel] = useState<LabelWithCountAndSchedules | null>(null);
  const [deletingLabel, setDeletingLabel] = useState<LabelWithCountAndSchedules | null>(null);
  const [applyingLabel, setApplyingLabel] = useState<LabelWithCountAndSchedules | null>(null);
  const [applyResult, setApplyResult] = useState<{ applied: number; removed: number } | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [typeChangeConfirm, setTypeChangeConfirm] = useState<{
    id: string;
    input: LabelInput;
    affectedCount: number;
    removedType: string;
  } | null>(null);

  const { data: labels = [], isLoading: loading } = useLabelsQuery();
  const { data: quickLabelIds = [], isLoading: quickLoading } = useQuickLabelsQuery();
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();
  const applySchedule = useApplyLabelSchedule();
  const saveQuickLabels = useSaveQuickLabels();

  // Resolve stored quick-label IDs to labels (drop any that no longer exist), preserving order
  const quickLabels = quickLabelIds
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is LabelWithCountAndSchedules => l != null);
  // Only pass resolvable IDs to the picker so stale/deleted IDs can't make it appear "full"
  const resolvedQuickLabelIds = quickLabels.map((l) => l.id);

  const handleQuickSave = (ids: string[]) => {
    saveQuickLabels.mutate(ids, {
      onSuccess: () => setShowQuickPicker(false),
      onError: (err) =>
        setApplyError(err instanceof Error ? err.message : "Failed to save quick labels"),
    });
  };

  // Auto-dismiss apply result/error toast after 3 seconds
  useEffect(() => {
    if (applyResult === null && applyError === null) return;
    const timer = setTimeout(() => {
      setApplyResult(null);
      setApplyError(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [applyResult, applyError]);

  const handleCreate = async (input: LabelInput) => {
    await createLabel.mutateAsync(input);
    setShowForm(false);
  };

  const handleUpdate = async (input: LabelInput) => {
    if (!editingLabel) return;
    try {
      await updateLabel.mutateAsync({ id: editingLabel.id, input });
      setEditingLabel(null);
    } catch (err) {
      // Handle 409 confirmation for type narrowing
      const error = err as Error & { data?: TypeChangeConfirmation };
      if (error.message === "needs_confirmation" && error.data) {
        setTypeChangeConfirm({
          id: editingLabel.id,
          input,
          affectedCount: error.data.affectedCount,
          removedType: error.data.removedType,
        });
      }
    }
  };

  const handleTypeChangeConfirm = async () => {
    if (!typeChangeConfirm) return;
    await updateLabel.mutateAsync({
      id: typeChangeConfirm.id,
      input: typeChangeConfirm.input,
      confirmRemoval: true,
    });
    setTypeChangeConfirm(null);
    setEditingLabel(null);
  };

  const handleDelete = () => {
    if (!deletingLabel) return;
    deleteLabel.mutate(deletingLabel.id, {
      onSuccess: () => setDeletingLabel(null),
    });
  };

  const handleApply = () => {
    if (!applyingLabel) return;
    applySchedule.mutate(applyingLabel.id, {
      onSuccess: (data) => {
        setApplyResult({ applied: data.applied, removed: data.removed ?? 0 });
        setApplyingLabel(null);
      },
      onError: (err) => {
        setApplyError(err instanceof Error ? err.message : "Failed to apply schedule");
        setApplyingLabel(null);
      },
    });
  };

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl lg:text-3xl text-warm-700">
            Labels
          </h1>
          <p className="text-warm-400 text-sm mt-1">
            Create labels to tag and organize your transactions.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="hidden sm:inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white font-medium text-sm px-5 py-2.5 rounded-xl transition-colors shadow-soft hover:shadow-soft-md"
        >
          <Plus className="w-4 h-4" />
          New Label
        </button>
      </div>

      {/* Quick Access Section */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber" />
            <h2 className="font-serif text-lg text-warm-700">Quick Access</h2>
          </div>
          {labels.length > 0 && !quickLoading && (
            <button
              onClick={() => setShowQuickPicker(true)}
              className="text-xs text-amber hover:text-amber-dark font-medium transition-colors"
            >
              Edit
            </button>
          )}
        </div>
        <p className="text-xs text-warm-400 mb-4">
          Labels that appear first when adding transactions.
        </p>

        {quickLoading || loading ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="w-24 h-9 rounded-full animate-shimmer" />
            ))}
          </div>
        ) : quickLabels.length === 0 ? (
          <button
            onClick={() => setShowQuickPicker(true)}
            disabled={labels.length === 0}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-full border-2 border-dashed border-cream-300 text-warm-400 hover:border-amber/40 hover:text-warm-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            Choose quick labels
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            {quickLabels.map((lbl) => (
              <span
                key={lbl.id}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-full"
                style={{ backgroundColor: lbl.color + "18", color: lbl.color }}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: lbl.color }} />
                {lbl.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full animate-shimmer" />
                <div className="flex-1 space-y-2">
                  <div className="w-24 h-4 rounded animate-shimmer" />
                  <div className="w-16 h-3 rounded animate-shimmer" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : labels.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No labels yet"
          description="Create labels to tag your transactions for better organization."
          action={
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-soft"
            >
              <Plus className="w-4 h-4" />
              Create Label
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence mode="popLayout">
            {labels.map((lbl) => {
              const hasSchedules = lbl.schedules.length > 0;
              return (
                <motion.div
                  key={lbl.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="card-hover p-4 group"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: lbl.color + "18" }}
                    >
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: lbl.color }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-warm-600 truncate">
                          {lbl.name}
                        </p>
                        {hasSchedules && (
                          <Clock className="w-3 h-3 text-amber shrink-0" />
                        )}
                        {lbl.applicableTo !== "BOTH" && (
                          <span className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0",
                            lbl.applicableTo === "EXPENSE"
                              ? "bg-expense-light text-expense"
                              : "bg-income-light text-income"
                          )}>
                            {lbl.applicableTo === "EXPENSE" ? "Expense" : "Income"}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-warm-300">
                        {lbl._count.transactions}{" "}
                        {lbl._count.transactions === 1
                          ? "transaction"
                          : "transactions"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      {hasSchedules && (
                        <button
                          onClick={() => setApplyingLabel(lbl)}
                          className="p-1.5 rounded-lg text-warm-300 hover:text-income hover:bg-income-light transition-colors"
                          title="Apply to existing transactions"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => setEditingLabel(lbl)}
                        className="p-1.5 rounded-lg text-warm-300 hover:text-amber hover:bg-amber-light transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeletingLabel(lbl)}
                        className="p-1.5 rounded-lg text-warm-300 hover:text-expense hover:bg-expense-light transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Create Label Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New Label"
      >
        <LabelForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      {/* Quick Label Picker Modal */}
      <Modal
        open={showQuickPicker}
        onClose={() => setShowQuickPicker(false)}
        title="Quick Access Labels"
      >
        <QuickLabelPicker
          selectedIds={resolvedQuickLabelIds}
          allLabels={labels}
          onSave={handleQuickSave}
          onCancel={() => setShowQuickPicker(false)}
          saving={saveQuickLabels.isPending}
        />
      </Modal>

      {/* Edit Label Modal */}
      <Modal
        open={!!editingLabel}
        onClose={() => setEditingLabel(null)}
        title="Edit Label"
      >
        {editingLabel && (
          <LabelForm
            label={editingLabel}
            onSubmit={handleUpdate}
            onCancel={() => setEditingLabel(null)}
          />
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={!!deletingLabel}
        onClose={() => setDeletingLabel(null)}
        onConfirm={handleDelete}
        title="Delete Label"
        message={
          <p>
            Are you sure you want to delete{" "}
            <span className="font-medium text-warm-700">
              &ldquo;{deletingLabel?.name}&rdquo;
            </span>
            ?
            {deletingLabel && deletingLabel._count.transactions > 0 ? (
              <>
                {" "}
                This will remove the label from{" "}
                <span className="font-medium text-warm-700">
                  {deletingLabel._count.transactions}{" "}
                  {deletingLabel._count.transactions === 1
                    ? "transaction"
                    : "transactions"}
                </span>
                .
              </>
            ) : (
              " This label has no transactions."
            )}
          </p>
        }
        loading={deleteLabel.isPending}
      />

      {/* Apply Schedule Confirmation Modal */}
      <ConfirmModal
        open={!!applyingLabel}
        onClose={() => setApplyingLabel(null)}
        onConfirm={handleApply}
        title="Apply Schedule to Existing"
        confirmLabel="Apply"
        message={
          <p>
            This will scan all your transactions and apply the{" "}
            <span className="font-medium text-warm-700">
              &ldquo;{applyingLabel?.name}&rdquo;
            </span>{" "}
            label where the schedule matches. Labels already applied won&apos;t
            be duplicated.
          </p>
        }
        loading={applySchedule.isPending}
      />

      {/* Type Change Confirmation Modal */}
      <ConfirmModal
        open={!!typeChangeConfirm}
        onClose={() => setTypeChangeConfirm(null)}
        onConfirm={handleTypeChangeConfirm}
        title="Remove Label from Transactions"
        confirmLabel="Remove"
        message={
          <p>
            This will remove the label from{" "}
            <span className="font-medium text-warm-700">
              {typeChangeConfirm?.affectedCount}{" "}
              {typeChangeConfirm?.removedType?.toLowerCase()}{" "}
              {typeChangeConfirm?.affectedCount === 1 ? "transaction" : "transactions"}
            </span>
            . This action cannot be undone.
          </p>
        }
        loading={updateLabel.isPending}
      />

      {/* Apply Result / Error Toast */}
      <AnimatePresence>
        {applyResult !== null && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-warm-800 text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50"
          >
            Applied to {applyResult.applied}{" "}
            {applyResult.applied === 1 ? "transaction" : "transactions"}
            {applyResult.removed > 0 && (
              <>, removed from {applyResult.removed}</>
            )}
            .
          </motion.div>
        )}
        {applyError && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-expense text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50"
          >
            {applyError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile FAB */}
      <ActionFab label="Label" icon={Plus} onClick={() => setShowForm(true)} />
    </div>
  );
}
