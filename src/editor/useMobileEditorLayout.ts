import { useSyncExternalStore } from 'react';

export const MOBILE_EDITOR_QUERY = '(max-width: 700px), (max-height: 500px) and (pointer: coarse)';

export function subscribeMobileEditorLayout(callback: () => void): () => void {
  const query = window.matchMedia(MOBILE_EDITOR_QUERY) as MediaQueryList & {
    addListener?: (listener: () => void) => void;
    removeListener?: (listener: () => void) => void;
  };
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', callback);
    return () => query.removeEventListener('change', callback);
  }
  query.addListener?.(callback);
  return () => query.removeListener?.(callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(MOBILE_EDITOR_QUERY).matches;
}

export function useMobileEditorLayout(): boolean {
  return useSyncExternalStore(subscribeMobileEditorLayout, getSnapshot, () => false);
}
