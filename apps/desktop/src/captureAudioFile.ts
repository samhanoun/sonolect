/**
 * Saving a recording's audio as a file of its own: the file it is kept as on
 * this device (the 48 kHz Opus file of a high-quality recording, a
 * compressed one, or its WAV), named after when it was made. The audio is
 * read from the device and handed to the webview's download; nothing is sent
 * anywhere.
 */
import { audioMimeType } from "./capturePlayback";
import type { NativeCall } from "./privacyControls";

export type CaptureAudioFile = { blob: Blob; filename: string };

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * "sonolect-recording-2026-11-21-1430.opus": the local date and time the
 * recording was made, and the extension of what it is kept as.
 */
export function captureAudioFilename(createdAtMs: number, mimeType: string) {
  const made = new Date(createdAtMs);
  const stamp = `${made.getFullYear()}-${pad(made.getMonth() + 1)}-${pad(
    made.getDate(),
  )}-${pad(made.getHours())}${pad(made.getMinutes())}`;
  return `sonolect-recording-${stamp}.${mimeType === "audio/ogg" ? "opus" : "wav"}`;
}

/** Reads the file a saved recording is kept as. */
export async function readCaptureAudioFile(
  call: NativeCall,
  capture: { id: string; createdAtMs: number },
): Promise<CaptureAudioFile> {
  const bytes = await call<ArrayBuffer>("read_local_capture_audio", {
    id: capture.id,
    format: "file",
  });
  // The device keeps a recording as Ogg Opus or as WAV, nothing else.
  const type = audioMimeType(bytes) === "audio/ogg" ? "audio/ogg" : "audio/wav";
  return {
    blob: new Blob([bytes], { type }),
    filename: captureAudioFilename(capture.createdAtMs, type),
  };
}

/** Hands a file to the webview's download, as the transcript export does. */
export function downloadFile(
  file: CaptureAudioFile,
  page: Pick<Document, "createElement"> = document,
  urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL,
) {
  const url = urls.createObjectURL(file.blob);
  const link = page.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  setTimeout(() => urls.revokeObjectURL(url), 1000);
}
