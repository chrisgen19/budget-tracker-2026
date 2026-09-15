import { NextResponse } from "next/server";
import { BudgetPlanError, saveBudgetPlan } from "@/lib/budget-plans";
import { getAuthUserId } from "@/lib/session";
import {
  budgetPlanInputSchema,
  calendarMonth,
  timezoneOffsetParam,
} from "@/lib/validations";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ month: string }> },
) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { month } = await params;
  const parsedMonth = calendarMonth.safeParse(month);
  const url = new URL(request.url);
  const parsedTz = timezoneOffsetParam.safeParse(url.searchParams.get("tz"));
  if (!parsedMonth.success || !parsedTz.success) {
    return NextResponse.json({ error: "Invalid month or timezone" }, { status: 400 });
  }

  try {
    const input = budgetPlanInputSchema.parse(await request.json());
    const plan = await saveBudgetPlan(userId, month, parsedTz.data, input);
    return NextResponse.json({ id: plan.id, revision: plan.revision }, { status: 201 });
  } catch (error) {
    if (error instanceof BudgetPlanError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
      return NextResponse.json({ error: "Invalid budget plan" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to save budget plan" }, { status: 500 });
  }
}
