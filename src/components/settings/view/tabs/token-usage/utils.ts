import type { PeriodPreset } from './types';

const MODEL_COLORS: Record<string, string> = {
  opus: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  sonnet: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  haiku: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
};

export function getModelBadgeClass(model: string): string {
  const lower = model.toLowerCase();
  for (const [key, cls] of Object.entries(MODEL_COLORS)) {
    if (lower.includes(key)) return cls;
  }
  return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
}

export function getModelShortName(model: string): string {
  const parts = model.split('-');
  return parts.find((p) => ['opus', 'sonnet', 'haiku'].includes(p)) || model;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatCost(n: number): string {
  if (!n) return '\u2014';
  return `$${n.toFixed(4)}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function periodToRange(preset: PeriodPreset): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  switch (preset) {
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { from: start.toISOString(), to };
    }
    case 'last7days':
      return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), to };
    case 'last30days':
      return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), to };
    case 'last90days':
      return { from: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(), to };
    case 'allTime':
      return { from: '2000-01-01T00:00:00.000Z', to };
    default:
      return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), to };
  }
}
