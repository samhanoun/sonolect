/**
 * Which saved notes have no recording on this device: notes that came
 * through sync (audio does not sync) and recordings whose audio is gone.
 * They can be read and edited, not played or transcribed again.
 */
import { create } from "zustand";

export const useAudiolessCaptures = create<{ ids: ReadonlySet<string> }>(
  () => ({ ids: new Set<string>() }),
);

/** Remembers the library's notes without audio (`hasAudio: false`). */
export function rememberAudioless(
  captures: readonly { id: string; hasAudio?: boolean }[],
) {
  const ids = new Set(
    captures
      .filter((capture) => capture.hasAudio === false)
      .map((capture) => capture.id),
  );
  const current = useAudiolessCaptures.getState().ids;
  if (ids.size === current.size && [...ids].every((id) => current.has(id)))
    return;
  useAudiolessCaptures.setState({ ids });
}

/** True when the note's audio can be played here. */
export function hasPlayableAudio(
  captureId: string | undefined,
  audioless: ReadonlySet<string>,
): captureId is string {
  return captureId !== undefined && !audioless.has(captureId);
}
