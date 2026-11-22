import { useSyncExternalStore } from "react";

import type { SyncController, SyncView } from "./controller";

const subscribeNone = () => () => undefined;
const viewNone = () => null;

/** The controller's view for a screen; null in builds without sync. */
export function useSyncView(
  controller: SyncController | null,
): SyncView | null {
  return useSyncExternalStore(
    controller ? (listener) => controller.subscribe(listener) : subscribeNone,
    controller ? () => controller.view() : viewNone,
  );
}
