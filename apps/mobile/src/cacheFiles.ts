/**
 * The files Sonolect leaves in the app cache that hold the user's voice or
 * notes (speech-7, security-3, data-15). Pure, so it is tested without a
 * device; recordings.ts deletes them.
 * - recording_<id>.wav: a dictation recording expo-speech-recognition
 *   58.0.1 persists (Android recording_<ms>.wav, iOS recording_<UUID>.wav);
 *   .caf is matched too.
 * - temp_<UUID>.pcm: the file ExpoAudioRecorder creates for each continuous
 *   session on Android 13+ and never deletes when no recording is persisted.
 * - sonolect-notes-<date>.md: notes exported for sharing.
 */
export const SWEEPABLE_CACHE_FILE =
  /^(recording_.*\.(wav|caf)|temp_.*\.pcm|sonolect-notes-.*\.md)$/;

export function isSweepableCacheFile(name: string): boolean {
  return SWEEPABLE_CACHE_FILE.test(name);
}
