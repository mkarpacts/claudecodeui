import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Info, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../../../utils/api';
import Tooltip from '../../../../../shared/view/ui/Tooltip';
import Pagination from './Pagination';
import { getModelBadgeClass, getModelShortName, formatTokens, formatCost, formatTime } from './utils';
import type { SessionSummary, SessionTurn } from './types';

type Props = {
  session: SessionSummary;
  onBack: () => void;
};

export default function TokenUsageSessionDetail({ session, onBack }: Props) {
  const { t } = useTranslation('settings');

  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(0);

  const fetchTurns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.usageStats.sessionDetail(session.session_id, {
        limit: perPage,
        offset: page * perPage,
      });
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const data = await res.json();
      setTurns(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tokenUsage.loadError'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.session_id, perPage, page]);

  useEffect(() => {
    fetchTurns();
  }, [fetchTurns]);

  // Reset page on perPage change without double-fetch
  const prevPerPage = useRef(perPage);
  useEffect(() => {
    if (prevPerPage.current !== perPage) {
      prevPerPage.current = perPage;
      if (page !== 0) {
        setPage(0);
        return;
      }
    }
  }, [perPage, page]);

  // Use session-level average to determine expensive threshold (not page-scoped)
  const expensiveThreshold = useMemo(() => {
    if (session.turn_count < 3) return Infinity;
    const avgTokens = session.total_tokens / session.turn_count;
    return avgTokens * 3;
  }, [session.turn_count, session.total_tokens]);

  const totalPages = Math.ceil(total / perPage);
  const sessionName = session.session_name || session.first_query_text || session.session_id.slice(0, 20) + '...';

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header */}
      <div>
        <button
          onClick={onBack}
          className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('tokenUsage.detail.back')}
        </button>
        <h3 className="text-lg font-medium text-foreground">{sessionName}</h3>
        <div className="mt-1 flex flex-wrap gap-4 text-sm text-muted-foreground">
          {session.username && <span>{t('tokenUsage.detail.user')}: {session.username}</span>}
          <span>{t('tokenUsage.detail.turns')}: {session.turn_count}</span>
          <span>{t('tokenUsage.detail.totalTokens')}: {formatTokens(session.total_tokens)}</span>
          <span>{t('tokenUsage.detail.cost')}: {formatCost(session.total_cost)}</span>
        </div>
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

      {/* Turns table */}
      {!loading && !error && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="w-10 px-3 py-2.5 text-left font-medium text-muted-foreground">{t('tokenUsage.detail.table.number')}</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">{t('tokenUsage.detail.table.query')}</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">{t('tokenUsage.detail.table.model')}</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    <Tooltip content={t('tokenUsage.detail.tooltips.context')} position="bottom">
                      <span className="inline-flex items-center gap-1">{t('tokenUsage.detail.table.context')} <Info className="h-3 w-3" /></span>
                    </Tooltip>
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    <Tooltip content={t('tokenUsage.detail.tooltips.output')} position="bottom">
                      <span className="inline-flex items-center gap-1">{t('tokenUsage.detail.table.output')} <Info className="h-3 w-3" /></span>
                    </Tooltip>
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    <Tooltip content={t('tokenUsage.detail.tooltips.cost')} position="bottom">
                      <span className="inline-flex items-center gap-1">{t('tokenUsage.detail.table.cost')} <Info className="h-3 w-3" /></span>
                    </Tooltip>
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">{t('tokenUsage.detail.table.time')}</th>
                </tr>
              </thead>
              <tbody>
                {turns.map((turn, i) => {
                  const context = turn.input_tokens + turn.cache_read_tokens + turn.cache_creation_tokens;
                  const isExpensive = turn.total_tokens >= expensiveThreshold;
                  return (
                    <tr
                      key={turn.id}
                      className={`border-b border-border last:border-0 ${isExpensive ? 'border-l-2 border-l-red-500' : ''}`}
                    >
                      <td className="px-3 py-2.5 text-muted-foreground">{page * perPage + i + 1}</td>
                      <td className="max-w-[240px] truncate px-3 py-2.5 text-foreground">
                        {turn.query_text || '\u2014'}
                      </td>
                      <td className="px-3 py-2.5">
                        {turn.model && (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getModelBadgeClass(turn.model)}`}>
                            {getModelShortName(turn.model)}
                          </span>
                        )}
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${isExpensive ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                        <Tooltip content={`Input: ${formatTokens(turn.input_tokens)} | Cache read: ${formatTokens(turn.cache_read_tokens)} | Cache create: ${formatTokens(turn.cache_creation_tokens)}`} position="top" delay={200}>
                          <span>{formatTokens(context)}</span>
                        </Tooltip>
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${isExpensive ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                        {formatTokens(turn.output_tokens)}
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${isExpensive ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                        {formatCost(turn.cost_usd)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">
                        {formatTime(turn.created_at)}
                      </td>
                    </tr>
                  );
                })}
                {turns.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-12 text-center text-muted-foreground">
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
