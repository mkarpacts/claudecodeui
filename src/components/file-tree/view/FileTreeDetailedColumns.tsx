import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import { FILE_TREE_SORT_FIELDS } from '../constants/constants';
import type { FileTreeSort, FileTreeSortField } from '../types/types';

type FileTreeDetailedColumnsProps = {
  sort: FileTreeSort;
  onSortChange: (field: FileTreeSortField) => void;
};

const COLUMN_SPAN: Record<FileTreeSortField, string> = {
  name: 'col-span-5',
  size: 'col-span-2',
  modified: 'col-span-3',
};

export default function FileTreeDetailedColumns({ sort, onSortChange }: FileTreeDetailedColumnsProps) {
  const { t } = useTranslation();
  const SortIcon = sort.direction === 'asc' ? ArrowUp : ArrowDown;
  // The tree below is not an ARIA table, so the sort state is spoken through the button label instead of aria-sort.
  const sortStateLabel = t(sort.direction === 'asc' ? 'fileTree.sortedAscending' : 'fileTree.sortedDescending');

  return (
    <div className="border-b border-border px-3 pb-1 pt-1.5">
      <div className="grid grid-cols-12 gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {FILE_TREE_SORT_FIELDS.map((field) => {
          const isActive = sort.field === field;
          return (
            <div key={field} className={COLUMN_SPAN[field]}>
              <button
                type="button"
                onClick={() => onSortChange(field)}
                className={cn(
                  'inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground',
                  isActive && 'text-foreground',
                )}
              >
                {t(`fileTree.${field}`)}
                {isActive && (
                  <>
                    <SortIcon className="h-3 w-3" aria-hidden="true" />
                    <span className="sr-only">, {sortStateLabel}</span>
                  </>
                )}
              </button>
            </div>
          );
        })}
        <div className="col-span-2">{t('fileTree.permissions')}</div>
      </div>
    </div>
  );
}
