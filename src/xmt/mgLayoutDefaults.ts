import { xmtHost } from './host';
import { showAppToast } from '../ui/appToast';
import { registerTemplateBounds, type Layout } from '../editor/mgLayoutGeometry';
export async function loadLayoutOccupancy() {
  const response = await fetch('/video-edit/api/visual-assets/catalog',{credentials:'same-origin'});
  const body = await response.json();
  for (const entry of body.data?.overlays ?? []) for (const aspect of ['landscape','portrait']) {
    const box = entry.occupancy?.[aspect]?.box; if (box) registerTemplateBounds(entry.template_id,aspect,box);
  }
}
type State = { revision: number; layouts: Record<string, Partial<Record<'landscape' | 'portrait', Layout>>>; csrf_token?: string };
let current: State = { revision: 0, layouts: {} };
const endpoint = '/video-edit/api/visual-assets/layout-defaults';
export async function loadLayoutDefaults(): Promise<State> {
  const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.error || '个人默认读取失败');
  current = body.data;
  return current;
}
export function layoutDefault(key: string, width: number, height: number): Layout | undefined {
  return current.layouts[key]?.[height > width ? 'portrait' : 'landscape'];
}
export function insertWithCurrentLayout(key: string, insert: () => void) {
  if (typeof window === 'undefined' || !key.startsWith('xmt-') || !xmtHost()) { insert(); return; }
  void loadLayoutDefaults().then(insert).catch(error => showAppToast(error.message, {error:true}));
}
export async function writeLayoutDefault(key: string, aspect: string, transform: Layout | null) {
  const response = await fetch(endpoint, { method: transform ? 'PUT' : 'DELETE', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': current.csrf_token ?? xmtHost()?.csrfToken ?? '' },
    body: JSON.stringify({ template_key: key, aspect, revision: current.revision, ...(transform ? { transform } : {}) }) });
  const body = await response.json();
  if (!response.ok || !body.success) {
    if (response.status === 409) await loadLayoutDefaults();
    throw new Error(body.error || '个人默认保存失败');
  }
  current = body.data;
  return current;
}
