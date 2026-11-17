import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PlayerRef } from '@remotion/player';
import type { TimelineState } from '../../editor/types';
import { PREVIEW_SHARED_AUDIO_TAGS, previewAudioTagCount } from '../previewAudioPool';

export function usePreviewAudioPool({ state, mobile, playerRef, durationInFrames, suspended = false }: {
  state: TimelineState;
  mobile: boolean;
  playerRef: RefObject<PlayerRef | null>;
  durationInFrames: number;
  suspended?: boolean;
}) {
  const required = mobile && !state.items.some((item) => item.kind === 'sequence')
    ? previewAudioTagCount(state) : PREVIEW_SHARED_AUDIO_TAGS;
  const [audioTags, setAudioTags] = useState(required);
  const [initialFrame, setInitialFrame] = useState(0);
  const [wasSuspended, setWasSuspended] = useState(suspended);
  const resume = useRef(false);
  // Reconcile during this component's render: an effect runs too late, after
  // children have already attempted to register audio in the old, smaller pool.
  if (required !== audioTags || suspended !== wasSuspended) {
    const player = playerRef.current;
    const frame = player?.getCurrentFrame() ?? initialFrame;
    setInitialFrame(Math.min(Math.max(0, durationInFrames - 1), Math.max(0, frame)));
    resume.current = !suspended && (player?.isPlaying() ?? false);
    setAudioTags(required);
    setWasSuspended(suspended);
  }
  useEffect(() => {
    if (!resume.current) return;
    resume.current = false;
    playerRef.current?.play();
  }, [audioTags, playerRef]);
  return { audioTags, initialFrame, playerKey: `${audioTags}:${suspended}` };
}
