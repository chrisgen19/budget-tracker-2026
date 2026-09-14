import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreditAccountInput,
  CreditAccountPatch,
  CreditChargeInput,
  CreditChargePatch,
} from "@/lib/validations";

/* ------------------------------------------------------------------ */
/*  Wire types                                                         */
/* ------------------------------------------------------------------ */

// The server shapes from `credit-account-queries.ts` as they arrive over JSON: every `Date` is an
// ISO string by the time the browser sees it.

export interface LedgerTotalsView {
  charges: number;
  credits: number;
  payments: number;
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

export interface CreditChargeView {
  id: string;
  kind: "CHARGE" | "CREDIT";
  amount: number;
  description: string;
  date: string;
  originalAmount: number | null;
  originalCurrency: string | null;
  categoryId: string;
  category: { id: string; name: string; icon: string; color: string };
}

export interface CardPaymentView {
  id: string;
  amount: number;
  description: string;
  date: string;
  billId: string | null;
}

export interface CardCategorySpendView {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  amount: number;
  percentage: number;
}

export interface CreditAccountDetailView {
  account: CreditAccountView;
  period: { month: string; start: string; end: string; totals: LedgerTotalsView };
  charges: CreditChargeView[];
  payments: CardPaymentView[];
  truncated: boolean;
  categoryBreakdown: CardCategorySpendView[];
}

/* ------------------------------------------------------------------ */
/*  Query key factory                                                  */
/* ------------------------------------------------------------------ */

export const creditAccountKeys = {
  all: ["credit-accounts"] as const,
  list: (includeArchived: boolean) => ["credit-accounts", "list", includeArchived] as const,
  detail: (id: string, month: string) => ["credit-accounts", "detail", id, month] as const,
};

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
 * Every card write invalidates every card read. A charge moves the card's balance on the list page
 * as well as its own month, and the reads are cheap, so narrowing this buys nothing but a way to
 * show a stale balance.
 */
function useCardMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: creditAccountKeys.all }),
  });
}

export function useCreateCreditAccount() {
  return useCardMutation((input: CreditAccountInput) =>
    requestJson<{ id: string }>("/api/credit-accounts", "Failed to create card", {
      method: "POST",
      body: JSON.stringify(input),
    })
  );
}

export function useUpdateCreditAccount() {
  return useCardMutation(({ accountId, patch }: { accountId: string; patch: CreditAccountPatch }) =>
    requestJson<{ id: string }>(cardUrl(accountId), "Failed to update card", {
      method: "PUT",
      body: JSON.stringify(patch),
    })
  );
}

export function useDeleteCreditAccount() {
  return useCardMutation((accountId: string) =>
    requestJson<{ outcome: "deleted" | "archived" }>(cardUrl(accountId), "Failed to delete card", {
      method: "DELETE",
    })
  );
}

export function useCreateCreditCharges() {
  return useCardMutation(
    ({ accountId, charges }: { accountId: string; charges: CreditChargeInput[] }) =>
      requestJson<{ charges: CreditChargeView[] }>(
        `${cardUrl(accountId)}/charges`,
        "Failed to add charges",
        { method: "POST", body: JSON.stringify({ charges }) }
      )
  );
}

export function useUpdateCreditCharge() {
  return useCardMutation(
    ({ accountId, chargeId, patch }: { accountId: string; chargeId: string; patch: CreditChargePatch }) =>
      requestJson<CreditChargeView>(
        `${cardUrl(accountId)}/charges/${encodeURIComponent(chargeId)}`,
        "Failed to update charge",
        { method: "PUT", body: JSON.stringify(patch) }
      )
  );
}

export function useDeleteCreditCharge() {
  return useCardMutation(({ accountId, chargeId }: { accountId: string; chargeId: string }) =>
    requestJson<{ message: string }>(
      `${cardUrl(accountId)}/charges/${encodeURIComponent(chargeId)}`,
      "Failed to delete charge",
      { method: "DELETE" }
    )
  );
}
