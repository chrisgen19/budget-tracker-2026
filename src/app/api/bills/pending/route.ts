import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/session";
import { getPendingRemindersForUser } from "@/lib/pending-bills";

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const tz = parseInt(searchParams.get("tz") || "0", 10);

  const reminders = await getPendingRemindersForUser(userId, Number.isNaN(tz) ? 0 : tz);
  return NextResponse.json(reminders);
}
