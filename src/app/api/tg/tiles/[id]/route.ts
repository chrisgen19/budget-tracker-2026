import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { telegramQuickTilePatchSchema } from "@/lib/validations";
import { getTelegramUserId } from "@/lib/telegram/require-telegram-user";
import { listTileCategories, viewTiles } from "@/lib/telegram/tile-queries";

/** Editing and deleting one quick-log tile. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TILE_SELECT = {
  id: true,
  label: true,
  description: true,
  amount: true,
  type: true,
  categoryId: true,
  sortOrder: true,
} as const;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getTelegramUserId(request);
  if (userId instanceof NextResponse) return userId;

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = telegramQuickTilePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const patch = parsed.data;

  const [categories, stored] = await Promise.all([
    listTileCategories(prisma, userId),
    prisma.telegramQuickTile.findFirst({ where: { id, userId }, select: TILE_SELECT }),
  ]);

  // 404 rather than 403 on a tile belonging to someone else: a 403 confirms it exists.
  if (!stored) return NextResponse.json({ error: "Tile not found" }, { status: 404 });

  // Checked against the **effective** row -- the patch merged over what is stored -- not against
  // the patch alone. That is what catches a bare `type` flip: `categoryId` is absent from the
  // request, so nothing about it looks wrong, and the tile would be left an income button filed
  // under a food category. Same rule `updateTransactions` and `updateBill` both apply.
  const effective = {
    type: patch.type ?? stored.type,
    categoryId: patch.categoryId !== undefined ? patch.categoryId : stored.categoryId,
  };

  if (effective.categoryId) {
    const usable = categories.some(
      (c) => c.id === effective.categoryId && c.type === effective.type
    );
    if (!usable) {
      return NextResponse.json(
        { error: "That category does not exist, or does not match the button's type." },
        { status: 400 }
      );
    }
  }

  try {
    const updated = await prisma.telegramQuickTile.update({
      where: { id },
      // Only the keys actually sent. `amount` is spread explicitly because `null` is a real value
      // here -- it means "make this button ask" -- and dropping it as falsy would make that
      // edit impossible.
      data: {
        ...(patch.label !== undefined && { label: patch.label }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.amount !== undefined && { amount: patch.amount }),
        ...(patch.type !== undefined && { type: patch.type }),
        ...(patch.categoryId !== undefined && { categoryId: patch.categoryId }),
      },
      select: TILE_SELECT,
    });

    return NextResponse.json({ tile: viewTiles([updated], categories)[0] });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "You already have a button with that label." },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getTelegramUserId(request);
  if (userId instanceof NextResponse) return userId;

  const { id } = await context.params;

  // Scoped by `userId` in the same statement rather than checked first, so there is no window
  // between the ownership read and the delete.
  const result = await prisma.telegramQuickTile.deleteMany({ where: { id, userId } });

  if (result.count === 0) {
    return NextResponse.json({ error: "Tile not found" }, { status: 404 });
  }

  // The gaps a delete leaves in `sortOrder` are harmless: order is read, never computed from, and
  // `nextSortOrder` reads the maximum rather than counting rows.
  return NextResponse.json({ deleted: true });
}
