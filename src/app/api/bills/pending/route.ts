import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/session";
import { getPendingRemindersForUser } from "@/lib/pending-bills";

export async function GET() {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const reminders = await getPendingRemindersForUser(userId);
  return NextResponse.json(reminders);
}
