"use client";

import Link from "next/link";
import { BellRing } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { ordinalDay } from "@/components/credit-accounts/credit-account-card";
import {
  useCreateCardReminder,
  useRemoveCardReminder,
  type CreditAccountView,
} from "@/hooks/use-credit-accounts";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-cream-300 px-4 text-sm font-medium text-warm-500 transition-colors hover:bg-cream-100 disabled:opacity-50";

/**
 * The card's monthly payment reminder: a variable bill under "Credit Card Payment". Paying that bill
 * from the reminder banner or the Bills page records the payment against this card.
 */
export function CardReminder({ account }: { account: CreditAccountView }) {
  const { showToast } = useToast();
  const createReminder = useCreateCardReminder();
  const removeReminder = useRemoveCardReminder();

  if (!account.isActive) return null;

  const attempt = async (write: () => Promise<unknown>, success: string, fallback: string) => {
    try {
      await write();
      showToast(success, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : fallback, "error");
    }
  };

  const description = account.billId
    ? "On. Paying the reminder records the payment against this card."
    : account.dueDay
      ? `Get reminded before the ${ordinalDay(account.dueDay)} each month.`
      : "Set a due day on this card to get a monthly reminder.";

  return (
    <section className="card mb-4 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <BellRing aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
        <div>
          <p className="text-sm font-medium text-warm-600">Payment reminder</p>
          <p className="text-xs text-warm-400">{description}</p>
        </div>
      </div>

      {account.billId ? (
        <div className="flex gap-2">
          <Link href="/bills" className={BUTTON}>
            Open Bills
          </Link>
          <button
            type="button"
            disabled={removeReminder.isPending}
            onClick={() =>
              void attempt(
                () => removeReminder.mutateAsync(account.id),
                "Reminder unlinked. The bill is still on the Bills page.",
                "Failed to unlink the reminder"
              )
            }
            className={BUTTON}
          >
            Unlink
          </button>
        </div>
      ) : account.dueDay ? (
        <button
          type="button"
          disabled={createReminder.isPending}
          onClick={() =>
            void attempt(
              () => createReminder.mutateAsync(account.id),
              "Reminder added to Bills",
              "Failed to create the reminder"
            )
          }
          className={BUTTON}
        >
          Turn on
        </button>
      ) : null}
    </section>
  );
}
