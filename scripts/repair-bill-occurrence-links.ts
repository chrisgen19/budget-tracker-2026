/**
 * Repair bill occurrences whose recorded status disagrees with the payments.
 *
 * Two shapes, both produced by the one-way skip in #216:
 *
 *   1. An occurrence marked SKIPPED that has a matching payment within a few
 *      days. Skip is what people press when the bill is already paid and they
 *      want the reminder gone, so the record claims a non-payment that did
 *      happen. Repaired by replacing the skip with PAID and linking the payment.
 *
 *   2. An occurrence settled by a payment that plainly belongs to a *different*
 *      occurrence -- a catch-up entry dated weeks later, attached to the month
 *      it was reconciling rather than the month it falls in. Repaired by
 *      re-pointing each occurrence at the payment nearest its own due date.
 *
 * Moves no money and creates no transactions: it only sets `bill_id` and
 * rewrites occurrence logs. A payment that does not exist is a gap for a human
 * to fill in the app, and this script says so rather than inventing one.
 *
 * Dry run by default -- prints the plan and exits. Pass --apply to write.
 *
 *   pnpm exec tsx --env-file=.env scripts/repair-bill-occurrence-links.ts
 *   pnpm exec tsx --env-file=.env scripts/repair-bill-occurrence-links.ts --apply
 *
 * Against production, run it locally with that DATABASE_URL; inside the
 * container drop --env-file, since the variables are already set.
 */
import { PrismaClient } from "@prisma/client";
import { descriptionCanMatch } from "./bill-matching";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
/** How far a payment may sit from a due date and still settle it. */
const MATCH_WINDOW_DAYS = 10;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) =>
  Math.abs(a.getTime() - b.getTime()) / 86_400_000;

type Plan = {
  /** Identity for the "did this pass already plan a repair here?" test. Two
   *  bills can share a description, and comparing display text let one bill's
   *  plan suppress another's gap report. */
  billId: string;
  bill: string;
  dueDate: string;
  action: string;
  detail: string;
  run: () => Promise<void>;
};

