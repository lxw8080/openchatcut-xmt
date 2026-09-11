// xmt fork 增加 1440p：预设是绝对短边目标，1080 与 2160 之间的一切都会被
// exportResolutionForCanvas 下捕到 1080p —— canvas_size 放大到 2560×1440 的
// 画布在导出时会被静默缩回 1920×1080，导出正好撤销了画布存在的意义。
export const EXPORT_RESOLUTIONS = { '480p': 480, '720p': 720, '1080p': 1080, '1440p': 1440, '4k': 2160 } as const;
export type ExportResolution = keyof typeof EXPORT_RESOLUTIONS;

export const EXPORT_FPS_OPTIONS = [24, 25, 30, 50, 60] as const;

interface ExportDimensions {
  width: number;
  height: number;
  scale: number;
}

interface SafeRenderPlan {
  width: number;
  height: number;
  browserScale: number;
  serverScale: number;
  distance: number;
}

const canvasDimension = (value: unknown, fallback: number): number => {
  const dimension = Number(value);
  return Number.isFinite(dimension) && dimension > 0 ? dimension : fallback;
};

function safeRenderPlan(width: number, height: number, targetScale: number): SafeRenderPlan {
  const baseWidth = Math.max(2, Math.ceil(width * targetScale));
  const baseHeight = Math.max(2, Math.ceil(height * targetScale));
  const nearestWidth = Math.max(2, Math.round(baseWidth / 2) * 2);
  const nearestHeight = Math.max(2, Math.round(baseHeight / 2) * 2);
  let best: SafeRenderPlan | null = null;
  for (let widthOffset = -32; widthOffset <= 32; widthOffset += 2) {
    const candidateWidth = nearestWidth + widthOffset;
    if (candidateWidth < 2) continue;
    for (let heightOffset = -32; heightOffset <= 32; heightOffset += 2) {
      const candidateHeight = nearestHeight + heightOffset;
      if (candidateHeight < 2) continue;
      const ceilLower = Math.max((candidateWidth - 1) / width, (candidateHeight - 1) / height);
      const ceilUpper = Math.min(candidateWidth / width, candidateHeight / height);
      const roundLower = Math.max((candidateWidth - 0.5) / width, (candidateHeight - 0.5) / height);
      const roundUpper = Math.min((candidateWidth + 0.5) / width, (candidateHeight + 0.5) / height);
      if (ceilLower >= ceilUpper || roundLower >= roundUpper) continue;
      const browserScale = targetScale > ceilLower && targetScale < ceilUpper
        ? targetScale : (ceilLower + ceilUpper) / 2;
      const serverScale = targetScale >= roundLower && targetScale < roundUpper
        ? targetScale : (roundLower + roundUpper) / 2;
      if (Math.ceil(width * browserScale) !== candidateWidth || Math.ceil(height * browserScale) !== candidateHeight) continue;
      if (Math.round(width * serverScale) !== candidateWidth || Math.round(height * serverScale) !== candidateHeight) continue;
      const distance = Math.abs(browserScale - targetScale) + Math.abs(serverScale - targetScale);
      if (!best || distance < best.distance) best = { width: candidateWidth, height: candidateHeight, browserScale, serverScale, distance };
    }
  }
  return best ?? { width: baseWidth, height: baseHeight, browserScale: targetScale, serverScale: targetScale, distance: 0 };
}

function renderPlan(
  state: { width?: unknown; height?: unknown },
  resolution?: ExportResolution,
): SafeRenderPlan {
  const width = canvasDimension(state.width, 1920);
  const height = canvasDimension(state.height, 1080);
  if (!resolution) return { width: Math.round(width), height: Math.round(height), browserScale: 1, serverScale: 1, distance: 0 };
  return safeRenderPlan(width, height, EXPORT_RESOLUTIONS[resolution] / Math.min(width, height));
}

/** Resolution preset -> codec-safe server render scale, based on the shorter canvas side. */
export function exportScale(
  state: { width?: unknown; height?: unknown },
  resolution?: ExportResolution,
): number {
  return renderPlan(state, resolution).serverScale;
}

export function scaledExportDimensions(
  state: { width?: unknown; height?: unknown },
  resolution?: ExportResolution,
): ExportDimensions {
  const plan = renderPlan(state, resolution);
  return { width: plan.width, height: plan.height, scale: plan.serverScale };
}

export function webScaledExportDimensions(
  state: { width?: unknown; height?: unknown },
  resolution?: ExportResolution,
): ExportDimensions {
  const plan = renderPlan(state, resolution);
  return { width: plan.width, height: plan.height, scale: plan.browserScale };
}
