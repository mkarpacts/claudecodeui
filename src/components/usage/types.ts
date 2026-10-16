export type RateLimitPeriod = {
  key: string;
  percent: number | null;
  resetAt: number | null;
  status: string | null;
  limit?: number;
  remaining?: number;
};

export type RateLimits = {
  type: 'unified' | 'standard';
  periods: RateLimitPeriod[];
};

export type UsageData = {
  plan: string | null;
  rateLimitTier: string | null;
  rateLimits: RateLimits | null;
};

/** True when the plan reports at least one rate-limit period. */
export function hasRateLimits(data: UsageData): data is UsageData & { rateLimits: RateLimits } {
  return (data.rateLimits?.periods.length ?? 0) > 0;
}
