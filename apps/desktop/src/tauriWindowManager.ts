import { isTauriRuntime } from "./desktopNative";

// ── Window configuration types ────────────────────────────────────
export type WindowConfig = {
  label: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  alwaysOnTop: boolean;
  decorations: boolean;
  transparent: boolean;
};

// ── Size constants ────────────────────────────────────────────────
export const PILL_WIDTH = 320;
export const PILL_HEIGHT = 80;
export const EXPANDED_WIDTH = 320;
export const EXPANDED_HEIGHT = 280;

export const RECORDER_WINDOW_CONFIG: WindowConfig = {
  label: "recorder",
  width: PILL_WIDTH,
  height: PILL_HEIGHT,
  alwaysOnTop: true,
  decorations: false,
  transparent: true,
};

// ── Internal helper: get or create the recorder WebviewWindow ─────
type TauriWebviewWindow = {
  show: () => Promise<void>;
  hide: () => Promise<void>;
  setSize: (size: unknown) => Promise<void>;
  setPosition: (position: unknown) => Promise<void>;
  isVisible: () => Promise<boolean>;
  close: () => Promise<void>;
};

async function getOrCreateRecorderWindow(): Promise<TauriWebviewWindow | null> {
  if (!isTauriRuntime()) return null;

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

    // Check for an existing window with the recorder label
    const existing = await WebviewWindow.getByLabel(
      RECORDER_WINDOW_CONFIG.label,
    );
    if (existing) return existing as unknown as TauriWebviewWindow;

    // Create a new recorder window loading the same app URL with a query param
    const positionOpts: Record<string, number> = {};
    if (RECORDER_WINDOW_CONFIG.x !== undefined)
      positionOpts["x"] = RECORDER_WINDOW_CONFIG.x;
    if (RECORDER_WINDOW_CONFIG.y !== undefined)
      positionOpts["y"] = RECORDER_WINDOW_CONFIG.y;

    const win = new WebviewWindow(RECORDER_WINDOW_CONFIG.label, {
      url: "index.html?window=recorder",
      title: "Sonolect Recorder",
      width: RECORDER_WINDOW_CONFIG.width,
      height: RECORDER_WINDOW_CONFIG.height,
      decorations: RECORDER_WINDOW_CONFIG.decorations,
      alwaysOnTop: RECORDER_WINDOW_CONFIG.alwaysOnTop,
      transparent: RECORDER_WINDOW_CONFIG.transparent,
      resizable: false,
      visible: false,
      center: false,
      ...positionOpts,
    });
    return win as unknown as TauriWebviewWindow;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────

export async function showRecorderWindow(): Promise<void> {
  const win = await getOrCreateRecorderWindow();
  if (!win) return;
  await win.show();
}

export async function hideRecorderWindow(): Promise<void> {
  if (!isTauriRuntime()) return;

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = await WebviewWindow.getByLabel(RECORDER_WINDOW_CONFIG.label);
    if (win) await (win as unknown as TauriWebviewWindow).hide();
  } catch {
    // Window may not exist — ignore.
  }
}

export async function resizeRecorderWindow(expanded: boolean): Promise<void> {
  if (!isTauriRuntime()) return;

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const win = await WebviewWindow.getByLabel(RECORDER_WINDOW_CONFIG.label);
    if (!win) return;

    const width = expanded ? EXPANDED_WIDTH : PILL_WIDTH;
    const height = expanded ? EXPANDED_HEIGHT : PILL_HEIGHT;
    await (win as unknown as TauriWebviewWindow).setSize(
      new LogicalSize(width, height),
    );
  } catch {
    // Window may not exist — ignore.
  }
}

export async function moveRecorderWindow(x: number, y: number): Promise<void> {
  if (!isTauriRuntime()) return;

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const { LogicalPosition } = await import("@tauri-apps/api/dpi");
    const win = await WebviewWindow.getByLabel(RECORDER_WINDOW_CONFIG.label);
    if (!win) return;

    await (win as unknown as TauriWebviewWindow).setPosition(
      new LogicalPosition(x, y),
    );
  } catch {
    // Window may not exist — ignore.
  }
}

export async function isRecorderWindowVisible(): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = await WebviewWindow.getByLabel(RECORDER_WINDOW_CONFIG.label);
    if (!win) return false;
    return await (win as unknown as TauriWebviewWindow).isVisible();
  } catch {
    return false;
  }
}

export async function closeRecorderWindow(): Promise<void> {
  if (!isTauriRuntime()) return;

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = await WebviewWindow.getByLabel(RECORDER_WINDOW_CONFIG.label);
    if (win) await (win as unknown as TauriWebviewWindow).close();
  } catch {
    // Window may not exist — ignore.
  }
}
