import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/session";
import { getBudgetPerformance } from "@/lib/budget-plans";
import { budgetPlanQuerySchema } from "@/lib/validations";

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const url = new URL(request.url);
  const parsed = budgetPlanQuerySchema.safeParse({
    month: url.searchParams.get("month"),
    tz: url.searchParams.get("tz"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid month or timezone" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getBudgetPerformance(userId, parsed.data.month, parsed.data.tz));
  } catch {
    return NextResponse.json({ error: "Failed to load budget plan" }, { status: 500 });
  }
}
