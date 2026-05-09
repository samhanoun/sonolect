import { isTauriRuntime } from "./desktopNative";

// ── Types ─────────────────────────────────────────────────────────────

export type PlatformPermission =
  | "accessibility"
  | "microphone"
  | "screen-recording"
  | "system-audio";

export type PermissionStatus =
  | "granted"
  | "denied"
  | "not-determined"
  | "unsupported";

export type PermissionCheckResult = {
  permission: PlatformPermission;
  status: PermissionStatus;
  platform: string;
  instructions: string;
};

// ── Platform detection ────────────────────────────────────────────────

export function detectPlatform(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

// ── Permission instruction strings ────────────────────────────────────

export function getPermissionInstructions(
  permission: PlatformPermission,
  platform: string,
): string {
  const instructions: Record<string, Record<string, string>> = {
    accessibility: {
      macos:
        "Open System Settings → Privacy & Security → Accessibility → Enable Sonolect",
      windows: "No additional permissions needed on Windows",
      linux: "No additional permissions needed on Linux",
      unknown: "Check your OS accessibility settings",
    },
    microphone: {
      macos:
        "Open System Settings → Privacy & Security → Microphone → Enable Sonolect",
      windows: "Open Settings → Privacy → Microphone → Allow Sonolect",
      linux: "Grant microphone access when prompted by your browser",
      unknown: "Grant microphone access when prompted",
    },
    "screen-recording": {
      macos:
        "Open System Settings → Privacy & Security → Screen Recording → Enable Sonolect",
      windows: "No additional permissions needed on Windows",
      linux: "No additional permissions needed on Linux",
      unknown: "Check your OS screen recording settings",
    },
    "system-audio": {
      macos: "Install BlackHole or Loopback to capture system audio on macOS",
      windows: "Enable Stereo Mix in Sound settings → Recording devices",
      linux:
        "Ensure PulseAudio or PipeWire is running for system audio capture",
      unknown: "Configure a virtual audio device for system audio capture",
    },
  };

  return (
    instructions[permission]?.[platform] ??
    instructions[permission]?.["unknown"] ??
    "Check your OS settings"
  );
}

// ── Individual permission checks ──────────────────────────────────────

async function checkAccessibility(platform: string): Promise<PermissionStatus> {
  // Linux and Windows do not require accessibility permissions
  if (platform === "linux" || platform === "windows") return "granted";

  if (!isTauriRuntime()) return "not-determined";

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{ status: string }>(
      "check_accessibility_permission",
    );
    if (result.status === "granted") return "granted";
    if (result.status === "denied") return "denied";
    return "not-determined";
  } catch {
    return "not-determined";
  }
}

async function checkMicrophone(platform: string): Promise<PermissionStatus> {
  // Try the Permissions API first (works in browsers and some Tauri webviews)
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.permissions !== "undefined"
  ) {
    try {
      const result = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      if (result.state === "granted") return "granted";
      if (result.state === "denied") return "denied";
      return "not-determined";
    } catch {
      // Permissions API not supported for microphone — fall through
    }
  }

  // Fallback: check if getUserMedia is available
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  ) {
    return "not-determined";
  }

  return platform === "unknown" ? "unsupported" : "not-determined";
}

async function checkScreenRecording(
  platform: string,
): Promise<PermissionStatus> {
  if (platform !== "macos") return "unsupported";
  // Screen recording permission on macOS cannot be queried programmatically
  // from the webview; return not-determined so the UI can prompt the user.
  return "not-determined";
}

async function checkSystemAudio(platform: string): Promise<PermissionStatus> {
  if (platform === "macos") {
    // BlackHole or Loopback must be installed — cannot detect from webview
    return "not-determined";
  }
  if (platform === "windows") {
    // Stereo Mix availability cannot be queried without native code
    return "not-determined";
  }
  if (platform === "linux") {
    // PulseAudio/PipeWire is almost always present on desktop Linux
    return "not-determined";
  }
  return "unsupported";
}

// ── Public API ────────────────────────────────────────────────────────

export async function checkPermission(
  permission: PlatformPermission,
): Promise<PermissionCheckResult> {
  const platform = detectPlatform();

  const checkers: Record<
    PlatformPermission,
    (p: string) => Promise<PermissionStatus>
  > = {
    accessibility: checkAccessibility,
    microphone: checkMicrophone,
    "screen-recording": checkScreenRecording,
    "system-audio": checkSystemAudio,
  };

  const status = await checkers[permission](platform);

  return {
    permission,
    status,
    platform,
    instructions: getPermissionInstructions(permission, platform),
  };
}

export async function getAllPermissionStatuses(): Promise<
  PermissionCheckResult[]
> {
  const permissions: PlatformPermission[] = [
    "accessibility",
    "microphone",
    "screen-recording",
    "system-audio",
  ];

  return Promise.all(permissions.map(checkPermission));
}

export function getMissingPermissions(
  results: PermissionCheckResult[],
): PermissionCheckResult[] {
  return results.filter(
    (r) => r.status === "denied" || r.status === "not-determined",
  );
}

export function canInsertText(results: PermissionCheckResult[]): boolean {
  const accessibility = results.find((r) => r.permission === "accessibility");
  return accessibility?.status === "granted";
}

export function canRecordAudio(results: PermissionCheckResult[]): boolean {
  const microphone = results.find((r) => r.permission === "microphone");
  return microphone?.status === "granted";
}

export function canCaptureSystemAudio(
  results: PermissionCheckResult[],
): boolean {
  const systemAudio = results.find((r) => r.permission === "system-audio");
  return systemAudio?.status === "granted";
}

// ── Open system settings ──────────────────────────────────────────────

export async function openAccessibilitySettings(): Promise<void> {
  if (!isTauriRuntime()) return;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_accessibility_settings");
  } catch {
    // Settings could not be opened — silently ignore
  }
}
