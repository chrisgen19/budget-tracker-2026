import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreditAccountInput,
  CreditAccountPatch,
  CreditPaymentInput,
  CreditPaymentPatch,
} from "@/lib/validations";

/* ------------------------------------------------------------------ */
/*  Wire types                                                         */
/* ------------------------------------------------------------------ */

// The server shapes from `credit-account-queries.ts` as they arrive over JSON: every `Date` is an
// ISO string by the time the browser sees it.

export interface LedgerTotalsView {
  purchases: number;
  payments: number;
  credits: number;
}

export interface CreditAccountView {
  id: string;
  name: string;
  color: string;
  creditLimit: number | null;
  statementDay: number | null;
  dueDay: number | null;
  openingBalance: number;
  openingBalanceDate: string;
  isActive: boolean;
  billId: string | null;
  balance: number;
  availableCredit: number | null;
  totals: LedgerTotalsView;
}

export interface CardPurchaseView {
  id: string;
  amount: number;
  description: string;
  date: string;
  categoryId: string;
  category: { id: string; name: string; icon: string; color: string };
  labels: { labelId: string; label: { name: string; color: string } }[];
}

export interface CreditPaymentView {
  id: string;
  kind: "PAYMENT" | "CREDIT";
  amount: number;
  description: string;
  date: string;
}

export interface CardCategorySpendView {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  amount: number;
  percentage: number;
}

export interface CardLabelSpendView {
  id: string;
  name: string;
  color: string;
  amount: number;
  percentage: number;
  transactionCount: number;
}

export interface CreditAccountDetailView {
  account: CreditAccountView;
  period: { month: string; start: string; end: string; totals: LedgerTotalsView };
  purchases: CardPurchaseView[];
  payments: CreditPaymentView[];
  truncated: boolean;
  categoryBreakdown: CardCategorySpendView[];
  labelBreakdown: CardLabelSpendView[];
}

/** What the card page sends for each purchase line: an ordinary transaction paid with the card. */
export interface CardPurchasePayload {
  amount: number;
  description: string;
  type: "EXPENSE";
  date: string;
  categoryId: string;
  labelIds: string[];
  creditAccountId: string;
}

/* ------------------------------------------------------------------ */
/*  Query keys                                                         */
/* ------------------------------------------------------------------ */

export const creditAccountKeys = {
  all: ["credit-accounts"] as const,
  list: (includeArchived: boolean) => ["credit-accounts", "list", includeArchived] as const,
  detail: (id: string, month: string) => ["credit-accounts", "detail", id, month] as const,
};

/**
 * Keyed literally rather than imported: `use-transactions.ts` imports this module for
 * `creditAccountKeys`, so importing its key factories back would close a cycle. These are the
 * roots those factories use.
 */
const SPENDING_KEYS = [["transactions"], ["dashboard"], ["analytics"], ["labels"]] as const;
/** The dashboard shows what cards owe, so a payment changes it too. */
const DASHBOARD_KEY = [["dashboard"]] as const;

/* ------------------------------------------------------------------ */
/*  Fetch helper                                                       */
/* ------------------------------------------------------------------ */

/** JSON in, JSON out, and the server's own `error` message on failure so a toast can show it. */
const requestJson = async <T>(url: string, fallback: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, {
    ...init,
    ...(init?.body !== undefined && { headers: { "Content-Type": "application/json" } }),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: unknown } | null)?.error;
    throw new Error(typeof message === "string" ? message : fallback);
  }
  return body as T;
};

const cardUrl = (accountId: string) => `/api/credit-accounts/${encodeURIComponent(accountId)}`;
const paymentUrl = (accountId: string, paymentId: string) =>
  `${cardUrl(accountId)}/payments/${encodeURIComponent(paymentId)}`;

/* ------------------------------------------------------------------ */
/*  Queries                                                            */
/* ------------------------------------------------------------------ */

export function useCreditAccountsQuery(includeArchived = false) {
  return useQuery({
    queryKey: creditAccountKeys.list(includeArchived),
    queryFn: () =>
      requestJson<CreditAccountView[]>(
        `/api/credit-accounts${includeArchived ? "?includeArchived=true" : ""}`,
        "Failed to load credit cards"
      ),
  });
}

export function useCreditAccountDetailQuery(accountId: string, month: string) {
  return useQuery({
    queryKey: creditAccountKeys.detail(accountId, month),
    queryFn: () =>
      requestJson<CreditAccountDetailView>(
        `${cardUrl(accountId)}?month=${month}`,
        "Failed to load this card"
      ),
  });
}

/* ------------------------------------------------------------------ */
/*  Mutations                                                          */
/* ------------------------------------------------------------------ */

/**
 * Every card write invalidates every card read, plus whatever else it changes. A purchase moves a
 * card's balance on the list page as well as its own month, and the reads are cheap, so narrowing
 * this buys nothing but a way to show a stale balance.
 */
function useCardMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  alsoInvalidate: readonly (readonly unknown[])[] = []
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all(
        [creditAccountKeys.all, ...alsoInvalidate].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey })
        )
      ),
  });
}

export function useCreateCreditAccount() {
  return useCardMutation((input: CreditAccountInput) =>
    requestJson<{ id: string }>("/api/credit-accounts", "Failed to create card", {
      method: "POST",
      body: JSON.stringify(input),
    })
  , DASHBOARD_KEY);
}

export function useUpdateCreditAccount() {
  return useCardMutation(({ accountId, patch }: { accountId: string; patch: CreditAccountPatch }) =>
    requestJson<{ id: string }>(cardUrl(accountId), "Failed to update card", {
      method: "PUT",
      body: JSON.stringify(patch),
    })
  , DASHBOARD_KEY);
}

export function useDeleteCreditAccount() {
  return useCardMutation((accountId: string) =>
    requestJson<{ outcome: "deleted" | "archived" }>(cardUrl(accountId), "Failed to delete card", {
      method: "DELETE",
    })
  , DASHBOARD_KEY);
}

/**
 * Add purchases to a card: one batch of ordinary transactions paid with it. The key makes a retry
 * of a lost response replay the same rows instead of writing them twice.
 */
export function useAddCardPurchases() {
  return useCardMutation(
    ({ transactions, clientBatchId }: { transactions: CardPurchasePayload[]; clientBatchId: string }) =>
      requestJson<{ transactions: { id: string }[] }>("/api/transactions/batch", "Failed to add purchases", {
        method: "POST",
        body: JSON.stringify({ transactions, clientBatchId }),
      }),
    SPENDING_KEYS
  );
}

export function useCreateCreditPayment() {
  return useCardMutation(
    ({ accountId, input }: { accountId: string; input: CreditPaymentInput }) =>
      requestJson<CreditPaymentView>(`${cardUrl(accountId)}/payments`, "Failed to record the payment", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    DASHBOARD_KEY
  );
}

export function useUpdateCreditPayment() {
  return useCardMutation(
    ({ accountId, paymentId, patch }: { accountId: string; paymentId: string; patch: CreditPaymentPatch }) =>
      requestJson<CreditPaymentView>(paymentUrl(accountId, paymentId), "Failed to update the payment", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    DASHBOARD_KEY
  );
}

export function useDeleteCreditPayment() {
  return useCardMutation(
    ({ accountId, paymentId }: { accountId: string; paymentId: string }) =>
      requestJson<{ message: string }>(paymentUrl(accountId, paymentId), "Failed to delete the payment", {
        method: "DELETE",
      }),
    DASHBOARD_KEY
  );
}
