import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Gauge, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../shared/view/ui';
import { useClaudeUsage } from '../hooks/useClaudeUsage';
import { UsageEmptyState, UsageError, UsageLastUpdated, UsageMeters, UsagePlanBadge } from './UsageParts';

const POPOVER_WIDTH = 320;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

type UsageIndicatorProps = {
  onOpenFullUsage: () => void;
};

/** Gauge button that opens a compact copy of Settings → Usage; nothing is fetched until it is opened. */
export default function UsageIndicator({ onOpenFullUsage }: UsageIndicatorProps) {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="sm"
        className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        title={t('usage.showUsage')}
        aria-label={t('usage.showUsage')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Gauge className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <UsagePopover
          anchorRef={buttonRef}
          onClose={close}
          onOpenFullUsage={() => {
            setOpen(false);
            onOpenFullUsage();
          }}
        />
      )}
    </>
  );
}

type UsagePopoverProps = {
  anchorRef: RefObject<HTMLButtonElement>;
  /** returnFocus is true for keyboard dismissal; an outside click keeps focus where the user clicked. */
  onClose: (returnFocus: boolean) => void;
  onOpenFullUsage: () => void;
};

/**
 * Rendered into document.body: the sidebar's backdrop-blur makes its own stacking context,
 * so a popover wider than the sidebar would otherwise slide under the main content.
 */
function UsagePopover({ anchorRef, onClose, onOpenFullUsage }: UsagePopoverProps) {
  const { t } = useTranslation('settings');
  const { data, loading, error, lastUpdated, refresh } = useClaudeUsage();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN;
      setPosition({
        top: rect.bottom + ANCHOR_GAP,
        left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchorRef]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose(false);
    };
    // Window capture runs before ChatInterface's document-capture Escape handler, and
    // preventDefault tells it the key is taken — otherwise closing the popover aborts a running session.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose(true);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [anchorRef, onClose]);

  // The popover lives at the end of document.body, so Tab from the gauge button would never reach it.
  useEffect(() => {
    if (position) popoverRef.current?.focus();
  }, [position]);

  if (!position) return null;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={t('usage.title')}
      tabIndex={-1}
      className="fixed z-50 space-y-3 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
      style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{t('usage.title')}</h3>
        {data && <UsagePlanBadge data={data} compact />}
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {(error || !data) && <UsageError message={error || t('usage.loadError')} compact />}
          {data && (
            <div className="space-y-2">
              <UsageMeters data={data} compact />
              <UsageEmptyState data={data} compact />
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
        <UsageLastUpdated lastUpdated={lastUpdated} loading={loading} onRefresh={refresh} />
        <button
          type="button"
          onClick={onOpenFullUsage}
          className="flex-shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          {t('usage.openFull')} →
        </button>
      </div>
    </div>,
    document.body,
  );
}
