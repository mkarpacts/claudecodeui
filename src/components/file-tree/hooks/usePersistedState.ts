import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

// localStorage-backed state for file tree preferences; a missing, unreadable or invalid value falls back to the default.
export function usePersistedState<T>(
  storageKey: string,
  defaultValue: T,
  parse: (raw: string) => T | null,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw !== null ? parse(raw) : null;
      return parsed !== null ? parsed : defaultValue;
    } catch {
      // Keep default value when storage is unavailable or holds garbage.
      return defaultValue;
    }
  });
  // Only explicit changes are saved, so an untouched preference keeps following the code default.
  const hasChangedRef = useRef(false);

  useEffect(() => {
    if (!hasChangedRef.current) {
      return;
    }

    try {
      // Strings are stored raw so values saved before this hook existed stay readable.
      localStorage.setItem(storageKey, typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      // Keep runtime state even when persistence fails.
    }
  }, [storageKey, value]);

  const changeValue = useCallback<Dispatch<SetStateAction<T>>>((nextValue) => {
    hasChangedRef.current = true;
    setValue(nextValue);
  }, []);

  return [value, changeValue];
}
