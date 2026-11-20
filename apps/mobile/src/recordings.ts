import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import { isSweepableCacheFile } from "./cacheFiles";

/**
 * Deletes the recordings, recorder temp files and note exports in the app
 * cache (speech-7, security-3, data-15). One file that can't be deleted
 * stays for the next sweep and never stops the others. Returns how many
 * files were deleted. Synchronous: expo-file-system 58 lists and deletes
 * without a promise.
 */
export function sweepCacheFiles(): number {
  if (Platform.OS === "web") return 0;
  let entries: (Directory | File)[];
  try {
    entries = new Directory(Paths.cache).list();
  } catch {
    return 0;
  }
  let deleted = 0;
  for (const entry of entries) {
    if (!(entry instanceof File) || !isSweepableCacheFile(entry.name)) {
      continue;
    }
    try {
      entry.delete();
      deleted += 1;
    } catch {
      // Gone already or in use: the next sweep tries again.
    }
  }
  return deleted;
}

/** Deletes the recordings a dictation made, once their audio was read. */
export function deleteRecordings(uris: readonly string[]): void {
  if (Platform.OS === "web") return;
  for (const uri of uris) {
    try {
      new File(uri).delete();
    } catch {
      // Gone already: the cache sweep covers anything left.
    }
  }
}
