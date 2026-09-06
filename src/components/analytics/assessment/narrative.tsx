"use client";

import {
  Sparkles,
  AlertTriangle,
  Activity,
  TrendingUp,
  ClipboardCheck,
  Scissors,
  PiggyBank,
  Lightbulb,
  CheckCircle2,
  Globe,
  ExternalLink,
  Compass,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Section, SEVERITY_STYLES, type Money } from "./section";
import type { AiAssessmentReport } from "@/types";

const DIRECTION_TONE = {
  up: "text-expense",
  down: "text-income",
  new: "text-amber-dark",
  stable: "text-warm-400",
} as const;

function TipList({ items }: { items: Array<{ title: string; detail: string }> }) {
  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={i}>
          <p className="text-sm font-medium text-warm-700">{item.title}</p>
          <p className="text-sm text-warm-500">{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}

/** Severity-dotted list, shared by the watch list and the patterns the model read. */
function SeverityList({ items }: { items: Array<{ title: string; detail: string; severity: keyof typeof SEVERITY_STYLES }> }) {
  return (
    <ul className="space-y-3">
      {items.map((item, i) => {
        const sev = SEVERITY_STYLES[item.severity];
        return (
          <li key={i} className="flex gap-3">
            <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", sev.dot)} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-warm-700">
                {item.title} <span className={cn("text-[10px] uppercase tracking-wider", sev.text)}>· {sev.label}</span>
              </p>
              <p className="text-sm text-warm-500">{item.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The written half of the assessment.
 *
 * Every section here is the model's reading of figures computed server-side and
 * rendered below it, which is why the two are shown together: a claim about
 * money that cannot be checked against the row it came from is worth very
 * little, however well it is phrased.
 */
export function AssessmentNarrative({ report, fmt }: { report: AiAssessmentReport; fmt: Money }) {
  return (
    <>
      <Section icon={Sparkles} title="Summary">
        <p className="text-sm text-warm-600 leading-relaxed">{report.summary}</p>
        <p className="text-sm text-warm-500 leading-relaxed mt-3">{report.scoreCommentary}</p>
      </Section>

      {report.outlook && (
        <Section icon={Compass} title="Outlook" subtitle="The next few weeks, given what is due and the current pace.">
          <p className="text-sm text-warm-600 leading-relaxed">{report.outlook}</p>
        </Section>
      )}

      {report.patterns.length > 0 && (
        <Section icon={Activity} title="What stood out" subtitle="Read from the measured findings below.">
          <SeverityList items={report.patterns} />
        </Section>
      )}

      {report.trends.length > 0 && (
        <Section icon={TrendingUp} title="Where things are heading">
          <ul className="space-y-3">
            {report.trends.map((t, i) => (
              <li key={i}>
                <p className="text-sm font-medium text-warm-700">
                  {t.title}{" "}
                  <span className={cn("text-[10px] uppercase tracking-wider", DIRECTION_TONE[t.direction])}>
                    · {t.direction}
                  </span>
                </p>
                <p className="text-sm text-warm-500">{t.detail}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.dataQuality.length > 0 && (
        <Section
          icon={ClipboardCheck}
          title="Worth correcting"
          subtitle="Problems with the numbers, not with the spending."
        >
          <ul className="space-y-3">
            {report.dataQuality.map((d, i) => (
              <li key={i} className="p-3 rounded-xl bg-cream-50/60">
                <p className="text-sm font-medium text-warm-700">{d.title}</p>
                <p className="text-sm text-warm-500 mt-1">{d.detail}</p>
                {d.fix && <p className="text-sm text-warm-600 mt-1">🔧 {d.fix}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.watchList.length > 0 && (
        <Section icon={AlertTriangle} title="Watch list">
          <SeverityList items={report.watchList} />
        </Section>
      )}

      {report.cutBack.length > 0 && (
        <Section icon={Scissors} title="Cut back">
          <ul className="space-y-3">
            {report.cutBack.map((item, i) => (
              <li key={i} className="p-3 rounded-xl bg-cream-50/60">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-warm-700 truncate">{item.title}</p>
                  {item.estimatedMonthlySaving !== null && (
                    <span className="text-xs font-medium text-income shrink-0">
                      save ~{fmt(item.estimatedMonthlySaving)}/mo
                    </span>
                  )}
                </div>
                <p className="text-sm text-warm-500 mt-1">{item.reason}</p>
                <p className="text-sm text-warm-600 mt-1">💡 {item.suggestion}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.boostSavings.length > 0 && (
        <Section icon={PiggyBank} title="Boost savings">
          <TipList items={report.boostSavings} />
        </Section>
      )}

      {report.earnIdeas.length > 0 && (
        <Section icon={Lightbulb} title="Ways to earn">
          <TipList items={report.earnIdeas} />
        </Section>
      )}

      {report.quickActions.length > 0 && (
        <Section icon={CheckCircle2} title="Quick actions" subtitle="The first one is the highest-leverage thing this week.">
          <ul className="space-y-2">
            {report.quickActions.map((action, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-warm-600">
                <CheckCircle2 className="w-4 h-4 text-income shrink-0 mt-0.5" />
                <span>{action}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(report.webTips.length > 0 || report.sources.length > 0) && (
        <Section icon={Globe} title="Tips from the web">
          {report.webTips.length > 0 && <TipList items={report.webTips} />}
          {report.sources.length > 0 && (
            <div className="mt-4 pt-3 border-t border-cream-200/70">
              <p className="text-[10px] font-medium tracking-wider text-warm-400 uppercase mb-2">Sources</p>
              <ul className="space-y-1.5">
                {report.sources.map((s, i) => (
                  <li key={i}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-amber-dark hover:underline"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{s.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}
    </>
  );
}
