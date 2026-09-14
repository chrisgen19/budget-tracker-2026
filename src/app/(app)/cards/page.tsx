"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, CreditCard, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { ActionFab } from "@/components/ui/action-fab";
import { useToast } from "@/components/ui/toast";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { CreditAccountCard } from "@/components/credit-accounts/credit-account-card";
import { CreditAccountForm } from "@/components/credit-accounts/credit-account-form";
import {
  useCreateCreditAccount,
  useCreditAccountsQuery,
  type CreditAccountView,
} from "@/hooks/use-credit-accounts";
import { maskCurrency } from "@/lib/utils";
import { sumOwedOnCards } from "@/lib/card-owed";
import type { CreditAccountInput } from "@/lib/validations";

const PRIMARY_BUTTON =
  "inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors shadow-soft";

interface CardsContentProps {
  loading: boolean;
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
  accounts: CreditAccountView[];
  onAdd: () => void;
}

function CardsContent({ loading, failed, retrying, onRetry, accounts, onAdd }: CardsContentProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card h-40 animate-shimmer" />
        ))}
      </div>
    );
  }

  // A failed read must not render as "no cards", or it reads as the cards having been deleted.
  if (failed) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-expense/20 bg-expense-light/40 p-4">
        <span className="flex min-w-0 items-center gap-2 text-sm text-warm-600">
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-expense" />
          Couldn&apos;t load your cards. They haven&apos;t been deleted.
        </span>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-amber-dark transition-colors hover:bg-white/60 disabled:opacity-50"
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={CreditCard}
        title="No cards yet"
        description="Add a credit card to track what you owe on it. Purchases count as spending the day you make them, and paying the card only lowers what you owe."
        action={
          <button type="button" onClick={onAdd} className={PRIMARY_BUTTON}>
            <Plus className="h-4 w-4" />
            Add Card
          </button>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {accounts.map((account) => (
        <CreditAccountCard key={account.id} account={account} />
      ))}
    </div>
  );
}

export default function CardsPage() {
  const router = useRouter();
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  // Archived cards are always fetched: one that still owes money belongs in the total even while the
  // list hides it, the same rule the dashboard's Owed on cards follows.
  const { data: accounts = [], isLoading, isError, isFetching, refetch } = useCreditAccountsQuery(true);
  const createAccount = useCreateCreditAccount();

  const shownAccounts = showArchived ? accounts : accounts.filter((account) => account.isActive);
  const totalOwed = sumOwedOnCards(accounts);

  const handleCreate = async (input: CreditAccountInput) => {
    try {
      const created = await createAccount.mutateAsync(input);
      setShowForm(false);
      router.push(`/cards/${created.id}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to add card", "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="Cards"
        description="Purchases count as spending the day you make them. Paying the card lowers what you owe."
        meta={
          !isLoading && !isError && totalOwed !== null
            ? `${maskCurrency(totalOwed, user.currency, hideAmounts)} owed`
            : undefined
        }
        action={
          <button type="button" onClick={() => setShowForm(true)} className={`hidden sm:inline-flex ${PRIMARY_BUTTON}`}>
            <Plus className="h-4 w-4" />
            New Card
          </button>
        }
      />

      <CardsContent
        loading={isLoading}
        failed={isError}
        retrying={isFetching}
        onRetry={() => void refetch()}
        accounts={shownAccounts}
        onAdd={() => setShowForm(true)}
      />

      {!isLoading && !isError && (
        <button
          type="button"
          onClick={() => setShowArchived((current) => !current)}
          className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-warm-400 transition-colors hover:text-warm-600"
        >
          <Archive className="h-4 w-4" />
          {showArchived ? "Hide archived cards" : "Show archived cards"}
        </button>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Card">
        <CreditAccountForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
      </Modal>

      <ActionFab label="Card" icon={Plus} onClick={() => setShowForm(true)} />
    </div>
  );
}
