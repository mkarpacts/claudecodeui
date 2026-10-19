import type { TFunction } from 'i18next';
import { IMAGE_FILE_EXTENSIONS } from '../constants/constants';
import type { FileTreeNode, FileTreeSort, FileTreeSortField } from '../types/types';

type SortKeyGetter = (item: FileTreeNode) => number | null;

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const toTimestamp = (date?: string) => {
  const time = date ? Date.parse(date) : NaN;
  return Number.isNaN(time) ? null : time;
};

const newerDate = (a?: string, b?: string) => ((toTimestamp(b) ?? -Infinity) > (toTimestamp(a) ?? -Infinity) ? b : a);

// A folder's own mtime only moves when a direct entry is added, removed or renamed, so the detailed
// view shows (and sorts by) the newest modification anywhere inside the folder instead.
export function withLatestModified(items: FileTreeNode[]): FileTreeNode[] {
  return items.map((item) => {
    if (!item.children?.length) {
      return item;
    }
    const children = withLatestModified(item.children);
    const modified = children.reduce<string | undefined>((latest, child) => newerDate(latest, child.modified), item.modified);
    return { ...item, children, modified };
  });
}

// Numeric key per column; null means "no value" and sorts last. A directory's stat size says
// nothing about its contents, so folders get no size key and fall back to name order.
const SORT_KEYS: Record<Exclude<FileTreeSortField, 'name'>, SortKeyGetter> = {
  size: (item) => (item.type === 'file' ? item.size ?? 0 : null),
  modified: (item) => toTimestamp(item.modified),
};

// Folders stay above files for name and size; by date, folders and files share one timeline.
// The chosen column orders each level, recursively.
export function sortFileTree(items: FileTreeNode[], sort: FileTreeSort): FileTreeNode[] {
  const multiplier = sort.direction === 'asc' ? 1 : -1;
  const getKey = sort.field === 'name' ? null : SORT_KEYS[sort.field];
  const foldersFirst = sort.field !== 'modified';

  const sortLevel = (nodes: FileTreeNode[]): FileTreeNode[] =>
    nodes
      .map((item) => ({ item, key: getKey ? getKey(item) : null }))
      .sort((a, b) => {
        if (foldersFirst && a.item.type !== b.item.type) {
          return a.item.type === 'directory' ? -1 : 1;
        }
        if ((a.key === null) !== (b.key === null)) {
          return a.key === null ? 1 : -1;
        }
        const byName = nameCollator.compare(a.item.name, b.item.name);
        if (!getKey) {
          return byName * multiplier;
        }
        return ((a.key ?? 0) - (b.key ?? 0)) * multiplier || byName;
      })
      .map(({ item }) => (item.children?.length ? { ...item, children: sortLevel(item.children) } : item));

  return sortLevel(items);
}

export function filterFileTree(items: FileTreeNode[], query: string): FileTreeNode[] {
  return items.reduce<FileTreeNode[]>((filteredItems, item) => {
    const matchesName = item.name.toLowerCase().includes(query);
    const filteredChildren =
      item.type === 'directory' && item.children ? filterFileTree(item.children, query) : [];

    if (matchesName || filteredChildren.length > 0) {
      filteredItems.push({
        ...item,
        children: filteredChildren,
      });
    }

    return filteredItems;
  }, []);
}

// During search we auto-expand every directory present in the filtered subtree.
export function collectExpandedDirectoryPaths(items: FileTreeNode[]): string[] {
  const paths: string[] = [];

  const visit = (nodes: FileTreeNode[]) => {
    nodes.forEach((node) => {
      if (node.type === 'directory' && node.children && node.children.length > 0) {
        paths.push(node.path);
        visit(node.children);
      }
    });
  };

  visit(items);
  return paths;
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes === 0) {
    return '0 B';
  }

  const base = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const index = Math.floor(Math.log(bytes) / Math.log(base));

  return `${(bytes / Math.pow(base, index)).toFixed(1).replace(/\.0$/, '')} ${sizes[index]}`;
}

export function formatRelativeTime(date: string | undefined, t: TFunction): string {
  if (!date) {
    return '-';
  }

  const now = new Date();
  const past = new Date(date);
  const diffInSeconds = Math.floor((now.getTime() - past.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return t('fileTree.justNow');
  }

  if (diffInSeconds < 3600) {
    return t('fileTree.minAgo', { count: Math.floor(diffInSeconds / 60) });
  }

  if (diffInSeconds < 86400) {
    return t('fileTree.hoursAgo', { count: Math.floor(diffInSeconds / 3600) });
  }

  if (diffInSeconds < 2592000) {
    return t('fileTree.daysAgo', { count: Math.floor(diffInSeconds / 86400) });
  }

  return past.toLocaleDateString();
}

export function isImageFile(filename: string): boolean {
  const extension = filename.split('.').pop()?.toLowerCase();
  return Boolean(extension && IMAGE_FILE_EXTENSIONS.has(extension));
}

