import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../utils/api';
import type { UsageData } from '../types';

// Every /api/usage/current call sends a real (billed) model request, so a result this fresh
// is reused on mount — e.g. "Open full Usage" right after the popover loaded it.
const FRESH_MS = 30_000;

type Snapshot = { data: UsageData; lastUpdated: string; fetchedAt: number };

let latest: Snapshot | null = null;
let inFlight: Promise<Snapshot> | null = null;

/** One request at a time, shared by every mounted consumer. */
function requestUsage(): Promise<Snapshot> {
  inFlight ??= (async () => {
    const res = await api.usage.current();
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `Server error (${res.status})`);
    }
    latest = { data: await res.json(), lastUpdated: new Date().toLocaleTimeString(), fetchedAt: Date.now() };
    return latest;
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/** Loads the Claude plan usage on mount (unless a fresh result exists) and exposes a manual refresh. */
export function useClaudeUsage() {
  const [cached] = useState(() => (latest && Date.now() - latest.fetchedAt < FRESH_MS ? latest : null));
  const [data, setData] = useState<UsageData | null>(cached?.data ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState(cached?.lastUpdated ?? '');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await requestUsage();
      setData(snapshot.data);
      setLastUpdated(snapshot.lastUpdated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cached) void refresh();
  }, [cached, refresh]);

  return { data, loading, error, lastUpdated, refresh };
}
