import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  creditAccountKeys,
  PaymentSaveError,
  useCreateCreditPayment,
  type CreditPaymentView,
} from "@/hooks/use-credit-accounts";
import type { CreditPaymentInput } from "@/lib/validations";

export type RecordPaymentResult =
  | { outcome: "saved"; payment: CreditPaymentView }
  | { outcome: "refused"; message: string }
  | { outcome: "unconfirmed" };

/**
 * Recording a payment to a card, safe against a lost response. The rule `useCardPurchaseBatch`
 * follows, for one row.
 *
 * A refusal wrote nothing, so the fields stay editable and the key stays usable. No response, or a
 * 5xx, may sit in front of a payment that committed, so the exact payment is **pinned** under its key
 * and only a retry of it is offered, which the route replays if it landed. Pinned survives closing
 * the form, so reopening Pay shows the same retry rather than a blank form over a key still armed
 * for the old payment. Letting it be edited instead would have a retry replay the original and report
 * the edits as saved, and a new payment entered later would be answered with the old one.
 *
 * `discard` is the way out when retrying keeps failing. It drops the key too, so the next payment is
 * a new save rather than being matched to the abandoned one.
 */
export function useRecordCardPayment() {
  const queryClient = useQueryClient();
  const create = useCreateCreditPayment();
  const keyRef = useRef<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<{ accountId: string; input: CreditPaymentInput } | null>(null);

  const refreshCards = () => void queryClient.invalidateQueries({ queryKey: creditAccountKeys.all });

  const send = async (accountId: string, input: CreditPaymentInput): Promise<RecordPaymentResult> => {
    keyRef.current ??= crypto.randomUUID();
    try {
      const { payment } = await create.mutateAsync({ accountId, input, clientRequestId: keyRef.current });
      keyRef.current = null;
      setUnconfirmed(null);
      return { outcome: "saved", payment };
    } catch (error) {
      if (error instanceof PaymentSaveError && error.committed === "no") {
        // Nothing was stored under the key, so it stays usable for the corrected payment.
        setUnconfirmed(null);
        return { outcome: "refused", message: error.message };
      }
      setUnconfirmed({ accountId, input });
      // The card's own list is what shows whether it landed, so refresh it before anyone decides.
      refreshCards();
      return { outcome: "unconfirmed" };
    }
  };

  return {
    /** The payment whose save is unconfirmed, pinned until a retry or a discard settles it. */
    unconfirmed: unconfirmed?.input ?? null,
    saving: create.isPending,
    submit: send,
    retry: (): Promise<RecordPaymentResult | null> =>
      unconfirmed ? send(unconfirmed.accountId, unconfirmed.input) : Promise.resolve(null),
    discard: () => {
      keyRef.current = null;
      setUnconfirmed(null);
      refreshCards();
    },
  };
}
