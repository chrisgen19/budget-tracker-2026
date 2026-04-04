"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Tag } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { LabelForm } from "@/components/labels/label-form";
import { MobileFab } from "@/components/ui/mobile-fab";
import {
  useLabelsQuery,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
} from "@/hooks/use-labels";
import type { LabelInput } from "@/lib/validations";
import type { LabelWithCount } from "@/types";

export default function LabelsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editingLabel, setEditingLabel] = useState<LabelWithCount | null>(null);
  const [deletingLabel, setDeletingLabel] = useState<LabelWithCount | null>(null);

  const { data: labels = [], isLoading: loading } = useLabelsQuery();
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();

  const handleCreate = async (input: LabelInput) => {
    await createLabel.mutateAsync(input);
    setShowForm(false);
  };

  const handleUpdate = async (input: LabelInput) => {
    if (!editingLabel) return;
    await updateLabel.mutateAsync({ id: editingLabel.id, input });
    setEditingLabel(null);
  };

  const handleDelete = () => {
    if (!deletingLabel) return;
    deleteLabel.mutate(deletingLabel.id, {
      onSuccess: () => setDeletingLabel(null),
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
            {labels.map((lbl) => (
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
                    <p className="text-sm font-medium text-warm-600 truncate">
                      {lbl.name}
                    </p>
                    <p className="text-xs text-warm-300">
                      {lbl._count.transactions}{" "}
                      {lbl._count.transactions === 1
                        ? "transaction"
                        : "transactions"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
            ))}
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
            ? This will remove the label from all transactions.
          </p>
        }
        loading={deleteLabel.isPending}
      />

      {/* Mobile FAB */}
      <MobileFab label="Label" icon={Plus} onClick={() => setShowForm(true)} />
    </div>
  );
}
