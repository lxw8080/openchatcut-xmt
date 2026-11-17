import { xmtHost } from '../xmt/host';

export type ExportDiagnosticStage = 'mobile-route' | 'flush-started' | 'flush-finished'
  | 'submit-started' | 'submit-accepted' | 'submit-failed' | 'poll-failed' | 'render-finished';

export async function reportExportDiagnostic(stage: ExportDiagnosticStage, {
  elapsedMs, code, status,
}: { elapsedMs?: number; code?: string; status?: number } = {}): Promise<void> {
  const host = xmtHost();
  if (!host) return;
  try {
    await fetch('/editor/api/export-diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': host.csrfToken },
      body: JSON.stringify({
        xmtJobId: host.jobId, stage,
        ...(elapsedMs !== undefined && Number.isFinite(elapsedMs) ? { elapsedMs: Math.max(0, Math.round(elapsedMs)) } : {}),
        ...(code ? { code: code.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80) } : {}),
        ...(status !== undefined ? { status } : {}),
      }),
      keepalive: true,
    });
  } catch {
    // Diagnostics never change export routing or retry an accepted operation.
  }
}
