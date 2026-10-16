import { AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import { hasRateLimits } from '../types';
import type { RateLimitPeriod, RateLimits, UsageData } from '../types';

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** Returns a Tailwind background-color class based on the usage percentage. */
function barColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-blue-600 dark:bg-blue-500';
}

/** Maps a period key to a translated label based on the rate-limit type. */
const LABEL_KEYS: Record<RateLimits['type'], Record<string, string>> = {
  unified: { '5h': 'usage.currentSession', '7d': 'usage.weeklyAllModels' },
  standard: {
    tokens: 'usage.standardTokens',
    requests: 'usage.standardRequests',
    'input-tokens': 'usage.standardInputTokens',
    'output-tokens': 'usage.standardOutputTokens',
  },
};

function periodLabel(type: RateLimits['type'], key: string, t: TFn): string {
  const i18nKey = LABEL_KEYS[type]?.[key];
  return i18nKey ? t(i18nKey) : key;
}

/** Formats a unix-epoch reset timestamp into a localised human-readable string. */
function formatResetTime(resetAt: number | null, t: TFn): string {
  if (resetAt === null) return '';
  const diffSec = resetAt - Math.floor(Date.now() / 1000);
  if (diffSec <= 0) return t('usage.resetsNow');

  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);

  if (h > 24) {
    const date = new Date(resetAt * 1000);
    const day = date.toLocaleDateString(undefined, { weekday: 'short' });
    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return t('usage.resetsOnDay', { day, time });
  }
  if (h > 0 && m > 0) return t('usage.resetsInHrMin', { h, m });
  if (h > 0) return t('usage.resetsInHr', { h });
  if (m > 0) return t('usage.resetsInMin', { m });
  return t('usage.resetsLessThanMinute');
}

/** Renders a single rate-limit progress bar with reset time and status. */
function RateLimitMeter({ label, period, compact }: { label: string; period: RateLimitPeriod; compact: boolean }) {
  const { t } = useTranslation('settings');
  if (period.percent === null) return null;
  const resetText = formatResetTime(period.resetAt, t);
  const pct = Math.min(period.percent, 100);
  const { limit, remaining } = period;

  return (
    <div className={cn('rounded-lg border border-border bg-card', compact ? 'space-y-1.5 p-2.5' : 'space-y-2 p-4')}>
      <div className={cn('flex items-center justify-between', compact ? 'text-xs' : 'text-sm')}>
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {period.percent}% {t('usage.used')}
        </span>
      </div>
      <div className={cn('overflow-hidden rounded-full bg-muted', compact ? 'h-1.5' : 'h-2.5')}>
        <div
          className={`h-full rounded-full transition-all ${barColor(period.percent)}`}
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
      <div className={cn('flex items-center justify-between text-muted-foreground', compact ? 'text-[11px]' : 'text-xs')}>
        <span>
          {resetText}
          {limit != null && remaining != null && (
            <span className="ml-2">
              ({remaining.toLocaleString()} / {limit.toLocaleString()} {t('usage.remaining')})
            </span>
          )}
        </span>
        {period.status && period.status !== 'allowed' && (
          <span className="font-medium text-amber-600 dark:text-amber-400">{period.status}</span>
        )}
      </div>
    </div>
  );
}

/** Plan badge ("Claude Team") with the raw rate-limit tier next to it. */
export function UsagePlanBadge({ data, compact = false }: { data: UsageData; compact?: boolean }) {
  if (!data.plan) return null;
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center', compact ? 'justify-end gap-x-2 gap-y-1' : 'gap-3')}>
      <span
        className={cn(
          'rounded-full bg-blue-100 font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
          compact ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        )}
      >
        Claude {data.plan}
      </span>
      {data.rateLimitTier && (
        <span className={cn('truncate text-muted-foreground', compact ? 'text-[11px]' : 'text-xs')}>
          {data.rateLimitTier}
        </span>
      )}
    </div>
  );
}

/** All rate-limit meters of the plan; renders nothing when no limits are known. */
export function UsageMeters({ data, compact = false }: { data: UsageData; compact?: boolean }) {
  const { t } = useTranslation('settings');
  if (!hasRateLimits(data)) return null;
  const rl = data.rateLimits;

  return (
    <>
      {rl.type === 'standard' && (
        <p className="text-xs text-muted-foreground">{t('usage.standardNote')}</p>
      )}
      {rl.periods.map((period) => (
        <RateLimitMeter
          key={period.key}
          label={periodLabel(rl.type, period.key, t)}
          period={period}
          compact={compact}
        />
      ))}
    </>
  );
}

/** "Last updated" timestamp with a refresh button. */
export function UsageLastUpdated({
  lastUpdated,
  loading,
  onRefresh,
}: {
  lastUpdated: string;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="flex items-center gap-2">
      {lastUpdated && (
        <span className="text-xs text-muted-foreground">
          {t('usage.lastUpdated')}: {lastUpdated}
        </span>
      )}
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        title={t('usage.refresh')}
        aria-label={t('usage.refresh')}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}

/** Explains why no meters are shown: expired credentials or no Claude plan at all. */
export function UsageEmptyState({ data, compact = false }: { data: UsageData; compact?: boolean }) {
  const { t } = useTranslation('settings');
  let message: string | null = null;
  if (!data.plan) message = t('usage.noPlanDetected');
  else if (!hasRateLimits(data)) message = t('usage.noLimitsAvailable');
  if (!message) return null;

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card text-muted-foreground',
        compact ? 'p-2.5 text-xs' : 'p-4 text-sm',
      )}
    >
      {message}
    </div>
  );
}

/** Inline error notice in the Usage styling. */
export function UsageError({ message, compact = false }: { message: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border bg-card text-destructive',
        compact ? 'p-2.5 text-xs' : 'p-3 text-sm',
      )}
    >
      <AlertCircle className="h-4 w-4 flex-shrink-0" />
      {message}
    </div>
  );
}
