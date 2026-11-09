import { useState } from "react";
import type { PayAndEditData } from "@/components/bills/bill-reminder-banner";
import { useToast } from "@/components/ui/toast";
import { useBillAction } from "@/hooks/use-bills";
import { useCreateTransaction } from "@/hooks/use-transactions";
import type { TransactionInput } from "@/lib/validations";

/**
 * State and submit for the bill reminder's Pay & Edit modal.
 *
 * Creates the transaction, then settles the occurrence with it. A failed create throws back to the
 * form and leaves the modal open. A failed settle cannot be undone from here, so it says the
 * transaction was saved and closes.
 */
export function useBillPayAndEdit() {
  const { showToast } = useToast();
  const createTransaction = useCreateTransaction();
  const billAction = useBillAction();
  const [billEditData, setBillEditData] = useState<PayAndEditData | null>(null);

  const closeBillEdit = () => setBillEditData(null);

  const submitBillEdit = async (input: TransactionInput) => {
    const newTx = await createTransaction.mutateAsync(input);

    if (billEditData) {
      try {
        await billAction.mutateAsync({
          id: billEditData.billId,
          input: {
            action: "pay_existing",
            dueDate: billEditData.billDueDate,
            transactionId: newTx.id,
            createdForOccurrence: true,
          },
        });
        showToast(`${billEditData.description || "Bill"} paid`);
      } catch {
        showToast("Transaction saved but bill could not be marked as paid. Please pay the bill manually.");
      }
    }

    closeBillEdit();
  };

  return { billEditData, openBillEdit: setBillEditData, closeBillEdit, submitBillEdit };
}
