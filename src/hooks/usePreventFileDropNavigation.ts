import { useEffect } from 'react';

const FILE_DRAG_EVENTS = ['dragover', 'drop'] as const;

/**
 * Stops the browser from navigating to (opening or downloading) a file that is
 * dropped outside any drop zone. Real drop zones handle the event first
 * (bubbling phase), so this only acts as a last-resort guard on `window`.
 * Text drags are left untouched.
 */
export function usePreventFileDropNavigation(): void {
  useEffect(() => {
    const preventIfFiles = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
      }
    };

    FILE_DRAG_EVENTS.forEach((type) => window.addEventListener(type, preventIfFiles));
    return () => FILE_DRAG_EVENTS.forEach((type) => window.removeEventListener(type, preventIfFiles));
  }, []);
}
