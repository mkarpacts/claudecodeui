import {
  FILE_TREE_DEFAULT_VIEW_MODE,
  FILE_TREE_VIEW_MODES,
  FILE_TREE_VIEW_MODE_STORAGE_KEY,
} from '../constants/constants';
import type { FileTreeViewMode } from '../types/types';
import { usePersistedState } from './usePersistedState';

type UseFileTreeViewModeResult = {
  viewMode: FileTreeViewMode;
  changeViewMode: (mode: FileTreeViewMode) => void;
};

const parseViewMode = (raw: string): FileTreeViewMode | null =>
  FILE_TREE_VIEW_MODES.includes(raw as FileTreeViewMode) ? (raw as FileTreeViewMode) : null;

export function useFileTreeViewMode(): UseFileTreeViewModeResult {
  const [viewMode, changeViewMode] = usePersistedState(
    FILE_TREE_VIEW_MODE_STORAGE_KEY,
    FILE_TREE_DEFAULT_VIEW_MODE,
    parseViewMode,
  );

  return {
    viewMode,
    changeViewMode,
  };
}
