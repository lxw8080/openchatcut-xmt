// xmt「项目素材库」对话框：分页列出本项目的库素材，选中即把同源 stream URL
// 登记为媒体池资产 —— 不拷贝文件、不自动插入时间线；已在池中的素材回传
// already_imported 防重复添加。
import { useEffect, useState } from 'react';
import { theme, themeAlpha } from '../theme';
import type { MediaAsset } from '../editor/types';
import { useT } from '../i18n/locale';
import { fetchXmtLibraryAssets, type XmtLibraryAsset } from './projectBridge';

interface LibraryImportDialogProps {
  fps: number;
  onAddAsset: (asset: MediaAsset) => void;
  onClose: () => void;
}

const PER_PAGE = 24;

export function LibraryImportDialog({ fps, onAddAsset, onClose }: LibraryImportDialogProps) {
  const t = useT();
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<XmtLibraryAsset[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchXmtLibraryAssets({ page, perPage: PER_PAGE, query: search || undefined })
      .then((data) => {
        if (!alive) return;
        setItems(data.items);
        setPages(Math.max(1, data.pages));
        setError(null);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [page, search]);

  const importAsset = (row: XmtLibraryAsset): void => {
    onAddAsset({
      id: `xmt-asset-${row.id}`,
      name: row.title || `素材 ${row.id}`,
      kind: 'video',
      src: row.stream_url,
      durationInFrames: Math.max(1, Math.round((row.duration_ms ?? 0) / 1000 * fps)),
      width: row.width ?? undefined,
      height: row.height ?? undefined,
    });
    setImportedIds((previous) => new Set(previous).add(row.id));
  };

  const row = (item: XmtLibraryAsset) => {
    const imported = item.already_imported || importedIds.has(item.id);
    return (
      <div key={item.id} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
        borderBottom: `0.5px solid ${theme.border}`,
      }}>
        {item.thumb_url && (
          <img src={item.thumb_url} alt="" loading="lazy" style={{
            width: 52, height: 30, objectFit: 'cover', borderRadius: 3,
            border: `0.5px solid ${theme.border}`, flexShrink: 0, background: theme.bg,
          }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}>
            {item.title}
          </div>
          <div style={{ fontSize: 11, color: theme.textDim, marginTop: 1 }}>
            {typeof item.duration_ms === 'number' && item.duration_ms > 0
              ? `${(item.duration_ms / 1000).toFixed(1)}${t('秒')}`
              : ''}
            {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
          </div>
        </div>
        {imported ? (
          <span style={{ flexShrink: 0, fontSize: 11.5, color: theme.textDim }}>{t('已在媒体池')}</span>
        ) : (
          <button type="button" onClick={() => importAsset(item)} style={{
            flexShrink: 0, border: `0.5px solid ${theme.accent}`, background: theme.accent,
            color: theme.onAccent, borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
          }}>{t('导入媒体池')}</button>
        )}
      </div>
    );
  };

  return (
    <div
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.45)',
        display: 'grid', placeItems: 'center',
      }}
    >
      <div style={{
        width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        background: theme.panel, border: `0.5px solid ${theme.borderLight}`, borderRadius: 6,
        boxShadow: `0 12px 36px ${themeAlpha.shadow(0.55)}`, overflow: 'hidden',
      }}>
        <div style={{ padding: '10px 12px', borderBottom: `0.5px solid ${theme.border}`, fontWeight: 600, fontSize: 13 }}>
          {t('项目素材库')}
        </div>
        <div style={{ padding: '8px 12px', display: 'flex', gap: 8 }}>
          <input
            value={query}
            placeholder={t('搜索标题、项目或文件名')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { setPage(1); setSearch(query.trim()); } }}
            style={{
              flex: 1, background: theme.bg, border: `0.5px solid ${theme.border}`,
              borderRadius: 4, padding: '6px 8px', color: theme.text, fontSize: 12,
            }}
          />
          <button type="button" onClick={() => { setPage(1); setSearch(query.trim()); }} style={{
            border: `0.5px solid ${theme.border}`, background: 'none', color: theme.text,
            borderRadius: 4, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
          }}>{t('搜索')}</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 140 }}>
          {loading && <div style={{ padding: 16, fontSize: 12, color: theme.textDim, textAlign: 'center' }}>{t('搜索中…')}</div>}
          {!loading && error && <div style={{ padding: 16, fontSize: 12, color: theme.accent, textAlign: 'center' }}>{error}</div>}
          {!loading && !error && items && items.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: theme.textDim, textAlign: 'center' }}>{t('没有符合条件的视频素材')}</div>
          )}
          {!loading && !error && items?.map(row)}
        </div>
        <div style={{ padding: '8px 12px', borderTop: `0.5px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} style={{
            border: `0.5px solid ${theme.border}`, background: 'none', color: theme.text,
            borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: page <= 1 ? 'default' : 'pointer',
          }}>{t('上一页')}</button>
          <span style={{ fontSize: 11.5, color: theme.textDim, flex: 1, textAlign: 'center' }}>{page} / {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))} style={{
            border: `0.5px solid ${theme.border}`, background: 'none', color: theme.text,
            borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: page >= pages ? 'default' : 'pointer',
          }}>{t('下一页')}</button>
          <button type="button" onClick={onClose} style={{
            border: `0.5px solid ${theme.border}`, background: 'none', color: theme.text,
            borderRadius: 4, padding: '4px 14px', fontSize: 12, cursor: 'pointer',
          }}>{t('取消')}</button>
        </div>
      </div>
    </div>
  );
}
