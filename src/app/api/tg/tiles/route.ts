import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { telegramQuickTileSchema } from "@/lib/validations";
import { getTelegramUserId } from "@/lib/telegram/require-telegram-user";
import { MAX_QUICK_TILES, nextSortOrder } from "@/lib/telegram/quick-tiles";
import { listTileCategories, listTileRows, viewTiles } from "@/lib/telegram/tile-queries";

/** Listing and creating quick-log tiles, from the Mini App's editor. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await getTelegramUserId(request);
  if (userId instanceof NextResponse) return userId;

  const [categories, rows] = await Promise.all([
    listTileCategories(prisma, userId),
    listTileRows(prisma, userId),
  ]);

  return NextResponse.json({ tiles: viewTiles(rows, categories) });
}

export async function POST(request: Request) {
  const userId = await getTelegramUserId(request);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = telegramQuickTileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const [categories, existing] = await Promise.all([
    listTileCategories(prisma, userId),
    listTileRows(prisma, userId),
  ]);

  if (existing.length >= MAX_QUICK_TILES) {
    return NextResponse.json(
      { error: `You can have at most ${MAX_QUICK_TILES} buttons. Delete one first.` },
      { status: 409 }
    );
  }

  // A category the user does not own, or one whose type disagrees with the tile's, would be
  // rejected later by `categoriesAreUsable` inside the write -- but only when a tap is logged,
  // which is a confusing place to find out. Refusing at the edit is where the user can act on it.
  if (input.categoryId) {
    const usable = categories.some((c) => c.id === input.categoryId && c.type === input.type);
    if (!usable) {
      return NextResponse.json(
        { error: "That category does not exist, or does not match the button's type." },
        { status: 400 }
      );
    }
  }

  try {
    const created = await prisma.telegramQuickTile.create({
      data: {
        userId,
        label: input.label,
        description: input.description,
        amount: input.amount,
        type: input.type,
        categoryId: input.categoryId,
        sortOrder: nextSortOrder(existing),
      },
      select: {
        id: true,
        label: true,
        description: true,
        amount: true,
        type: true,
        categoryId: true,
        sortOrder: true,
      },
    });

    // Returned through the same view as the list, so the editor is told immediately where this
    // button will actually file -- including when that is not what was asked for.
    return NextResponse.json({ tile: viewTiles([created], categories)[0] }, { status: 201 });
  } catch (error) {
    // `@@unique([userId, label])`. Two buttons reading the same thing are indistinguishable in a
    // grid, so this is a named refusal rather than a silent second tile.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "You already have a button with that label." },
        { status: 409 }
      );
    }
    throw error;
  }
}
