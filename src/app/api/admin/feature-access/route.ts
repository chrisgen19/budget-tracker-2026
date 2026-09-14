import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { readCreditCardsAccess } from "@/lib/credit-card-access";

const featureAccessSchema = z.object({
  creditCardsAccess: z.enum(["ADMIN", "EVERYONE"]),
});

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  try {
    return NextResponse.json({ creditCardsAccess: await readCreditCardsAccess(prisma) });
  } catch {
    return NextResponse.json({ error: "Failed to load feature access" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  try {
    const parsed = featureAccessSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    // Upserted: the row is created on the first switch, since a missing one reads as the defaults.
    const saved = await prisma.siteSettings.upsert({
      where: { id: 1 },
      update: parsed.data,
      create: { id: 1, ...parsed.data },
      select: { creditCardsAccess: true },
    });
    return NextResponse.json(saved);
  } catch {
    return NextResponse.json({ error: "Failed to save feature access" }, { status: 500 });
  }
}
