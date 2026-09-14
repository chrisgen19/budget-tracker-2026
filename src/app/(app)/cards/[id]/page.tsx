"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArchiveRestore, ArrowLeft, Banknote, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/components/user-provider";
import { MonthSwitcher } from "@/components/credit-accounts/month-switcher";
import { CardSummary } from "@/components/credit-accounts/card-summary";
import { CardCategoryBreakdown } from "@/components/credit-accounts/card-category-breakdown";
import { CardLedgerList } from "@/components/credit-accounts/card-ledger-list";
import { CreditAccountForm } from "@/components/credit-accounts/credit-account-form";
import { chargeToInput, CreditChargeForm } from "@/components/credit-accounts/credit-charge-form";
import {
  useCreateCreditCharges,
  useCreditAccountDetailQuery,
  useDeleteCreditAccount,
  useDeleteCreditCharge,
  useUpdateCreditAccount,
  useUpdateCreditCharge,
  type CreditChargeView,
} from "@/hooks/use-credit-accounts";
import { CardReminder } from "@/components/credit-accounts/card-reminder";
import { PayCardModal } from "@/components/credit-accounts/pay-card-modal";
import { useCategoriesQuery } from "@/hooks/use-categories";
import { accountMonthKey } from "@/lib/account-time";
import { CARD_PAYMENT_CATEGORY_NAME } from "@/lib/card-payment-category";
import type { CreditAccountInput, CreditChargeInput } from "@/lib/validations";

const PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber px-4 text-sm font-medium text-white shadow-soft transition-colors hover:bg-amber-dark";
const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center gap-2 rounded-xl border border-cream-300 px-4 text-sm font-medium text-warm-500 transition-colors hover:bg-cream-100";

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/**
 * One card, one month. Longer than the component guideline because it owns every modal on the page;
 * each piece of content is its own component, and splitting the modal state out would only move it.
 */
