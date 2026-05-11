import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Coins, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../../../utils/api';
import TokenUsageSessionDetail from './TokenUsageSessionDetail';
import Pagination from './Pagination';
import Tooltip from '../../../../../shared/view/ui/Tooltip';
import { getModelBadgeClass, getModelShortName, formatTokens, formatCost, formatDate, periodToRange } from './utils';
import type {
  SessionSummary,
  UsageTotals,
  SortColumn,
  SortDir,
  PeriodPreset,
} from './types';

const SORT_COLUMNS: { key: SortColumn; labelKey: string }[] = [
  { key: 'total_context', labelKey: 'tokenUsage.table.context' },
  { key: 'total_output', labelKey: 'tokenUsage.table.output' },
  { key: 'total_tokens', labelKey: 'tokenUsage.table.total' },
  { key: 'total_cost', labelKey: 'tokenUsage.table.cost' },
  { key: 'turn_count', labelKey: 'tokenUsage.table.turns' },
];

export default function TokenUsageTab() {
  const { t } = useTranslation('settings');

  // Filters
  const [period, setPeriod] = useState<PeriodPreset>('last30days');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [modelFilter, setModelFilter] = useState('');

  // Sorting
  const [sortBy, setSortBy] = useState<SortColumn>('total_tokens');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Pagination
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(0);

  // Data
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail view
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null);

  const dateRange = useMemo(() => {
    if (period === 'custom' && customFrom && customTo) {
      const fromDate = new Date(customFrom);
      const toDate = new Date(customTo + 'T23:59:59');
      // Swap if from > to
      if (fromDate > toDate) return { from: toDate.toISOString(), to: fromDate.toISOString() };
      return { from: fromDate.toISOString(), to: toDate.toISOString() };
    }
    return periodToRange(period);
  }, [period, customFrom, customTo]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        from: dateRange.from,
        to: dateRange.to,
        model: modelFilter || undefined,
        sortBy,
        sortDir,
        limit: perPage,
        offset: page * perPage,
      };

      const [sessionsRes, summaryRes] = await Promise.all([
        api.usageStats.sessions(params),
        api.usageStats.summary({ from: dateRange.from, to: dateRange.to, model: modelFilter || undefined }),
      ]);

      if (!sessionsRes.ok) throw new Error(`Server error (${sessionsRes.status})`);
      if (!summaryRes.ok) throw new Error(`Server error (${summaryRes.status})`);

      const sessionsData = await sessionsRes.json();
      const summaryData = await summaryRes.json();

      setSessions(sessionsData.items);
      setTotal(sessionsData.total);
      setTotals(summaryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tokenUsage.loadError'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, modelFilter, sortBy, sortDir, perPage, page]);

  // Track filter identity — when filters change, reset page to 0 then fetch
  const filterKey = `${dateRange.from}|${dateRange.to}|${modelFilter}|${sortBy}|${sortDir}|${perPage}`;
  const prevFilterKey = useRef(filterKey);

  useEffect(() => {
    const filtersChanged = prevFilterKey.current !== filterKey;
    if (filtersChanged) {
      prevFilterKey.current = filterKey;
      if (page !== 0) {
        setPage(0);
        return; // page change will re-trigger this effect via fetchData
      }
    }
    fetchData();
  }, [fetchData, filterKey, page]);

  const handleSort = (col: SortColumn) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  // Detail view
  if (selectedSession) {
    return (
      <TokenUsageSessionDetail
        session={selectedSession}
        onBack={() => setSelectedSession(null)}
      />
    );
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Coins className="h-5 w-5 text-blue-600" />
        <h3 className="text-lg font-medium text-foreground">{t('tokenUsage.title')}</h3>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Period dropdown */}
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodPreset)}
          className="rounded-lg border border-border bg-card py-1.5 pl-3 pr-8 text-sm text-foreground"
        >
          <option value="today">{t('tokenUsage.period.today')}</option>
          <option value="last7days">{t('tokenUsage.period.last7days')}</option>
          <option value="last30days">{t('tokenUsage.period.last30days')}</option>
          <option value="last90days">{t('tokenUsage.period.last90days')}</option>
          <option value="allTime">{t('tokenUsage.period.allTime')}</option>
          <option value="custom">{t('tokenUsage.period.custom')}</option>
        </select>

        {period === 'custom' && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            />
            <span className="text-sm text-muted-foreground">&ndash;</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            />
          </>
        )}

        {/* Model dropdown */}
        <select
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          className="rounded-lg border border-border bg-card py-1.5 pl-3 pr-8 text-sm text-foreground"
        >
          <option value="">{t('tokenUsage.model.all')}</option>
          <option value="opus">Opus</option>
          <option value="sonnet">Sonnet</option>
          <option value="haiku">Haiku</option>
        </select>

        {/* Summary stats (right-aligned) */}
        {totals && (
          <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
            <span>{t('tokenUsage.summary.sessions')}: <strong className="text-foreground">{totals.session_count}</strong></span>
            <span>{t('tokenUsage.summary.totalTokens')}: <strong className="text-foreground">{formatTokens(totals.total_tokens)}</strong></span>
            <span>{t('tokenUsage.summary.totalCost')}: <strong className="text-foreground">{formatCost(totals.total_cost)}</strong></span>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-destructive">{error}</div>
      )}

      {/* Table */}
      {!loading && !error && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="w-10 px-3 py-2.5 text-left font-medium text-muted-foreground">{t('tokenUsage.table.number')}</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">{t('tokenUsage.table.session')}</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">{t('tokenUsage.table.user')}</th>
                  {SORT_COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="cursor-pointer px-3 py-2.5 text-right font-medium text-muted-foreground hover:text-foreground"
                    >
                      <span className="inline-flex items-center gap-1">
                        {t(col.labelKey)}
                        {sortBy === col.key && (
                          sortDir === 'desc'
                            ? <ChevronDown className="h-3.5 w-3.5 text-blue-500" />
                            : <ChevronUp className="h-3.5 w-3.5 text-blue-500" />
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((s, i) => (
                  <tr
                    key={s.session_id}
                    onClick={() => setSelectedSession(s)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/50"
                  >
                    <td
                      className="px-3 py-2.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`/session/${s.session_id}`, '_blank');
                      }}
                      title={s.session_id}
                    >
                      {page * perPage + i + 1}
                    </td>
                    <td className="max-w-[280px] px-3 py-2.5">
                      <div className="truncate font-medium text-foreground">
                        {s.session_name || s.first_query_text || s.session_id.slice(0, 12) + '...'}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{formatDate(s.first_turn)}</span>
                        {s.models && s.models.split(',').map((m) => (
                          <span key={m} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getModelBadgeClass(m)}`}>
                            {getModelShortName(m)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{s.username || '\u2014'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      <Tooltip content={`Input: ${formatTokens(s.total_input)} | Cache read: ${formatTokens(s.total_cache_read)} | Cache create: ${formatTokens(s.total_cache_create)}`} position="top" delay={200}>
                        <span>{formatTokens(s.total_context)}</span>
                      </Tooltip>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatTokens(s.total_output)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-foreground">{formatTokens(s.total_tokens)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatCost(s.total_cost)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{s.turn_count}</td>
                  </tr>
                ))}
                {sessions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                      {t('tokenUsage.noSessions')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > 0 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              perPage={perPage}
              onPageChange={setPage}
              onPerPageChange={setPerPage}
            />
          )}
        </>
      )}
    </div>
  );
}
