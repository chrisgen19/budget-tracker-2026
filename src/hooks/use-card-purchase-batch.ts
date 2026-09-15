import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  creditAccountKeys,
  PurchaseSaveError,
  useAddCardPurchases,
  type CardPurchasePayload,
} from "@/hooks/use-credit-accounts";

export type PurchaseBatchResult =
  | { outcome: "saved"; count: number; firstDate: string }
  | { outcome: "refused"; message: string }
  | { outcome: "unconfirmed"; firstDate: string };

/**
 * Saving a statement's purchases to a card, safe against a lost response.
 *
 * The same rule the multi-scan review follows. A refusal wrote nothing, so the lines stay editable
 * and the next save is a fresh intent. No response, or a 5xx, may sit in front of a batch that
 * committed, so the exact rows are pinned under their key and only a retry of them is offered: the
 * route replays them if they landed. Letting the lines be edited instead would have the retry replay
 * the originals and report the edits as saved, and a fresh key would write the purchases twice.
 *
 * `discard` is the way out when retrying keeps failing. It drops the key too, so purchases entered
 * again afterwards are a new save rather than being matched to the abandoned one. Card reads are
 * refreshed on an unconfirmed save and on discard, so the card's own list can show whether the
 * purchases landed before anyone decides.
 */
export function useCardPurchaseBatch() {
  const queryClient = useQueryClient();
  const addPurchases = useAddCardPurchases();
  const keyRef = useRef<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<CardPurchasePayload[] | null>(null);

  const refreshCards = () => void queryClient.invalidateQueries({ queryKey: creditAccountKeys.all });

  const send = async (transactions: CardPurchasePayload[]): Promise<PurchaseBatchResult> => {
    keyRef.current ??= crypto.randomUUID();
    const firstDate = transactions[0]?.date ?? "";
    try {
      await addPurchases.mutateAsync({ transactions, clientBatchId: keyRef.current });
      keyRef.current = null;
      setUnconfirmed(null);
      return { outcome: "saved", count: transactions.length, firstDate };
    } catch (error) {
      if (error instanceof PurchaseSaveError && error.committed === "no") {
        // Nothing was stored under the key, so it stays usable for the corrected lines.
        setUnconfirmed(null);
        return { outcome: "refused", message: error.message };
      }
      setUnconfirmed(transactions);
      refreshCards();
      return { outcome: "unconfirmed", firstDate };
    }
  };

  return {
    /** The rows of a save whose outcome is unknown, pinned until a retry or a discard settles it. */
    unconfirmed,
    saving: addPurchases.isPending,
    submit: send,
    retry: (): Promise<PurchaseBatchResult | null> =>
      unconfirmed ? send(unconfirmed) : Promise.resolve(null),
    discard: () => {
      keyRef.current = null;
      setUnconfirmed(null);
      refreshCards();
    },
  };
}
