import { useTranslation } from 'react-i18next';

type PaginationProps = {
  page: number;
  totalPages: number;
  perPage: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
};

export default function Pagination({ page, totalPages, perPage, onPageChange, onPerPageChange }: PaginationProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <select
          value={perPage}
          onChange={(e) => onPerPageChange(Number(e.target.value))}
          className="rounded border border-border bg-card py-1 pl-2 pr-7 text-sm text-foreground"
        >
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
        <span className="text-muted-foreground">{t('tokenUsage.perPage')}</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0}
          className="rounded px-2 py-1 text-muted-foreground hover:bg-accent disabled:opacity-40"
        >
          {t('tokenUsage.prev')}
        </button>
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
          const startPage = Math.max(0, Math.min(page - 2, totalPages - 5));
          const pageNum = startPage + i;
          if (pageNum >= totalPages) return null;
          return (
            <button
              key={pageNum}
              onClick={() => onPageChange(pageNum)}
              className={`rounded px-2.5 py-1 ${page === pageNum ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50'}`}
            >
              {pageNum + 1}
            </button>
          );
        })}
        <button
          onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          disabled={page >= totalPages - 1}
          className="rounded px-2 py-1 text-muted-foreground hover:bg-accent disabled:opacity-40"
        >
          {t('tokenUsage.next')}
        </button>
      </div>
    </div>
  );
}
