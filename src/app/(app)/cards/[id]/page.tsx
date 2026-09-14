"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArchiveRestore, ArrowLeft, Banknote, ListFilter, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/components/user-provider";
import { MonthSwitcher } from "@/components/credit-accounts/month-switcher";
import { CardSummary } from "@/components/credit-accounts/card-summary";
import { CardBreakdownTabs } from "@/components/credit-accounts/card-breakdown-tabs";
import { CardLedgerList } from "@/components/credit-accounts/card-ledger-list";
import { CreditAccountForm } from "@/components/credit-accounts/credit-account-form";
import { CardPurchasesForm } from "@/components/credit-accounts/card-purchases-form";
import { CardPaymentForm } from "@/components/credit-accounts/card-payment-form";
import {
  useAddCardPurchases,
  useCreateCreditPayment,
  useCreditAccountDetailQuery,
  useDeleteCreditAccount,
  useDeleteCreditPayment,
  useUpdateCreditAccount,
  useUpdateCreditPayment,
  type CreditPaymentView,
} from "@/hooks/use-credit-accounts";
import { accountDateKey, accountMonthKey } from "@/lib/account-time";
import {
  resolveTransactionDate,
  type CardPurchaseLine,
  type CreditAccountInput,
  type CreditPaymentInput,
} from "@/lib/validations";

const PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber px-4 text-sm font-medium text-white shadow-soft transition-colors hover:bg-amber-dark";
const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center gap-2 rounded-xl border border-cream-300 px-4 text-sm font-medium text-warm-500 transition-colors hover:bg-cream-100";

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** The month as a day range, for the Transactions link. */
export const monthDayRange = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
};

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
  const [addingPurchases, setAddingPurchases] = useState(false);
  const [paying, setPaying] = useState(false);
  const [editingPayment, setEditingPayment] = useState<CreditPaymentView | null>(null);
  const [deletingPayment, setDeletingPayment] = useState<CreditPaymentView | null>(null);
  const [editingCard, setEditingCard] = useState(false);
  const [deletingCard, setDeletingCard] = useState(false);
  // One key per opening of the purchases form, so retrying a lost response replays rather than duplicates.
  const purchaseBatchId = useRef<string>("");

  const detail = useCreditAccountDetailQuery(id, month);
  const addPurchases = useAddCardPurchases();
  const createPayment = useCreateCreditPayment();
  const updatePayment = useUpdateCreditPayment();
  const deletePayment = useDeleteCreditPayment();
  const updateCard = useUpdateCreditAccount();
  const deleteCard = useDeleteCreditAccount();

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

  const openPurchases = () => {
    purchaseBatchId.current = crypto.randomUUID();
    setAddingPurchases(true);
  };

  const handleAddPurchases = async (lines: CardPurchaseLine[]) => {
    // Noon on the statement day: a real time, so the row sorts sensibly within its day, and far
    // from midnight, so no timezone reading can move it to a neighbouring one.
    const transactions = lines.map((line) => ({
      amount: line.amount,
      description: line.description,
      type: "EXPENSE" as const,
      date: resolveTransactionDate(`${line.date}T12:00`, user.timezoneOffset),
      categoryId: line.categoryId,
      // Explicit, even when empty, so label schedules never guess on a backdated purchase.
      labelIds: line.labelIds,
      creditAccountId: id,
    }));
    const write = () => addPurchases.mutateAsync({ transactions, clientBatchId: purchaseBatchId.current });
    const count = `${lines.length} ${lines.length === 1 ? "purchase" : "purchases"}`;
    if (await attempt(write, `Added ${count}`, "Failed to add purchases")) {
      setAddingPurchases(false);
      // Show the month the purchases landed in, or a statement entered on the 2nd vanishes from view.
      setMonth(lines[0].date.slice(0, 7));
    }
  };

  const handleRecordPayment = async (input: CreditPaymentInput) => {
    const label = input.kind === "CREDIT" ? "Refund recorded" : "Payment recorded";
    if (await attempt(() => createPayment.mutateAsync({ accountId: id, input }), label, "Failed to record the payment")) {
      setPaying(false);
      setMonth(input.date.slice(0, 7));
    }
  };

  const handleSavePayment = async (patch: CreditPaymentInput) => {
    if (!editingPayment) return;
    const write = () => updatePayment.mutateAsync({ accountId: id, paymentId: editingPayment.id, patch });
    if (await attempt(write, "Payment updated", "Failed to update the payment")) setEditingPayment(null);
  };

  const handleDeletePayment = async () => {
    if (!deletingPayment) return;
    const write = () => deletePayment.mutateAsync({ accountId: id, paymentId: deletingPayment.id });
    if (await attempt(write, "Payment deleted", "Failed to delete the payment")) setDeletingPayment(null);
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
        showToast("Card archived. Its purchases and payments are kept.", "success");
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

  const { account, period, purchases, payments, categoryBreakdown, labelBreakdown, truncated } = detail.data;
  const { from, to } = monthDayRange(month);
  const transactionsHref = `/transactions?creditAccountId=${account.id}&period=custom&from=${from}&to=${to}`;

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

      <div className="mb-6 flex flex-wrap gap-2">
        {account.isActive ? (
          <>
            <button type="button" onClick={openPurchases} className={PRIMARY_BUTTON}>
              <Plus className="h-4 w-4" />
              Add Purchases
            </button>
            <button type="button" onClick={() => setPaying(true)} className={SECONDARY_BUTTON}>
              <Banknote className="h-4 w-4" />
              Pay
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
          <CardBreakdownTabs categories={categoryBreakdown} labels={labelBreakdown} />
        </section>
        <section className="card p-5 lg:col-span-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-serif text-lg text-warm-700">Purchases and payments</h2>
            <Link href={transactionsHref} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-amber-dark">
              <ListFilter className="h-4 w-4" />
              View in Transactions
            </Link>
          </div>
          {truncated && (
            <p className="mb-2 text-xs text-warm-400">Showing the latest 500 of each. The totals above include everything.</p>
          )}
          <CardLedgerList
            purchases={purchases}
            payments={payments}
            onEditPayment={setEditingPayment}
            onDeletePayment={setDeletingPayment}
          />
        </section>
      </div>

      <Modal open={addingPurchases} onClose={() => setAddingPurchases(false)} title="Add Purchases">
        <CardPurchasesForm onSubmit={handleAddPurchases} onCancel={() => setAddingPurchases(false)} />
      </Modal>

      <Modal open={paying} onClose={() => setPaying(false)} title="Pay Card">
        <CardPaymentForm defaultAmount={account.balance} onSubmit={handleRecordPayment} onCancel={() => setPaying(false)} />
      </Modal>

      <Modal open={!!editingPayment} onClose={() => setEditingPayment(null)} title="Edit Payment">
        {editingPayment && (
          <CardPaymentForm
            initial={{
              kind: editingPayment.kind,
              amount: editingPayment.amount,
              description: editingPayment.description,
              date: accountDateKey(editingPayment.date, user.timezoneOffset),
            }}
            onSubmit={handleSavePayment}
            onCancel={() => setEditingPayment(null)}
          />
        )}
      </Modal>

      <Modal open={editingCard} onClose={() => setEditingCard(false)} title="Edit Card">
        <CreditAccountForm account={account} onSubmit={handleSaveCard} onCancel={() => setEditingCard(false)} />
      </Modal>

      <ConfirmModal
        open={!!deletingPayment}
        onClose={() => setDeletingPayment(null)}
        onConfirm={() => void handleDeletePayment()}
        title="Delete Payment"
        message={<p>Delete this {deletingPayment?.kind === "CREDIT" ? "refund" : "payment"}? What you owe on this card will go back up by its amount.</p>}
        loading={deletePayment.isPending}
      />

      <ConfirmModal
        open={deletingCard}
        onClose={() => setDeletingCard(false)}
        onConfirm={() => void handleDeleteCard()}
        title="Delete Card"
        message={<p>Delete &ldquo;{account.name}&rdquo;? A card with any purchases or payments is archived instead, so its history is kept.</p>}
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
