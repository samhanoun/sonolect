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
 * Saves the file from a browser. Sharing is no use there: most desktop
 * browsers have no share sheet, and where one exists it would send the
 * notes as a message, not as a file.
 */
function downloadInBrowser(content: string, name: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The download has the data by then; the address is no longer needed.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exports notes as a Markdown, text or JSON file (data-14). The whole library as one share
 * message can exceed Android's ~1 MB Binder limit and fail without a word,
 * so phones share a file from the cache instead. The cache sweep
 * (recordings.ts) deletes old exports. A browser downloads the file. Any
 * failure shows an alert; dismissing the share sheet is not a failure.
 */
export async function exportNotes(
  content: string,
  t: Strings,
  format: ExportFormat = "markdown",
): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      downloadInBrowser(
        content,
        exportFileName(new Date(), format),
        EXPORT_FILE_TYPES[format].mimeType,
      );
      return true;
    }
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
    await Share.share({ message: content });
    return true;
  } catch (error) {
    if (!isShareDismissal(error)) showFailure(t.library.exportFailed);
    return false;
  }
}
