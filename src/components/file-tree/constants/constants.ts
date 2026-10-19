import type {
  FileTreeSort,
  FileTreeSortDirection,
  FileTreeSortField,
  FileTreeViewMode,
} from '../types/types';

export const FILE_TREE_VIEW_MODE_STORAGE_KEY = 'file-tree-view-mode';

export const FILE_TREE_DEFAULT_VIEW_MODE: FileTreeViewMode = 'detailed';

export const FILE_TREE_VIEW_MODES: FileTreeViewMode[] = ['simple', 'compact', 'detailed'];

export const FILE_TREE_SORT_STORAGE_KEY = 'file-tree-sort';

export const FILE_TREE_SORT_FIELDS: FileTreeSortField[] = ['name', 'size', 'modified'];

// Newest files first is what people look for after an upload or an agent run.
export const FILE_TREE_DEFAULT_SORT: FileTreeSort = { field: 'modified', direction: 'desc' };

// Direction applied when switching to a new column: names read A→Z, sizes and dates largest/newest first.
export const FILE_TREE_SORT_INITIAL_DIRECTION: Record<FileTreeSortField, FileTreeSortDirection> = {
  name: 'asc',
  size: 'desc',
  modified: 'desc',
};

export const IMAGE_FILE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'ico',
  'bmp',
]);
