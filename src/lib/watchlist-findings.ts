import type { AssessmentAnomaly } from "@/types";

const KEY_PREFIX = "watchlist:v1";

const encodeKeyPart = (value: unknown): string =>
  encodeURIComponent(JSON.stringify(value) ?? "null");

/**
 * Stable only while the evidence is the same. Period findings deliberately
 * include their window, while standing findings survive opening another report.
 */
export const watchlistFindingKey = (
  finding: AssessmentAnomaly,
  period: { from: string; to: string },
): string => `${KEY_PREFIX}:${[
  finding.scope,
  finding.kind,
  finding.scope === "period" ? `${period.from}:${period.to}` : "standing",
  ...(finding.stateKey ? [finding.stateKey] : [
    finding.title, finding.detail, finding.current, finding.baseline, finding.changePct,
    finding.drillDown, finding.findingKeyEvidence,
  ]),
].map(encodeKeyPart).join(":")}`;
