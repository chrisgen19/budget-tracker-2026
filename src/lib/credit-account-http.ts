import { NextResponse } from "next/server";
import { z } from "zod";
import { CREDIT_WRITE_FAILURES, type CreditWriteFailureReason } from "@/lib/credit-account-writes";

/** Path ids for the credit card routes. Bounded so a junk segment never reaches a query. */
export const creditRouteIdSchema = z.string().trim().min(1).max(100);

export const creditFailureResponse = (reason: CreditWriteFailureReason): NextResponse => {
  const { status, message } = CREDIT_WRITE_FAILURES[reason];
  return NextResponse.json({ error: message, code: reason }, { status });
};

/**
 * A 400 for a body that is not JSON or fails its schema, or null for any other error.
 *
 * Names the first problem rather than a bare "Invalid input", so a form can show the user which
 * field to fix without re-deriving the schema's rules on the client.
 */
export const invalidInputResponse = (error: unknown): NextResponse | null => {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  return null;
};