async function main() {
  const bills = await prisma.scheduledTransaction.findMany({
    include: { occurrences: { orderBy: { dueDate: "asc" } } },
  });

  const plans: Plan[] = [];
  const gaps: string[] = [];
  const conflicts: string[] = [];

  // Claims are tracked across *every* bill, not per bill: one payment settles at
  // most one occurrence anywhere, and a per-bill set let two bills plan to claim
  // the same transaction before either write happened.
  const claimedBy = new Map<string, string>();
  for (const b of bills) {
    for (const l of b.occurrences) {
      if (l.transactionId) claimedBy.set(l.transactionId, `${b.description} ${dayKey(l.dueDate)}`);
    }
  }
  const claimed = new Set(claimedBy.keys());
  const descriptionsByUser = new Map<string, string[]>();
  for (const b of bills) {
    const list = descriptionsByUser.get(b.userId) ?? [];
    list.push(b.description);
    descriptionsByUser.set(b.userId, list);
  }

  for (const bill of bills) {
    // Every payment recorded for this bill, linked or not. Description matching
    // catches the ones entered by hand, which are exactly the unlinked cases.
    const byDescription = descriptionCanMatch(
      bill.description,
      descriptionsByUser.get(bill.userId) ?? [],
    );
    const payments = await prisma.transaction.findMany({
      where: {
        userId: bill.userId,
        type: bill.type,
        OR: [
          { billId: bill.id },
          ...(byDescription
            ? [{
                billId: null,
                description: { equals: bill.description, mode: "insensitive" as const },
              }]
            : []),
        ],
      },
      select: { id: true, date: true, amount: true, billId: true, description: true },
      orderBy: { date: "asc" },
    });
    // No early return on an empty payment list: a bill whose payments were never
    // logged at all is precisely what the gap report below exists to surface,
    // and skipping ahead here printed "Nothing to repair" over it.

    for (const log of bill.occurrences) {
      const due = log.dueDate;

      // Nearest unclaimed payment to this due date, within the window.
      const candidate = payments
        .filter((p) => !claimed.has(p.id) || p.id === log.transactionId)
        .map((p) => ({ p, gap: daysBetween(p.date, due) }))
        .filter(({ gap }) => gap <= MATCH_WINDOW_DAYS)
        .sort((a, b) => a.gap - b.gap)[0];

      if (log.status === "SKIPPED") {
        if (!candidate) continue; // a genuine skip: nothing was paid
        const { p } = candidate;
        claimed.add(p.id);
        claimedBy.set(p.id, `${bill.description} ${dayKey(due)}`);
        plans.push({
          billId: bill.id,
          bill: bill.description,
          dueDate: dayKey(due),
          action: "SKIPPED -> PAID",
          detail: `link ${dayKey(p.date)} ${p.amount}${p.billId ? "" : " (also sets bill_id)"}`,
          run: async () => {
            await prisma.$transaction([
              prisma.scheduledTransactionLog.update({
                where: { id: log.id },
                data: { status: "PAID", transactionId: p.id },
              }),
              prisma.transaction.update({
                where: { id: p.id },
                data: { billId: bill.id },
              }),
            ]);
          },
        });
        continue;
      }

      if (log.status !== "PAID") continue;

      // A PAID occurrence pointing at a payment further away than one that is
      // free and closer: the catch-up case.
      if (candidate && candidate.p.id !== log.transactionId) {
        const current = payments.find((p) => p.id === log.transactionId);
        const currentGap = current ? daysBetween(current.date, due) : Infinity;
        if (candidate.gap < currentGap) {
          const { p } = candidate;
          claimed.add(p.id);
          claimedBy.set(p.id, `${bill.description} ${dayKey(due)}`);
          if (current) {
            claimed.delete(current.id);
            claimedBy.delete(current.id);
          }
          plans.push({
            billId: bill.id,
            bill: bill.description,
            dueDate: dayKey(due),
            action: "re-point PAID",
            detail:
              `${current ? dayKey(current.date) : "none"} (${currentGap.toFixed(0)}d) ` +
              `-> ${dayKey(p.date)} (${candidate.gap.toFixed(0)}d)`,
            run: async () => {
              await prisma.$transaction([
                prisma.scheduledTransactionLog.update({
                  where: { id: log.id },
                  data: { transactionId: p.id },
                }),
                prisma.transaction.update({
                  where: { id: p.id },
                  data: { billId: bill.id },
                }),
              ]);
            },
          });
        }
      }
    }

    // A PAID occurrence settled by a payment nowhere near its due date. The
    // re-point pass above cannot always fix these: when two occurrences hold
    // each other's payments, each correct replacement is already claimed by the
    // other, so both candidates are filtered out and the swap produces neither
    // a plan nor a conflict. Reporting the symptom catches the cycle without
    // trying to solve it, which is the honest limit of an automatic pass.
    for (const log of bill.occurrences) {
      if (log.status !== "PAID" || !log.transactionId) continue;
      if (plans.some((pl) => pl.billId === bill.id && pl.dueDate === dayKey(log.dueDate))) continue;
      const linked = payments.find((p) => p.id === log.transactionId);
      if (!linked) continue;
      const gap = daysBetween(linked.date, log.dueDate);
      if (gap > MATCH_WINDOW_DAYS) {
        conflicts.push(
          `${bill.description} ${dayKey(log.dueDate)} - paid, but settled by ${dayKey(linked.date)} ` +
            `${linked.amount}, ${gap.toFixed(0)} days away`,
        );
      }
    }

    // Skips this pass could not repair, split by cause. Reporting only the
    // "no payment at all" case hid the more interesting one: a payment sitting
    // right next to the skip, already claimed by a neighbouring occurrence.
    for (const log of bill.occurrences) {
      if (log.status !== "SKIPPED") continue;
      if (plans.some((pl) => pl.billId === bill.id && pl.dueDate === dayKey(log.dueDate))) {
        continue;
      }
      const near = payments
        .filter((p) => daysBetween(p.date, log.dueDate) <= MATCH_WINDOW_DAYS)
        .map((p) => ({ p, holder: claimedBy.get(p.id) }));

      if (near.length === 0) {
        gaps.push(
          `${bill.description} ${dayKey(log.dueDate)} - skipped, no payment within ${MATCH_WINDOW_DAYS}d`,
        );
        continue;
      }
      for (const { p, holder } of near) {
        conflicts.push(
          `${bill.description} ${dayKey(log.dueDate)} - skipped, but ${dayKey(p.date)} ${p.amount} ` +
            (holder ? `already settles ${holder}` : `sits unclaimed beside it`),
        );
      }
    }
  }

  if (plans.length === 0) {
    console.log("Nothing to repair.");
  } else {
    console.log(`${APPLY ? "Applying" : "Would apply"} ${plans.length} repair(s):\n`);
    for (const p of plans) {
      console.log(`  ${p.bill.padEnd(24)} ${p.dueDate}  ${p.action.padEnd(16)} ${p.detail}`);
    }
  }

  if (conflicts.length > 0) {
    console.log(`\nNeeds a decision -- a skip with a payment beside it that another`);
    console.log(`occurrence already claims. Usually a catch-up entry attached to the`);
    console.log(`month it was reconciling, with the real payment missing or named`);
    console.log(`differently, so this pass will not guess:\n`);
    for (const c of conflicts) console.log(`  ${c}`);
  }

  if (gaps.length > 0) {
    console.log(`\nLeft alone -- a skip with no payment near it is either genuine or a`);
    console.log(`missing entry, and only you can tell which:\n`);
    for (const g of gaps) console.log(`  ${g}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  for (const p of plans) await p.run();
  console.log(`\nApplied ${plans.length} repair(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
