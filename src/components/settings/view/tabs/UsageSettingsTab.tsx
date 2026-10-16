import { BarChart3, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useClaudeUsage } from '../../../usage/hooks/useClaudeUsage';
import { hasRateLimits } from '../../../usage/types';
import {
  UsageEmptyState,
  UsageError,
  UsageLastUpdated,
  UsageMeters,
  UsagePlanBadge,
} from '../../../usage/view/UsageParts';

/** Settings tab that displays Anthropic API usage and rate-limit meters. */
export default function UsageSettingsTab() {
  const { t } = useTranslation('settings');
  const { data, loading, error, lastUpdated, refresh } = useClaudeUsage();

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <Header />
        <UsageError message={error || t('usage.loadError')} />
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <Header />

      {error && <UsageError message={error} />}

      <UsagePlanBadge data={data} />

      {/* Rate limit meters */}
      {hasRateLimits(data) && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t('usage.planLimits')}
          </h4>
          <UsageMeters data={data} />
          <UsageLastUpdated lastUpdated={lastUpdated} loading={loading} onRefresh={refresh} />
        </div>
      )}

      <UsageEmptyState data={data} />
    </div>
  );
}

/** Page header with icon and translated title. */
function Header() {
  const { t } = useTranslation('settings');
  return (
    <div className="flex items-center gap-3">
      <BarChart3 className="h-5 w-5 text-blue-600" />
      <h3 className="text-lg font-medium text-foreground">{t('usage.title')}</h3>
    </div>
  );
}
