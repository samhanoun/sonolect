export const DEFAULT_TOGGLE_SHORTCUT = "CommandOrControl+Shift+M";
export const DEFAULT_PUSH_TO_TALK_SHORTCUT = "CommandOrControl+Shift+V";

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

export type NativeShortcutRegistration = {
  enabled: boolean;
  status: string;
  unregister: () => Promise<void>;
};

export type NativeInsertionResult = {
  ok: boolean;
  method: "native-insert" | "clipboard-fallback";
  status: string;
};

export type RegisterShortcutOptions = {
  toggleShortcut?: string;
  pushToTalkShortcut?: string;
  onToggle: () => void;
  onPushToTalkStart: () => void;
  onPushToTalkStop: () => void;
};

export function isTauriRuntime(
  win: Pick<
    TauriWindow,
    "__TAURI_INTERNALS__"
  > = globalThis.window as TauriWindow,
): boolean {
  return Boolean(win?.__TAURI_INTERNALS__);
}

export function normalizeShortcutAccelerator(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (
        lower === "cmd" ||
        lower === "command" ||
        lower === "ctrl" ||
        lower === "control"
      ) {
        return "CommandOrControl";
      }
      if (lower === "shift") return "Shift";
      if (lower === "alt" || lower === "option") return "Alt";
      const keyAliases: Record<string, string> = {
        space: "Space",
        esc: "Esc",
        escape: "Esc",
        enter: "Enter",
        return: "Enter",
      };
      if (keyAliases[lower]) return keyAliases[lower];
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join("+");
}

export async function registerNativeDictationShortcuts({
  toggleShortcut = DEFAULT_TOGGLE_SHORTCUT,
  pushToTalkShortcut = DEFAULT_PUSH_TO_TALK_SHORTCUT,
  onToggle,
  onPushToTalkStart,
  onPushToTalkStop,
}: RegisterShortcutOptions): Promise<NativeShortcutRegistration> {
  if (!isTauriRuntime()) {
    return {
      enabled: false,
      status: "Native shortcuts are available in the packaged desktop app.",
      unregister: async () => undefined,
    };
  }

  try {
    const plugin = await import("@tauri-apps/plugin-global-shortcut");
    const toggle = normalizeShortcutAccelerator(toggleShortcut);
    const pushToTalk = normalizeShortcutAccelerator(pushToTalkShortcut);
    const registered: string[] = [];

    try {
      await plugin.unregister(toggle);
    } catch {
      // The shortcut may not have been registered by a previous app instance.
    }
    try {
      await plugin.unregister(pushToTalk);
    } catch {
      // The shortcut may not have been registered by a previous app instance.
    }

    try {
      await plugin.register(toggle, (event) => {
        if (event.state === "Pressed") onToggle();
      });
      registered.push(toggle);
      await plugin.register(pushToTalk, (event) => {
        if (event.state === "Pressed") onPushToTalkStart();
        if (event.state === "Released") onPushToTalkStop();
      });
      registered.push(pushToTalk);
    } catch (error) {
      await Promise.allSettled(
        registered.map((accelerator) => plugin.unregister(accelerator)),
      );
      throw error;
    }

    return {
      enabled: true,
      status: `Global shortcuts registered: ${toggle} and ${pushToTalk}.`,
      unregister: async () => {
        await plugin.unregister(toggle);
        await plugin.unregister(pushToTalk);
      },
    };
  } catch (error) {
    return {
      enabled: false,
      status: `Global shortcut registration failed: ${error instanceof Error ? error.message : "unknown error"}`,
      unregister: async () => undefined,
    };
  }
}

export async function insertTextIntoActiveApp(
  text: string,
): Promise<NativeInsertionResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ok: false,
      method: "clipboard-fallback",
      status: "Nothing to insert yet.",
    };
  }

  if (!isTauriRuntime()) {
    return {
      ok: false,
      method: "clipboard-fallback",
      status: "Native insertion is only available in the packaged desktop app.",
    };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<NativeInsertionResult>(
      "insert_text_into_active_app",
      {
        text: trimmed,
      },
    );
    return result;
  } catch (error) {
    return {
      ok: false,
      method: "clipboard-fallback",
      status: `Native insertion failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
