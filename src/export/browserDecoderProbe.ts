import { withExportProbeDeadline } from './browserExportProbe';

/** Verify the failed source seek before permitting a whole-movie retry. The
 * caller owns/disposes the input; this helper owns every returned sample. */
export async function verifyExportVideoSeek(
  sink: { getSample: (seconds: number) => Promise<{ close: () => void } | null> },
  seconds: number,
  signal?: AbortSignal,
  timeoutMs = 8_000,
): Promise<void> {
  await withExportProbeDeadline(async () => {
    const sample = await sink.getSample(seconds);
    try {
      signal?.throwIfAborted();
      if (!sample) throw new Error(`源视频 ${seconds.toFixed(3)} 秒未能解出画面`);
    } finally { sample?.close(); }
  }, { signal, timeoutMs, code: 'browser_decode_seek_timeout',
    message: `源视频 ${seconds.toFixed(3)} 秒实解验证超时` });
}
