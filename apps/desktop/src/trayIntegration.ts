type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

export type TrayMenuItem =
  | { kind: "action"; id: string; label: string; enabled: boolean }
  | { kind: "separator" };

export type TrayMenuAction = {
  id: string;
  label: string;
  handler: () => void;
};

export function isTrayAvailable(
  win: Pick<
    TauriWindow,
    "__TAURI_INTERNALS__"
  > = globalThis.window as TauriWindow,
): boolean {
  try {
    return Boolean(win?.__TAURI_INTERNALS__);
  } catch {
    return false;
  }
}

export function buildTrayMenu(options?: {
  isRecording?: boolean;
}): TrayMenuItem[] {
  const recording = options?.isRecording ?? false;
  return [
    {
      kind: "action",
      id: "start-dictation",
      label: "Start Dictation",
      enabled: !recording,
    },
    {
      kind: "action",
      id: "stop-dictation",
      label: "Stop Dictation",
      enabled: recording,
    },
    { kind: "separator" },
    {
      kind: "action",
      id: "show-window",
      label: "Show Window",
      enabled: true,
    },
    { kind: "separator" },
    {
      kind: "action",
      id: "quit",
      label: "Quit",
      enabled: true,
    },
  ];
}

export function trayMenuAction(
  itemId: string,
  callbacks: Partial<
    Record<
      "start-dictation" | "stop-dictation" | "show-window" | "quit",
      () => void
    >
  >,
): boolean {
  const handler = callbacks[itemId as keyof typeof callbacks];
  if (handler) {
    handler();
    return true;
  }
  return false;
}
