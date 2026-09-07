import { useCallback, useSyncExternalStore } from 'react';
import { sound } from './index.ts';
import type { PackId, SoundEvent } from './index.ts';

export function useSoundSettings() {
  const state = useSyncExternalStore(
    sound.subscribe,
    () => sound.state,
    () => sound.state,
  );

  const setEnabled = useCallback((next: boolean) => sound.setEnabled(next), []);
  const setVolume = useCallback((next: number) => sound.setVolume(next), []);
  const setPack = useCallback((id: PackId) => sound.setPack(id), []);
  const play = useCallback((event: SoundEvent) => sound.play(event), []);

  return {
    enabled: state.enabled,
    volume: state.volume,
    pack: state.pack,
    packs: sound.packs,
    setEnabled,
    setVolume,
    setPack,
    unlock: sound.unlock,
    play,
  };
}
