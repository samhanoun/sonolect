import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";

import type { Strings } from "./i18n";
import { exportFileName } from "./library";
import { isShareDismissal, showFailure } from "./ui/actions";

/**
 * Exports notes as a Markdown file (data-14). The whole library as one share
 * message can exceed Android's ~1 MB Binder limit and fail without a word,
 * so phones share a file from the cache instead. The cache sweep
 * (recordings.ts) deletes old exports. Any failure shows an alert;
 * dismissing the share sheet is not a failure.
 */
export async function exportNotes(
  markdown: string,
  t: Strings,
): Promise<boolean> {
  try {
    if (Platform.OS !== "web") {
      const file = new File(Paths.cache, exportFileName(new Date()));
      file.create({ overwrite: true });
      await file.write(markdown);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "text/markdown",
          UTI: "net.daringfireball.markdown",
          dialogTitle: t.library.exportTitle,
        });
        return true;
      }
    }
    await Share.share({ message: markdown });
    return true;
  } catch (error) {
    if (!isShareDismissal(error)) showFailure(t.library.exportFailed);
    return false;
  }
}
