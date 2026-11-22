/**
 * Speaker detection in the desktop app. The speaker model and the
 * detection run on this device; the only network request is the model
 * download, and only when the user asks for it.
 */
import { nativeProviderCall } from "./providerSettings";
import type { SpeakerTurn } from "./segmentEditor";

export type SpeakerModelStatus = {
  /** The model is on this device. Its checksum is verified when it loads. */
  ready: boolean;
  /** What the download weighs. */
  sizeBytes: number;
};

/** The speaker counts a user can choose; otherwise they are counted. */
export const SPEAKER_COUNTS = [2, 3, 4, 5, 6, 7, 8] as const;

export const SPEAKER_PROGRESS_EVENT = "speaker-progress";
export const SPEAKER_MODEL_PROGRESS_EVENT = "speaker-model-progress";

/** Runs `run` while `onProgress` hears the percentages of `event`. */
async function withProgress<T>(
  event: string,
  onProgress: ((percent: number) => void) | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (!onProgress) return run();
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<number>(event, (message) =>
    onProgress(message.payload),
  );
  try {
    return await run();
  } finally {
    unlisten();
  }
}

export function speakerModelStatus() {
  return nativeProviderCall<SpeakerModelStatus>("speaker_model_status");
}

export function downloadSpeakerModel(onProgress?: (percent: number) => void) {
  return withProgress(SPEAKER_MODEL_PROGRESS_EVENT, onProgress, () =>
    nativeProviderCall<SpeakerModelStatus>("download_speaker_model"),
  );
}

/** Who speaks when in saved recording `id`; `speakers` is 2 to 8, if known. */
export function detectSpeakerTurns(
  id: string,
  speakers?: number,
  onProgress?: (percent: number) => void,
) {
  return withProgress(SPEAKER_PROGRESS_EVENT, onProgress, () =>
    nativeProviderCall<SpeakerTurn[]>("detect_speakers", {
      id,
      speakers: speakers ?? null,
    }),
  );
}

/** Stops the detection that is running, before its next window of audio. */
export function cancelSpeakerDetection() {
  return nativeProviderCall<null>("cancel_speaker_detection");
}
