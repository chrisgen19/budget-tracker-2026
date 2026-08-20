import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/session";
import { getPendingRemindersForUser } from "@/lib/pending-bills";
import { timezoneOffsetParam } from "@/lib/validations";

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const parsedTz = timezoneOffsetParam.safeParse(searchParams.get("tz") ?? 0);
  if (!parsedTz.success) {
    return NextResponse.json({ error: "Invalid tz" }, { status: 400 });
  }

  const reminders = await getPendingRemindersForUser(userId, parsedTz.data);
  return NextResponse.json(reminders);
}
