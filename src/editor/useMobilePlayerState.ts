import { useEffect, useState, type RefObject } from 'react';
import type { PlayerRef } from '@remotion/player';

export function useMobilePlayerState(playerRef: RefObject<PlayerRef | null>): { frame: number; playing: boolean } {
  const [snapshot, setSnapshot] = useState(() => ({
    frame: playerRef.current?.getCurrentFrame() ?? 0,
    playing: playerRef.current?.isPlaying() ?? false,
  }));

  useEffect(() => {
    const apply = () => {
      const player = playerRef.current;
      if (!player) return;
      setSnapshot((current) => {
        const frame = player.getCurrentFrame();
        const playing = player.isPlaying();
        return current.frame === frame && current.playing === playing ? current : { frame, playing };
      });
    };
    apply();
    const interval = window.setInterval(apply, 80);
    return () => window.clearInterval(interval);
  }, [playerRef]);

  return snapshot;
}
