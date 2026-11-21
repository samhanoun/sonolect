/**
 * Note sync in the React app: one controller for the main window, started
 * once, fed the window's focus, the network coming back and the native
 * side's "a note changed here" event. The dictation bubble window never
 * syncs. In the browser preview there is no controller.
 */
import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";

import { isTauriRuntime } from "../desktopNative";
import { loadCaptureRetentionDays } from "../privacyControls";
import { appPlatform } from "./platform";
import { SyncController, type SyncView } from "./syncController";

/** The native event sent after a note changed on this device (see local_history.rs). */
export const LOCAL_CHANGE_EVENT = "sync-local-change";

/** True when this build has a sync server: set by vite.config.ts from SONOLECT_SYNC_URL. */
export const SYNC_IN_BUILD =
  typeof __SONOLECT_SYNC__ !== "undefined" && __SONOLECT_SYNC__;

/** Bumped whenever sync changed the notes here, so the library reloads. */
export const useSyncedNotes = create<{ version: number; bump: () => void }>(
  (set) => ({
    version: 0,
    bump: () => set((state) => ({ version: state.version + 1 })),
  }),
);

function preferenceStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

let controller: SyncController | undefined;

/** The main window's controller; undefined outside the installed app. */
export function getSyncController(): SyncController | undefined {
  if (!controller && isTauriRuntime())
    controller = new SyncController({
      platform: appPlatform(),
      retentionDays: () => loadCaptureRetentionDays(),
      onNotesChanged: () => useSyncedNotes.getState().bump(),
      storage: preferenceStorage(),
    });
  return controller;
}

const NO_SYNC: SyncView = {
  available: false,
  server: undefined,
  phase: "off",
  syncing: false,
  lastSyncAt: undefined,
  problem: undefined,
  notices: { quotaExceeded: false, tooLarge: false, newerSchema: false },
};
const noSubscription = () => () => undefined;
const noSync = () => NO_SYNC;

/** The sync state for the interface. */
export function useSyncView(): SyncView {
  const sync = getSyncController();
  return useSyncExternalStore(
    sync?.subscribe ?? noSubscription,
    sync?.getView ?? noSync,
  );
}

/** Mounted once, in the main window: starts sync when this build has it. */
export function useSyncLifecycle() {
  useEffect(() => {
    const sync = getSyncController();
    if (!sync) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void sync.start().then(() => {
      if (disposed || !sync.getView().available) return;
      const focus = () => sync.setFocused(true);
      const blur = () => sync.setFocused(false);
      const online = () => sync.online();
      window.addEventListener("focus", focus);
      window.addEventListener("blur", blur);
      window.addEventListener("online", online);
      sync.setFocused(document.hasFocus());
      let unlisten: (() => void) | undefined;
      void import("@tauri-apps/api/event")
        .then(({ listen }) =>
          listen(LOCAL_CHANGE_EVENT, () => sync.localChange()),
        )
        .then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        })
        .catch(() => undefined);
      cleanup = () => {
        window.removeEventListener("focus", focus);
        window.removeEventListener("blur", blur);
        window.removeEventListener("online", online);
        unlisten?.();
      };
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
}
