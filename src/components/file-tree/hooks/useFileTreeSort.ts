import { useCallback } from 'react';
import {
  FILE_TREE_DEFAULT_SORT,
  FILE_TREE_SORT_FIELDS,
  FILE_TREE_SORT_INITIAL_DIRECTION,
  FILE_TREE_SORT_STORAGE_KEY,
} from '../constants/constants';
import type { FileTreeSort, FileTreeSortField } from '../types/types';
import { usePersistedState } from './usePersistedState';

type UseFileTreeSortResult = {
  sort: FileTreeSort;
  toggleSort: (field: FileTreeSortField) => void;
};

const parseSort = (raw: string): FileTreeSort | null => {
  const { field, direction } = (JSON.parse(raw) ?? {}) as Partial<FileTreeSort>;
  return FILE_TREE_SORT_FIELDS.includes(field as FileTreeSortField) && (direction === 'asc' || direction === 'desc')
    ? { field: field as FileTreeSortField, direction }
    : null;
};

export function useFileTreeSort(): UseFileTreeSortResult {
  const [sort, setSort] = usePersistedState(FILE_TREE_SORT_STORAGE_KEY, FILE_TREE_DEFAULT_SORT, parseSort);

  // Clicking the active column flips its direction; clicking another column starts from its natural direction.
  const toggleSort = useCallback(
    (field: FileTreeSortField) => {
      setSort((current) =>
        current.field === field
          ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' }
          : { field, direction: FILE_TREE_SORT_INITIAL_DIRECTION[field] },
      );
    },
    [setSort],
  );

  return {
    sort,
    toggleSort,
  };
}
