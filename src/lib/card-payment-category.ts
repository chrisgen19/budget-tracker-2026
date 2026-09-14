/**
 * The default category a credit card payment is filed under, and the only one a transaction linked
 * to a card may use (`src/lib/card-payment-rule.ts`). Matched by name because a default has no id
 * that is stable across databases; the partial unique index on default `(name, type)` keeps it to
 * one row.
 *
 * In a module of its own, with no imports, so browser code can read it: `default-categories.ts`
 * imports `@prisma/client` at runtime, which has no place in a client bundle.
 */
export const CARD_PAYMENT_CATEGORY_NAME = "Credit Card Payment";