export default function CardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useUser();
  const { showToast } = useToast();
  const [month, setMonth] = useState(() => accountMonthKey(new Date(), user.timezoneOffset));
  const [addingCharges, setAddingCharges] = useState(false);
  const [editingCharge, setEditingCharge] = useState<CreditChargeView | null>(null);
  const [deletingCharge, setDeletingCharge] = useState<CreditChargeView | null>(null);
  const [editingCard, setEditingCard] = useState(false);
  const [deletingCard, setDeletingCard] = useState(false);
  const [paying, setPaying] = useState(false);

  const detail = useCreditAccountDetailQuery(id, month);
  const createCharges = useCreateCreditCharges();
  const updateCharge = useUpdateCreditCharge();
  const deleteCharge = useDeleteCreditCharge();
  const updateCard = useUpdateCreditAccount();
  const deleteCard = useDeleteCreditAccount();
  const { data: expenseCategories = [] } = useCategoriesQuery("EXPENSE");
  // Missing only when the seed has not been run since cards shipped.
  const paymentCategoryId = expenseCategories.find((c) => c.name === CARD_PAYMENT_CATEGORY_NAME)?.id;

  /** Runs a write, toasting either way. Resolves true on success so the caller can close its modal. */
  const attempt = async (write: () => Promise<unknown>, success: string, fallback: string) => {
    try {
      await write();
      showToast(success, "success");
      return true;
    } catch (error) {
      showToast(errorMessage(error, fallback), "error");
      return false;
    }
  };

  const handleAddCharges = async (charges: CreditChargeInput[]) => {
    const count = `${charges.length} ${charges.length === 1 ? "line" : "lines"}`;
    if (await attempt(() => createCharges.mutateAsync({ accountId: id, charges }), `Added ${count}`, "Failed to add charges")) {
      setAddingCharges(false);
      // Show the month the lines landed in, or a statement entered on the 2nd vanishes from view.
      setMonth(charges[0].date.slice(0, 7));
    }
  };

  const handleSaveCharge = async ([patch]: CreditChargeInput[]) => {
    if (!editingCharge) return;
    const write = () => updateCharge.mutateAsync({ accountId: id, chargeId: editingCharge.id, patch });
    if (await attempt(write, "Charge updated", "Failed to update charge")) setEditingCharge(null);
  };

  const handleDeleteCharge = async () => {
    if (!deletingCharge) return;
    const write = () => deleteCharge.mutateAsync({ accountId: id, chargeId: deletingCharge.id });
    if (await attempt(write, "Charge deleted", "Failed to delete charge")) setDeletingCharge(null);
  };

  const handleSaveCard = async (input: CreditAccountInput) => {
    if (await attempt(() => updateCard.mutateAsync({ accountId: id, patch: input }), "Card updated", "Failed to update card")) {
      setEditingCard(false);
    }
  };

  const handleRestore = () =>
    attempt(() => updateCard.mutateAsync({ accountId: id, patch: { isActive: true } }), "Card restored", "Failed to restore card");

  const handleDeleteCard = async () => {
    try {
      const { outcome } = await deleteCard.mutateAsync(id);
      setDeletingCard(false);
      if (outcome === "deleted") {
        showToast("Card deleted", "success");
        router.push("/cards");
      } else {
        showToast("Card archived. Its charges and payments are kept.", "success");
      }
    } catch (error) {
      showToast(errorMessage(error, "Failed to delete card"), "error");
    }
  };

  if (detail.isLoading) return <DetailSkeleton />;
  if (detail.isError || !detail.data) {
    return (
      <DetailError
        message={errorMessage(detail.error, "Couldn't load this card")}
        retrying={detail.isFetching}
        onRetry={() => void detail.refetch()}
      />
    );
  }

  const { account, period, charges, payments, categoryBreakdown, truncated } = detail.data;

  return (
    <div>
      <BackToCards />
      <PageHeader
        title={account.name}
        badge={
          account.isActive ? undefined : (
            <span className="shrink-0 rounded-full bg-cream-100 px-2 py-0.5 text-xs font-medium text-warm-500">Archived</span>
          )
        }
        actionPlacement="below"
        action={<MonthSwitcher month={month} onChange={setMonth} />}
      />

      <CardSummary account={account} monthTotals={period.totals} />
      <CardReminder account={account} />

      <div className="mb-6 flex flex-wrap gap-2">
        {account.isActive ? (
          <>
            <button
              type="button"
              onClick={() => setPaying(true)}
              disabled={!paymentCategoryId}
              title={paymentCategoryId ? undefined : "The Credit Card Payment category is missing. Run the database seed."}
              className={`${PRIMARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Banknote className="h-4 w-4" />
              Pay
            </button>
            <button type="button" onClick={() => setAddingCharges(true)} className={SECONDARY_BUTTON}>
              <Plus className="h-4 w-4" />
              Add Charges
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void handleRestore()} className={PRIMARY_BUTTON}>
            <ArchiveRestore className="h-4 w-4" />
            Restore Card
          </button>
        )}
        <button type="button" onClick={() => setEditingCard(true)} className={SECONDARY_BUTTON}>
          <Pencil className="h-4 w-4" />
          Edit
        </button>
        <button type="button" onClick={() => setDeletingCard(true)} className={`${SECONDARY_BUTTON} hover:text-expense`}>
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-4 font-serif text-lg text-warm-700">Where it went</h2>
          <CardCategoryBreakdown rows={categoryBreakdown} />
        </section>
        <section className="card p-5 lg:col-span-3">
          <h2 className="mb-2 font-serif text-lg text-warm-700">Charges and payments</h2>
          {truncated && (
            <p className="mb-2 text-xs text-warm-400">Showing the latest 500 of each. The totals above include everything.</p>
          )}
          <CardLedgerList
            charges={charges}
            payments={payments}
            onEditCharge={setEditingCharge}
            onDeleteCharge={setDeletingCharge}
          />
        </section>
      </div>

      <PayCardModal
        account={paying ? account : null}
        paymentCategoryId={paymentCategoryId}
        onClose={() => setPaying(false)}
      />

      <Modal open={addingCharges} onClose={() => setAddingCharges(false)} title="Add Charges">
        <CreditChargeForm onSubmit={handleAddCharges} onCancel={() => setAddingCharges(false)} />
      </Modal>

      <Modal open={!!editingCharge} onClose={() => setEditingCharge(null)} title="Edit Charge">
        {editingCharge && (
          <CreditChargeForm
            initial={chargeToInput(editingCharge, user.timezoneOffset)}
            onSubmit={handleSaveCharge}
            onCancel={() => setEditingCharge(null)}
          />
        )}
      </Modal>

      <Modal open={editingCard} onClose={() => setEditingCard(false)} title="Edit Card">
        <CreditAccountForm account={account} onSubmit={handleSaveCard} onCancel={() => setEditingCard(false)} />
      </Modal>

      <ConfirmModal
        open={!!deletingCharge}
        onClose={() => setDeletingCharge(null)}
        onConfirm={() => void handleDeleteCharge()}
        title="Delete Charge"
        message={<p>Delete &ldquo;{deletingCharge?.description || deletingCharge?.category.name}&rdquo;? What you owe on this card will go down by its amount.</p>}
        loading={deleteCharge.isPending}
      />

      <ConfirmModal
        open={deletingCard}
        onClose={() => setDeletingCard(false)}
        onConfirm={() => void handleDeleteCard()}
        title="Delete Card"
        message={<p>Delete &ldquo;{account.name}&rdquo;? A card with any charges or payments is archived instead, so its history is kept.</p>}
        loading={deleteCard.isPending}
      />
    </div>
  );
}

function BackToCards() {
  return (
    <Link href="/cards" className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-warm-400 transition-colors hover:text-warm-600">
      <ArrowLeft className="h-4 w-4" />
      All cards
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-4 h-10 w-48 rounded-lg animate-shimmer" />
      <div className="card mb-4 h-36 animate-shimmer" />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card h-64 animate-shimmer lg:col-span-2" />
        <div className="card h-64 animate-shimmer lg:col-span-3" />
      </div>
    </div>
  );
}

function DetailError({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div>
      <BackToCards />
      <div className="flex items-center justify-between gap-3 rounded-xl border border-expense/20 bg-expense-light/40 p-4">
        <span className="flex min-w-0 items-center gap-2 text-sm text-warm-600">
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-expense" />
          {message}
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
    </div>
  );
}
