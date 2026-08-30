"use client";

import { useState } from "react";
import { Wallet, Pencil, Plus, CreditCard, Landmark, Smartphone, Banknote } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatCurrency } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionFab } from "@/components/ui/action-fab";
import { AccountForm } from "@/components/accounts/account-form";
import { useUser } from "@/components/user-provider";
import { usePrivacy } from "@/components/privacy-provider";
import {
  useAccountsQuery,
  useSaveAccountMutation,
  useDeleteAccountMutation,
} from "@/hooks/use-accounts";
import type { AccountInput } from "@/lib/validations";
import type { AccountBalance } from "@/lib/budget-query-types";

const TYPE_META = {
  CASH: { label: "Cash", icon: Banknote },
  BANK: { label: "Bank", icon: Landmark },
  CREDIT_CARD: { label: "Credit card", icon: CreditCard },
  EWALLET: { label: "E-wallet", icon: Smartphone },
} as const;

export default function AccountsPage() {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AccountBalance | null>(null);
  const [removing, setRemoving] = useState<AccountBalance | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: accounts = [], isLoading } = useAccountsQuery(showArchived);
  const saveAccount = useSaveAccountMutation();
  const deleteAccount = useDeleteAccountMutation();

  const money = (value: number) =>
    hideAmounts ? "••••" : formatCurrency(value, user.currency);

  const handleSubmit = async (data: AccountInput) => {
    setError(null);
    try {
      await saveAccount.mutateAsync({ ...data, id: editing?.id });
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save account");
    }
  };

  const openCreate = () => {
    setEditing(null);
    setError(null);
    setShowForm(true);
  };

  // Net worth deliberately sums the signed balance, so a card's debt subtracts. Summing
  // `outstanding` alongside asset balances would add what you owe to what you have.
  const netWorth = accounts
    .filter((a) => a.isActive)
    .reduce((sum, a) => sum + a.balance, 0);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-warm-800">Accounts</h1>
          <p className="text-sm text-warm-500 mt-1">
            Where your money sits, and what you owe.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="hidden sm:flex items-center gap-2 px-4 py-2.5 rounded-xl bg-warm-700 text-cream-50 text-sm font-medium hover:bg-warm-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add account
        </button>
      </div>

      {accounts.length > 0 && (
        <div className="mb-5 p-4 rounded-2xl bg-cream-100">
          <p className="text-xs uppercase tracking-wide text-warm-400">Net worth</p>
          <p
            className={cn(
              "font-serif text-2xl mt-1",
              netWorth < 0 ? "text-expense" : "text-warm-800"
            )}
          >
            {money(netWorth)}
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl animate-shimmer" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No accounts yet"
          description="Add the cards, banks and wallets your money moves through, then tag transactions with them to see each balance."
          action={
            <button
              onClick={openCreate}
              className="px-5 py-2.5 rounded-xl bg-warm-700 text-cream-50 text-sm font-medium hover:bg-warm-800 transition-colors"
            >
              Add account
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {accounts.map((account) => {
              const meta = TYPE_META[account.type];
              const Icon = meta.icon;
              const isCard = account.type === "CREDIT_CARD";

              return (
                <motion.div
                  key={account.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={cn(
                    "p-4 rounded-2xl bg-white shadow-warm border border-cream-200",
                    !account.isActive && "opacity-60"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${account.color}1A`, color: account.color }}
                    >
                      <Icon className="w-5 h-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-warm-800 truncate">{account.name}</p>
                        {!account.isActive && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-cream-200 text-warm-500">
                            Archived
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-warm-400 mt-0.5">
                        {meta.label} · {account.transactionCount} transaction
                        {account.transactionCount === 1 ? "" : "s"}
                      </p>

                      {/* A card shows what is owed, which is the figure people actually carry in
                          their head. Everything else shows what it holds. */}
                      <p
                        className={cn(
                          "font-serif text-xl mt-2",
                          isCard
                            ? (account.outstanding ?? 0) > 0
                              ? "text-expense"
                              : "text-income"
                            : account.balance < 0
                              ? "text-expense"
                              : "text-warm-800"
                        )}
                      >
                        {money(isCard ? account.outstanding ?? 0 : account.balance)}
                        {isCard && (
                          <span className="text-xs font-sans text-warm-400 ml-2">owed</span>
                        )}
                      </p>

                      {isCard && account.availableCredit != null && (
                        <p className="text-xs text-warm-400 mt-1">
                          {money(account.availableCredit)} available of{" "}
                          {money(account.creditLimit ?? 0)}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setEditing(account);
                          setError(null);
                          setShowForm(true);
                        }}
                        aria-label={`Edit ${account.name}`}
                        className="p-2 rounded-lg text-warm-400 hover:text-warm-700 hover:bg-cream-100 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          <button
            onClick={() => setShowArchived((v) => !v)}
            className="w-full py-2.5 text-sm text-warm-500 hover:text-warm-700 transition-colors"
          >
            {showArchived ? "Hide archived accounts" : "Show archived accounts"}
          </button>
        </div>
      )}

      <ActionFab onClick={openCreate} label="Add account" icon={Plus} />

      <Modal
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditing(null);
        }}
        title={editing ? "Edit account" : "Add account"}
      >
        <AccountForm
          account={editing}
          error={error}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      </Modal>

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) await deleteAccount.mutateAsync(removing.id);
          setRemoving(null);
        }}
        title="Remove account?"
        message={
          removing && removing.transactionCount > 0
            ? `${removing.name} has ${removing.transactionCount} transaction(s), so it will be archived rather than deleted — its history stays intact.`
            : `${removing?.name} has no transactions and will be deleted.`
        }
        confirmLabel="Remove"
      />
    </div>
  );
}
