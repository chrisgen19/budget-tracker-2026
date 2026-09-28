import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  creditAccountKeys,
  PaymentSaveError,
  useCreateCreditPayment,
  type CreditPaymentView,
} from "@/hooks/use-credit-accounts";
import { accountDateKey } from "@/lib/account-time";
import type { CreditPaymentInput } from "@/lib/validations";

export type RecordPaymentResult =
  | { outcome: "saved"; payment: CreditPaymentView }
  /** An earlier attempt had already saved a payment that differs from this one, which was not saved. */
  | { outcome: "earlier-attempt-saved"; payment: CreditPaymentView }
  | { outcome: "refused"; message: string }
  | { outcome: "unconfirmed" };

/** Whether a replayed payment is the one just submitted, on every field the form can change. */
const isSamePayment = (saved: CreditPaymentView, input: CreditPaymentInput, timezoneOffset: number) =>
  saved.kind === input.kind &&
  saved.amount === input.amount &&
  saved.description === input.description &&
  accountDateKey(saved.date, timezoneOffset) === input.date;

/**
 * Recording a payment to a card, safe against a lost response.
 *
 * The key is minted on the first attempt and kept until the server answers with a saved payment, so
 * a Record pressed again after "Couldn't confirm" goes out under the same key, even after the form
 * was closed and reopened, and the route replays the payment if the first one landed. A refusal
 * keeps the key too: nothing was stored under it, so it is still fresh.
 *
 * Unlike the purchases form the fields stay editable after an unconfirmed save, because a payment is
 * one row and the outcome can be reported exactly. If an edited retry replays an earlier attempt,
 * that is `earlier-attempt-saved`, the edits were not applied, and the key is renewed so recording
 * again is a new payment.
 */
export function useRecordCardPayment(timezoneOffset: number) {
  const queryClient = useQueryClient();
  const create = useCreateCreditPayment();
  const keyRef = useRef<string | null>(null);

  const submit = async (accountId: string, input: CreditPaymentInput): Promise<RecordPaymentResult> => {
    keyRef.current ??= crypto.randomUUID();
    try {
      const { payment, replayed } = await create.mutateAsync({
        accountId,
        input,
        clientRequestId: keyRef.current,
      });
      keyRef.current = null;
      return replayed && !isSamePayment(payment, input, timezoneOffset)
        ? { outcome: "earlier-attempt-saved", payment }
        : { outcome: "saved", payment };
    } catch (error) {
      if (error instanceof PaymentSaveError && error.committed === "no") {
        return { outcome: "refused", message: error.message };
      }
      // The card's own list is what shows whether it landed, so refresh it before anyone decides.
      void queryClient.invalidateQueries({ queryKey: creditAccountKeys.all });
      return { outcome: "unconfirmed" };
    }
  };

  return { submit };
}
