import { useEffect, useState } from 'react';
import type { InspectorPanelProps } from './InspectorTypes';
import type { TimelineItem } from '../../editor/types';
import { getItemMgBounds, layoutWarnings, mgLayoutKey, mgLayoutEnabled, normalizeLayout, scaleAt, type Layout } from '../../editor/mgLayoutGeometry';
import { layoutBase } from '../../editor/mgLayoutActions';
import { layoutDefault, loadLayoutDefaults, writeLayoutDefault } from '../../xmt/mgLayoutDefaults';

export function MgLayoutControls({ item, panel }: { item: TimelineItem; panel: InspectorPanelProps }) {
  const key = mgLayoutKey(item);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [, refreshBounds] = useState(0);
  useEffect(() => { const refresh = () => refreshBounds(n => n + 1); window.addEventListener('xmt-mg-bounds', refresh);
    return () => window.removeEventListener('xmt-mg-bounds', refresh); }, []);
  useEffect(() => { setMessage(''); void loadLayoutDefaults().catch(e => setMessage(e.message)); }, [item.id]);
  if (!mgLayoutEnabled(item) || !panel.onItemLayoutChange || panel.selectedItems.length !== 1) return null;
  const base = layoutBase(item);
  const value = normalizeLayout({ x: item.transform?.x ?? 0, y: item.transform?.y ?? 0, scale: item.transform?.scaleX ?? item.transform?.scale ?? 1 });
  const width = panel.layoutWidth ?? 1920, height = panel.layoutHeight ?? 1080;
  const bounds = getItemMgBounds(item, width, height);
  const aspect = height > width ? 'portrait' : 'landscape';
  const apply = (next: Layout) => { panel.playerRef.current?.pause(); panel.onItemLayoutChange!({ ...normalizeLayout(next), scaleX: undefined, scaleY: undefined }); setMessage(''); };
  const fromDefault = (layout: Layout) => ({ x: (base.x ?? 0) * layout.scale + layout.x, y: (base.y ?? 0) * layout.scale + layout.y, scale: (base.scale ?? 1) * layout.scale });
  const save = async (remove: boolean) => {
    if (!key) return;
    setBusy(true);
    try { await writeLayoutDefault(key, aspect, remove ? null : { x: value.x - (base.x ?? 0)*value.scale/(base.scale ?? 1), y: value.y - (base.y ?? 0)*value.scale/(base.scale ?? 1), scale: value.scale / (base.scale ?? 1) });
      setMessage(remove ? '个人默认已移除，当前工程保留' : '个人默认已保存，仅影响以后创建的内容');
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <div className="cc-insp-section" aria-label="模板整体布局" style={{ display: 'grid', gap: 8 }}>
    <strong>模板整体布局</strong>
    {(['x','y'] as const).map(axis => <label key={axis}>{axis === 'x' ? '水平' : '垂直'}位置 (%) <input type="number" min={-400} max={400} step={.1}
      aria-label={axis === 'x' ? '模板水平位置' : '模板垂直位置'} value={Number(value[axis].toFixed(2))}
      onChange={e => apply({ ...value, [axis]: Number(e.target.value) })} /></label>)}
    <label>等比缩放 {Math.round(value.scale * 100)}% <input type="range" min={10} max={800} step={1} value={value.scale * 100}
      aria-label="模板等比缩放" onPointerDown={() => panel.historyGesture.begin()} onPointerUp={() => panel.historyGesture.end()} onPointerCancel={() => panel.historyGesture.end()}
      onChange={e => apply(scaleAt(value, Number(e.target.value)/100, { x: bounds.x + bounds.w/2, y: bounds.y + bounds.h/2 }))} /></label>
    <button type="button" onClick={() => apply(fromDefault({ x: 0, y: 0, scale: 1 }))}>恢复系统布局</button>
    {key && <>
      <button type="button" onClick={() => { setBusy(true); void loadLayoutDefaults().then(() => apply(fromDefault(layoutDefault(key, width, height) ?? { x: 0, y: 0, scale: 1 }))).catch(e => setMessage(e.message)).finally(() => setBusy(false)); }} disabled={busy}>应用我的默认</button>
      <button type="button" disabled={busy} onClick={() => void save(false)}>保存为个人默认</button>
      <button type="button" disabled={busy} onClick={() => void save(true)}>移除个人默认</button>
    </>}
    {!key && panel.onEditLayoutComponents && <button type="button" onClick={panel.onEditLayoutComponents}>调整内部组件与个人默认</button>}
    <small role="status">{[message, ...layoutWarnings(bounds, value, aspect === 'portrait' ? 166/1920 : 141/1080)].filter(Boolean).join(' · ')}</small>
  </div>;
}
