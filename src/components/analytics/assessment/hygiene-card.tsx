"use client";

import { ClipboardCheck } from "lucide-react";
import { Section, AllClear, type Money } from "./section";
import type { AssessmentHygieneFacts } from "@/types";

/**
 * The accuracy problems, kept apart from the money problems.
 *
 * Unlabeled spend is split by cause on purpose: a bill payment bypasses label
 * auto-apply, so those rows are the app's behaviour and not the user's
 * carelessness. Reporting one total would turn a system gap into a lecture.
 */
export function HygieneCard({ hygiene, fmt }: { hygiene: AssessmentHygieneFacts; fmt: Money }) {
  const { duplicates, unlabeled, fragmentation, incomeConcentrationPct, topIncomeSource } = hygiene;
  const clean = duplicates.length === 0 && fragmentation.length === 0 && unlabeled.manual.count === 0;

  return (
    <Section icon={ClipboardCheck} title="Data quality" subtitle="Problems with the numbers rather than with the spending.">
      {clean && <AllClear>No duplicates, no inconsistent descriptions, nothing unlabeled by hand.</AllClear>}

      <ul className="space-y-3">
        {duplicates.length > 0 && (
          <li>
            <p className="text-sm font-medium text-warm-700">
              {duplicates.length} possible duplicate{duplicates.length > 1 ? "s" : ""}
            </p>
            <p className="text-sm text-warm-500">Same day, description and amount — usually a double submit.</p>
            <ul className="mt-1 space-y-0.5">
              {duplicates.slice(0, 3).map((d, i) => (
                <li key={i} className="text-xs text-warm-400">
                  {d.date} · {d.description} · {fmt(d.amount)} × {d.copies}
                  {d.inPeriod && " (this period)"}
                </li>
              ))}
            </ul>
          </li>
        )}

        {(unlabeled.manual.count > 0 || unlabeled.fromBills.count > 0) && (
          <li>
            <p className="text-sm font-medium text-warm-700">{unlabeled.pctOfSpend}% of spending carries no label</p>
            {unlabeled.fromBills.count > 0 && (
              <p className="text-sm text-warm-500">
                {unlabeled.fromBills.count} of them are bill payments, which bypass label auto-apply — that is the app&apos;s
                behaviour, not something you missed.
              </p>
            )}
            {unlabeled.manual.count > 0 && (
              <p className="text-sm text-warm-500">
                {unlabeled.manual.count} were entered by hand ({fmt(unlabeled.manual.total)}) and could be grouped.
              </p>
            )}
          </li>
        )}

        {fragmentation.length > 0 && (
          <li>
            <p className="text-sm font-medium text-warm-700">Same thing spelled several ways</p>
            <p className="text-sm text-warm-500">
              Description search — including the Telegram bot&apos;s — only finds the spelling you type.
            </p>
            <ul className="mt-1 space-y-0.5">
              {fragmentation.slice(0, 3).map((f) => (
                <li key={f.normalized} className="text-xs text-warm-400">
                  {f.variants.map((v) => `"${v}"`).join(" · ")}
                </li>
              ))}
            </ul>
          </li>
        )}

        {incomeConcentrationPct !== null && incomeConcentrationPct >= 80 && topIncomeSource && (
          <li>
            <p className="text-sm font-medium text-warm-700">{incomeConcentrationPct}% of income comes from one source</p>
            <p className="text-sm text-warm-500">
              {topIncomeSource} carries almost all of it. Worth knowing, not necessarily worth changing.
            </p>
          </li>
        )}
      </ul>
    </Section>
  );
}
