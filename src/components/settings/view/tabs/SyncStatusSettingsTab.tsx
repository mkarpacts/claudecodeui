import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, FolderSync, Loader2, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../../utils/api';

type RepoStatus = {
  name: string;
  branch: string;
  status: 'ok' | 'failed';
  lastSyncedAt: string | null;
  lastFailedAt?: string;
  error?: string;
};

type SyncStatusData = {
  lastCycle: {
    timestamp: string;
    success: number;
    failed: number;
    total: number;
  } | null;
  nextSyncIn: number | null;
  nextSyncAt: string | null;
  repos: RepoStatus[];
};

/** Parse timestamp that may use space or T as date/time separator. */
function parseTimestamp(ts: string): Date {
  return new Date(ts.includes('T') ? ts : ts.replace(' ', 'T'));
}

function formatTime(isoString: string): string {
  const date = parseTimestamp(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

function formatCountdown(nextSyncAt: string): string {
  const diff = new Date(nextSyncAt).getTime() - Date.now();
  if (diff <= 0) return 'now';
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}min`;
  if (hours > 0) return `${hours}h`;
  if (mins > 0) return `${mins}min`;
  return '< 1min';
}

type BannerState = { color: string; dotClass: string; text: string };

function getBannerState(data: SyncStatusData, t: (key: string) => string): BannerState {
  if (!data.lastCycle) {
    return { color: 'text-muted-foreground', dotClass: 'bg-muted-foreground', text: t('sync.noData') };
  }
  if (data.lastCycle.failed === 0) {
    return { color: 'text-green-600 dark:text-green-400', dotClass: 'bg-green-500', text: t('sync.allSynced') };
  }
  if (data.lastCycle.success > 0) {
    return { color: 'text-amber-600 dark:text-amber-400', dotClass: 'bg-amber-500', text: t('sync.syncedWithWarnings') };
  }
  return { color: 'text-red-600 dark:text-red-400', dotClass: 'bg-red-500', text: t('sync.syncFailed') };
}

function RepoDot({ status }: { status: 'ok' | 'failed' }) {
  const cls = status === 'ok' ? 'bg-green-500' : 'bg-red-500';
  return <div className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${cls}`} />;
}

export default function SyncStatusSettingsTab() {
  const { t } = useTranslation('settings');
  const [data, setData] = useState<SyncStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.gitSync.status();
        if (!res.ok) throw new Error(`Server error (${res.status})`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('sync.loadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [t]);

  const filteredRepos = useMemo(() => {
    if (!data?.repos) return [];
    if (!search.trim()) return data.repos;
    const q = search.toLowerCase();
    return data.repos.filter((r) => r.name.toLowerCase().includes(q));
  }, [data?.repos, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Header t={t} />
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      </div>
    );
  }

  if (!data || (!data.lastCycle && data.repos.length === 0)) {
    return (
      <div className="space-y-6">
        <Header t={t} />
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {t('sync.noLog')}
        </div>
      </div>
    );
  }

  const banner = getBannerState(data, t);

  return (
    <div className="space-y-6 md:space-y-8">
      <Header t={t} />

      {/* Overall banner */}
      <div className="rounded-lg border border-border bg-card p-5 text-center">
        <div className="flex items-center justify-center gap-2">
          <div className={`h-3.5 w-3.5 rounded-full ${banner.dotClass}`} />
          <span className={`text-lg font-semibold ${banner.color}`}>{banner.text}</span>
        </div>
        {data.lastCycle && (
          <div className="mt-2 text-sm text-muted-foreground">
            {t('sync.lastCycle')}: {formatTime(data.lastCycle.timestamp)}
            {' · '}
            {data.lastCycle.success} {t('sync.ok')}, {data.lastCycle.failed} {t('sync.failed')}
          </div>
        )}
        {data.nextSyncAt && (
          <div className="mt-1 text-xs text-muted-foreground">
            {t('sync.nextSync')} {formatCountdown(data.nextSyncAt)}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder={t('sync.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Repository table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="w-8 px-3 py-2.5" />
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">{t('sync.repository')}</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">{t('sync.lastSynced')}</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">{t('sync.branch')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredRepos.map((repo) => (
              <tr key={repo.name} className="border-b border-border last:border-0">
                <td className="px-3 py-2.5 text-center">
                  <RepoDot status={repo.status} />
                </td>
                <td className="px-3 py-2.5 font-medium text-foreground">{repo.name}</td>
                <td className="px-3 py-2.5">
                  <RepoSyncTime repo={repo} t={t} />
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{repo.branch}</td>
              </tr>
            ))}
            {filteredRepos.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  {search ? `No repositories matching "${search}"` : t('sync.noData')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Repo count */}
      <div className="text-xs text-muted-foreground">
        {t('sync.repoCount', { count: data.repos.length })}
      </div>
    </div>
  );
}

function Header({ t }: { t: (key: string) => string }) {
  return (
    <div className="flex items-center gap-3">
      <FolderSync className="h-5 w-5 text-blue-600" />
      <h3 className="text-lg font-medium text-foreground">{t('sync.title')}</h3>
    </div>
  );
}

function RepoSyncTime({ repo, t }: { repo: RepoStatus; t: (key: string, opts?: Record<string, unknown>) => string }) {
  if (!repo.lastSyncedAt && repo.status === 'failed') {
    return <span className="text-red-500 dark:text-red-400">{t('sync.neverSynced')}</span>;
  }

  if (repo.lastSyncedAt && repo.status === 'failed' && repo.lastFailedAt) {
    const failedTime = parseTimestamp(repo.lastFailedAt);
    const failedTimeStr = failedTime.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return (
      <span>
        <span className="text-muted-foreground">{formatTime(repo.lastSyncedAt)}</span>
        {' '}
        <span className="text-amber-500 dark:text-amber-400">({t('sync.failedAt', { time: failedTimeStr })})</span>
      </span>
    );
  }

  return <span className="text-muted-foreground">{formatTime(repo.lastSyncedAt!)}</span>;
}
