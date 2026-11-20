import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";

import type { Strings } from "./i18n";
import {
  EXPORT_FILE_TYPES,
  exportFileName,
  type ExportFormat,
} from "./library";
import { isShareDismissal, showFailure } from "./ui/actions";

/**
 * Exports notes as a Markdown, text or JSON file (data-14). The whole library as one share
 * message can exceed Android's ~1 MB Binder limit and fail without a word,
 * so phones share a file from the cache instead. The cache sweep
 * (recordings.ts) deletes old exports. Any failure shows an alert;
 * dismissing the share sheet is not a failure.
 */
export async function exportNotes(
  content: string,
  t: Strings,
  format: ExportFormat = "markdown",
): Promise<boolean> {
  try {
    if (Platform.OS !== "web") {
      const file = new File(Paths.cache, exportFileName(new Date(), format));
      file.create({ overwrite: true });
      await file.write(content);
      if (await Sharing.isAvailableAsync()) {
        const type = EXPORT_FILE_TYPES[format];
        await Sharing.shareAsync(file.uri, {
          mimeType: type.mimeType,
          UTI: type.uti,
          dialogTitle: t.library.exportTitle,
        });
        return true;
      }
    }
    await Share.share({ message: content });
    return true;
  } catch (error) {
    if (!isShareDismissal(error)) showFailure(t.library.exportFailed);
    return false;
  }
}
