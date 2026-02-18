"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Trash2, Tags, Lock, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { CategoryForm } from "@/components/categories/category-form";
import type { CategoryInput } from "@/lib/validations";
import type { Category } from "@/types";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "INCOME" | "EXPENSE">("ALL");
  const [showForm, setShowForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    const params = filter !== "ALL" ? `?type=${filter}` : "";
    const res = await fetch(`/api/categories${params}`);
    const data = await res.json();
    setCategories(data);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleCreate = async (input: CategoryInput) => {
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error || "Failed to create category");
    }

    setShowForm(false);
    fetchCategories();
  };

  const handleUpdate = async (input: CategoryInput) => {
    if (!editingCategory) return;

    const res = await fetch(`/api/categories/${editingCategory.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error || "Failed to update category");
    }

    setEditingCategory(null);
    fetchCategories();
  };

  const handleDelete = async () => {
    if (!deletingCategory) return;
    setDeleteLoading(true);
    setDeleteError("");

    const res = await fetch(`/api/categories/${deletingCategory.id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const body = await res.json();
      setDeleteError(body.error || "Failed to delete category");
      setDeleteLoading(false);
      return;
    }

    setDeleteLoading(false);
    setDeletingCategory(null);
    fetchCategories();
  };

  const defaultCategories = categories.filter((c) => c.isDefault);
  const customCategories = categories.filter((c) => !c.isDefault);

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl lg:text-3xl text-warm-700">
            Categories
          </h1>
          <p className="text-warm-400 text-sm mt-1">
            Manage your income and expense categories.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white font-medium text-sm px-5 py-2.5 rounded-xl transition-colors shadow-soft hover:shadow-soft-md"
        >
          <Plus className="w-4 h-4" />
          New Category
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-1 p-0.5 bg-cream-200/60 rounded-lg w-fit mb-6">
        {(["ALL", "EXPENSE", "INCOME"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={cn(
              "px-4 py-2 rounded-md text-xs font-medium transition-all duration-150",
              filter === type
                ? "bg-white text-warm-700 shadow-warm"
                : "text-warm-400 hover:text-warm-600"
            )}
          >
            {type === "ALL" ? "All" : type === "INCOME" ? "Income" : "Expenses"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl animate-shimmer" />
                <div className="flex-1 space-y-2">
                  <div className="w-24 h-4 rounded animate-shimmer" />
                  <div className="w-16 h-3 rounded animate-shimmer" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {/* Custom Categories */}
          {customCategories.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-warm-500 mb-3 uppercase tracking-wider">
                Your Categories
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <AnimatePresence mode="popLayout">
                  {customCategories.map((cat) => (
                    <motion.div
                      key={cat.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="card-hover p-4 group"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                          style={{ backgroundColor: cat.color + "18" }}
                        >
                          <CategoryIcon
                            name={cat.icon}
                            className="w-5 h-5"
                            style={{ color: cat.color }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-warm-600 truncate">
                            {cat.name}
                          </p>
                          <p className="text-xs text-warm-300">
                            {cat.type === "INCOME" ? "Income" : "Expense"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setEditingCategory(cat)}
                            className="p-1.5 rounded-lg text-warm-300 hover:text-amber hover:bg-amber-light transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setDeleteError("");
                              setDeletingCategory(cat);
                            }}
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
            </div>
          )}

          {/* Default Categories */}
          {defaultCategories.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-warm-500 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                <Lock className="w-3 h-3" />
                Default Categories
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {defaultCategories.map((cat) => (
                  <div key={cat.id} className="card p-4 opacity-80">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ backgroundColor: cat.color + "18" }}
                      >
                        <CategoryIcon
                          name={cat.icon}
                          className="w-5 h-5"
                          style={{ color: cat.color }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-warm-600 truncate">
                          {cat.name}
                        </p>
                        <p className="text-xs text-warm-300">
                          {cat.type === "INCOME" ? "Income" : "Expense"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {categories.length === 0 && (
            <EmptyState
              icon={Tags}
              title="No categories"
              description="Create custom categories to organize your transactions."
              action={
                <button
                  onClick={() => setShowForm(true)}
                  className="inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-soft"
                >
                  <Plus className="w-4 h-4" />
                  Create Category
                </button>
              }
            />
          )}
        </div>
      )}

      {/* Create Category Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New Category"
      >
        <CategoryForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      {/* Edit Category Modal */}
      <Modal
        open={!!editingCategory}
        onClose={() => setEditingCategory(null)}
        title="Edit Category"
      >
        {editingCategory && (
          <CategoryForm
            category={editingCategory}
            onSubmit={handleUpdate}
            onCancel={() => setEditingCategory(null)}
          />
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deletingCategory}
        onClose={() => setDeletingCategory(null)}
        title="Delete Category"
      >
        <p className="text-warm-500 text-sm mb-2">
          Are you sure you want to delete{" "}
          <span className="font-medium text-warm-700">
            &ldquo;{deletingCategory?.name}&rdquo;
          </span>
          ?
        </p>
        {deleteError && (
          <div className="bg-expense-light border border-expense/20 text-expense-dark px-4 py-3 rounded-xl text-sm mb-4">
            {deleteError}
          </div>
        )}
        <p className="text-warm-400 text-xs mb-6">
          Categories with existing transactions cannot be deleted.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setDeletingCategory(null)}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl border border-cream-300 text-warm-500 font-medium text-sm hover:bg-cream-100 transition-colors"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteLoading}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-expense hover:bg-expense-dark text-white font-medium text-sm transition-colors disabled:opacity-50"
          >
            {deleteLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Delete
              </>
            )}
          </button>
        </div>
      </Modal>
    </div>
  );
}
