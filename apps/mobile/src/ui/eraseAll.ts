import type { Strings } from "../i18n";
import { choose, confirm } from "./confirm";

/**
 * The question before Erase all (Settings and the recovery screen). With
 * sync on, the user picks this phone only, or this phone and the server
 * copy (the other devices then stop syncing). Resolves null for Cancel.
 */
export function askEraseAll(
  t: Strings,
  syncOn: boolean,
): Promise<"here" | "everywhere" | null> {
  if (syncOn)
    return choose({
      title: t.settings.eraseTitle,
      message: t.sync.eraseMessage,
      choices: [
        { value: "here", label: t.sync.eraseThisPhone, destructive: true },
        {
          value: "everywhere",
          label: t.sync.eraseDeleteServerCopy,
          destructive: true,
        },
      ],
      cancelLabel: t.common.cancel,
    });
  return confirm({
    title: t.settings.eraseTitle,
    message: t.settings.eraseMessage,
    confirmLabel: t.settings.eraseButton,
    cancelLabel: t.common.cancel,
    destructive: true,
  }).then((confirmed) => (confirmed ? "here" : null));
}
