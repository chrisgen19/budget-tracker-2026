import type { AssessmentAnomaly } from "@/types";

const KEY_PREFIX = "watchlist:v1";

/**
 * Stable only while the evidence is the same. Period findings deliberately
 * include their window, while standing findings survive opening another report.
 */
export const watchlistFindingKey = (
  finding: AssessmentAnomaly,
  period: { from: string; to: string },
): string => [
  KEY_PREFIX,
  finding.scope,
  finding.kind,
  finding.scope === "period" ? `${period.from}:${period.to}` : "standing",
  finding.title,
  finding.detail,
].map(encodeURIComponent).join(":");
