import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { updateAppSettingsSchema } from "@/lib/validations";

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  // Ensure default rows exist (self-healing for fresh deploys where seed hasn't run)
  const DEFAULTS = {
    FREE: { receiptScanEnabled: false, maxUploadFiles: 5, monthlyScanLimit: 5 },
    PAID: { receiptScanEnabled: true, maxUploadFiles: 10, monthlyScanLimit: 0 },
  } as const;

  await Promise.all(
    (["FREE", "PAID"] as const).map((role) =>
      prisma.appSettings.upsert({
        where: { role },
        update: {},
        create: { role, ...DEFAULTS[role] },
      })
    )
  );

  const settings = await prisma.appSettings.findMany({
    where: { role: { in: ["FREE", "PAID"] } },
  });

  // Build a keyed object { FREE: {...}, PAID: {...} }
  const result: Record<string, { receiptScanEnabled: boolean; maxUploadFiles: number; monthlyScanLimit: number }> = {};
  for (const s of settings) {
    result[s.role] = {
      receiptScanEnabled: s.receiptScanEnabled,
      maxUploadFiles: s.maxUploadFiles,
      monthlyScanLimit: s.monthlyScanLimit,
    };
  }

  return NextResponse.json(result);
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await request.json();
    const parsed = updateAppSettingsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { role, ...data } = parsed.data;

    const updated = await prisma.appSettings.upsert({
      where: { role },
      update: data,
      create: { role, ...data },
    });

    return NextResponse.json({
      receiptScanEnabled: updated.receiptScanEnabled,
      maxUploadFiles: updated.maxUploadFiles,
      monthlyScanLimit: updated.monthlyScanLimit,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
