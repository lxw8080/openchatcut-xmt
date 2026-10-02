import { useEffect, useRef, useState } from 'react';
import type { TimelineState } from '../editor/types';
import { theme } from '../theme';
import { compositionSnapshot, reviewComposition, type CompositionReport } from './compositionReviewClient';

/** Derived checks are deliberately separate from human comments and resolutions. */
export function CompositionReview({ timelineId, state, onSeek }: {
  timelineId: string; state: TimelineState; onSeek: (frame: number) => void;
}) {
  const snapshot = compositionSnapshot(timelineId, state);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const request = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{ snapshot: string; report: CompositionReport } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => request.current?.abort(), []);
  const stale = result !== null && result.snapshot !== snapshot;
  const run = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const report = await reviewComposition(snapshot, controller.signal);
      if (controller.signal.aborted) return;
      if (latest.current !== snapshot) {
        setError('检查期间工程已变化，请重新检查。');
        return;
      }
      setResult({ snapshot, report });
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '成片检查失败。');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return <section style={{ padding: 12, borderBottom: `1px solid ${theme.border}`, fontSize: 12 }}>
    <button type="button" disabled={busy} onClick={() => { void run(); }}>
      {busy ? '检查中…' : '检查当前成片'}
    </button>
    <p style={{ color: theme.textDim }}>检查当前时间线的图卡、旁白和素材证据，包含尚未保存的修改。</p>
    {stale && <p role="status">工程已变化，请重新检查。</p>}
    {error && <p role="alert">{error}</p>}
    {result && !stale && <>
      <p>{result.report.findings.length ? `${result.report.findings.length} 项需要核对` : '本次检查未发现可定位的问题'}</p>
      <p style={{ color: theme.textDim }}>尚未核验原片画面、最终混音和新闻事实。{!result.report.coverage.speech && ' 当前缺少字幕时间证据。'}</p>
      <div style={{ maxHeight: 230, overflowY: 'auto' }}>
        {result.report.findings.map((finding, index) => <button key={`${finding.code}-${index}`}
          type="button" onClick={() => onSeek(finding.frame)}
          style={{ display: 'block', textAlign: 'left', width: '100%', marginBottom: 6, padding: 7,
            color: theme.text, background: theme.panelAlt, border: `1px solid ${theme.border}`, borderRadius: 4 }}>
          {(finding.frame / state.fps).toFixed(1)}s · {finding.message}
          {finding.state === 'unknown' && '（证据不足）'}
          {Array.isArray(finding.evidence?.observed) && <span style={{ display: 'block', color: theme.textDim }}>
            所指：{finding.evidence.claimed ?? finding.evidence.mentioned?.join('、')}；
            画面标注：{finding.evidence.observed.join('、') || '缺失'}
          </span>}
        </button>)}
      </div>
    </>}
  </section>;
}
