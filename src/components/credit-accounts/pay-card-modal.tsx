"use client";

import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { useCreateTransaction } from "@/hooks/use-transactions";
import type { CreditAccountView } from "@/hooks/use-credit-accounts";
import type { TransactionInput } from "@/lib/validations";

interface PayCardModalProps {
  /** The card being paid, or null when the modal is closed. */
  account: CreditAccountView | null;
  paymentCategoryId: string | undefined;
  onClose: () => void;
}

/**
 * Record a payment against a card: the ordinary transaction form, filled in as a payment of this
 * card for what it owes. The amount is only a starting point, since paying part of a statement is
 * normal, and the payment then counts as an expense like any other.
 */
export function PayCardModal({ account, paymentCategoryId, onClose }: PayCardModalProps) {
  const createTransaction = useCreateTransaction();
  const { showToast } = useToast();

  const handleSubmit = async (input: TransactionInput) => {
    try {
      await createTransaction.mutateAsync(input);
      showToast("Payment recorded", "success");
      onClose();
    } catch {
      showToast("Failed to record the payment", "error");
    }
  };

  return (
    <Modal open={account !== null} onClose={onClose} title="Pay Card">
      {account && (
        <TransactionForm
          initialData={{
            type: "EXPENSE",
            amount: account.balance > 0 ? account.balance : undefined,
            description: `${account.name} payment`,
            categoryId: paymentCategoryId,
            creditAccountId: account.id,
          }}
          onSubmit={handleSubmit}
          onCancel={onClose}
        />
      )}
    </Modal>
  );
}
