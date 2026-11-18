/** Sanitized billing view; provider credentials never enter this contract. */
export interface RouterBillingSnapshot {
  source: "openrouter-api";
  fetchedAt: string;
  utcDay: string;
  spentToday: number;
  spentTotal: number | null;
  keyLimit: number | null;
  keyRemaining: number | null;
  creditBalance: number | null;
  stale: boolean;
}

export interface ModelUsageSummary {
  account: string | null;
  billing: RouterBillingSnapshot | null;
  active: number;
  queued: number;
  concurrency: number;
  dailyBudget: number | null;
  spentOrReservedToday: number;
  confirmedSinceTracking: number;
  unverifiedReserved: number;
  legacyUpperBound: number;
  inflightReserved: number;
  requestsToday: number;
  transports: Partial<
    Record<
      "codex" | "claude",
      {
        requests: number;
        confirmed: number;
        unverified: number;
      }
    >
  > | null;
}
