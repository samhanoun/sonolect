import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";

import type { TranscriptTurn } from "./domain";
import type { Strings } from "./i18n";
import type { CleanedRun } from "./refine";
import {
  EXPORT_FILE_TYPES,
  exportFileName,
  noteFileName,
  type ExportFormat,
} from "./library";
import {
  SUBTITLE_FILE_TYPES,
  subtitleCues,
  toSrt,
  toVtt,
  type SubtitleFormat,
} from "./subtitles";
import { downloadInBrowser, isShareDismissal, showFailure } from "./ui/actions";

interface ShareableFile {
  content: string;
  name: string;
  mimeType: string;
  uti: string;
}

/**
 * Exports notes as a Markdown, text or JSON file (data-14). The whole library as one share
 * message can exceed Android's ~1 MB Binder limit and fail without a word,
 * so phones share a file from the cache instead. The cache sweep
 * (recordings.ts) deletes old exports. A browser downloads the file:
 * most desktop browsers have no share sheet, and where one exists it would
 * send the notes as a message, not as a file. Any
 * failure shows an alert; dismissing the share sheet is not a failure.
 */
export function exportNotes(
  content: string,
  t: Strings,
  format: ExportFormat = "markdown",
): Promise<boolean> {
  return shareFile(
    {
      content,
      name: exportFileName(new Date(), format),
      ...EXPORT_FILE_TYPES[format],
    },
    t.library.exportTitle,
    t.library.exportFailed,
  );
}

/**
 * Saves one dictated note as subtitles (SRT or WebVTT), named after the
 * note's date and time. `clean` is the note's clean-up over its segments
 * (cleanParts), so the subtitles read like the note. WebVTT says so when
 * the phone, not the recognizer, timed the words.
 */
export function exportSubtitles(
  turn: Pick<TranscriptTurn, "createdAt" | "segments">,
  format: SubtitleFormat,
  t: Strings,
  clean: (texts: readonly string[]) => readonly CleanedRun[],
): Promise<boolean> {
  const cues = subtitleCues(turn.segments ?? [], clean);
  const approx = turn.segments?.some((segment) => segment.approx) ?? false;
  const content =
    format === "srt"
      ? toSrt(cues)
      : toVtt(cues, approx ? t.library.subtitlesApprox : undefined);
  const date = new Date(turn.createdAt);
  const type = SUBTITLE_FILE_TYPES[format];
  return shareFile(
    {
      content,
      name: noteFileName(
        Number.isNaN(date.getTime()) ? new Date() : date,
        type.extension,
      ),
      mimeType: type.mimeType,
      uti: type.uti,
    },
    t.library.subtitlesTitle,
    t.library.subtitlesFailed,
  );
}

async function shareFile(
  file: ShareableFile,
  dialogTitle: string,
  failure: string,
): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      downloadInBrowser(file.content, file.name, file.mimeType);
      return true;
    }
    const cached = new File(Paths.cache, file.name);
    cached.create({ overwrite: true });
    await cached.write(file.content);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(cached.uri, {
        mimeType: file.mimeType,
        UTI: file.uti,
        dialogTitle,
      });
      return true;
    }
    await Share.share({ message: file.content });
    return true;
  } catch (error) {
    if (!isShareDismissal(error)) showFailure(failure);
    return false;
  }
}
