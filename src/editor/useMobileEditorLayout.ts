import { useSyncExternalStore } from 'react';

export const MOBILE_EDITOR_QUERY = '(max-width: 700px), (max-height: 500px) and (pointer: coarse)';

function subscribe(callback: () => void): () => void {
  const query = window.matchMedia(MOBILE_EDITOR_QUERY);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(MOBILE_EDITOR_QUERY).matches;
}

export function useMobileEditorLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
