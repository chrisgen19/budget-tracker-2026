import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { labelSchema } from "@/lib/validations";
import { createLabel } from "@/lib/label-writes";

export async function GET() {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const labels = await prisma.label.findMany({
    where: { userId },
    include: {
      _count: { select: { transactions: true } },
      schedules: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { name: "asc" },
  });

  // `categories: []` is here for the cutover only, and is removed with the rest of the feature in
  // the #303 follow-up.
  //
  // A tab still running the pre-revert bundle keeps that JS in memory across a deploy -- the
  // service worker precaches bundles, and `skipWaiting` swapping the worker does not swap the
  // script an open page is already running. `/api/*` is NetworkOnly, so React Query's
  // refetch-on-focus sends the NEW json into the OLD code, which reads `lbl.categories.length`
  // on the labels page and `label.categories.map(...)` in `useScheduledLabel`. Both throw on
  // undefined, and the sequence is ordinary: leave the app in a background tab, deploy, come back.
  //
  // The empty array is not merely crash-avoidance. Zero links meant "every category" in that
  // bundle, so a stale client reads every label as unrestricted -- which is exactly what this
  // revert makes true. Returning the real rows would instead leave it hiding labels the server no
  // longer restricts.
  return NextResponse.json(labels.map((label) => ({ ...label, categories: [] })));
}

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await request.json();
    const validated = labelSchema.parse(body);

    // Shared with the MCP `create_label` tool, so the case-insensitive duplicate rule cannot
    // diverge between the two.
    const result = await createLabel({
      prisma,
      userId,
      name: validated.name,
      color: validated.color,
      applicableTo: validated.applicableTo,
      schedules: validated.schedules,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: "A label with this name already exists" },
        { status: 400 }
      );
    }

    return NextResponse.json(result.label, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create label" }, { status: 500 });
  }
}
