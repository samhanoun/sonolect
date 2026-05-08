/**
 * System audio capture — frontend interface for capturing system audio
 * (Zoom/Teams/Meet calls) via Tauri commands that invoke platform-specific
 * recording tools (PulseAudio monitor, BlackHole + ffmpeg, Stereo Mix).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SystemAudioStatus = {
  available: boolean;
  method: string;
  setupInstructions: string;
};

export type CaptureSession = {
  id: string;
  startedAt: string;
  outputPath: string;
  status: "recording" | "stopped" | "error";
};

// ---------------------------------------------------------------------------
// Tauri invoke wrapper (works in Tauri, no-ops in browser dev mode)
// ---------------------------------------------------------------------------

async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const win = globalThis.window as
    | (Window & { __TAURI_INTERNALS__?: { invoke?: Function } })
    | undefined;
  const invoke = win?.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== "function") {
    throw new Error(
      `Tauri runtime not available — ${command} requires packaged desktop app`,
    );
  }
  return invoke(command, args) as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether system audio capture is available on the current platform.
 * Returns availability status, the detection method, and setup instructions.
 */
export async function checkSystemAudioAvailable(): Promise<SystemAudioStatus> {
  return tauriInvoke<SystemAudioStatus>("check_system_audio_available");
}

let activeCaptureSession: CaptureSession | null = null;

/**
 * Start capturing system audio to a temporary WAV file.
 * Returns a CaptureSession with the output file path.
 */
export async function startSystemCapture(): Promise<CaptureSession> {
  if (activeCaptureSession?.status === "recording") {
    throw new Error("A system audio capture is already in progress");
  }

  const timestamp = Date.now();
  const outputPath = `/tmp/sonolect-meeting-${timestamp}.wav`;

  const handle = await tauriInvoke<{
    id: string;
    startedAt: string;
    outputPath: string;
    status: string;
  }>("start_system_audio_capture", { outputPath });

  activeCaptureSession = {
    id: handle.id,
    startedAt: handle.startedAt,
    outputPath: handle.outputPath,
    status: "recording",
  };

  return activeCaptureSession;
}

/**
 * Stop the active system audio capture and return the audio file path.
 */
export async function stopSystemCapture(): Promise<string> {
  if (!activeCaptureSession || activeCaptureSession.status !== "recording") {
    throw new Error("No active system audio capture to stop");
  }

  await tauriInvoke("stop_system_audio_capture");

  const outputPath = activeCaptureSession.outputPath;
  activeCaptureSession = {
    ...activeCaptureSession,
    status: "stopped",
  };

  return outputPath;
}

/**
 * Get the currently active capture session, if any.
 */
export function getActiveCaptureSession(): CaptureSession | null {
  return activeCaptureSession;
}

/**
 * Reset the capture session state (for cleanup after errors).
 */
export function resetCaptureSession(): void {
  activeCaptureSession = null;
}

// ---------------------------------------------------------------------------
// Setup guide
// ---------------------------------------------------------------------------

/**
 * Returns platform-specific instructions for setting up system audio capture.
 */
export function getSystemAudioSetupGuide(platform: string): string {
  const normalized = platform.toLowerCase();

  if (normalized === "linux" || normalized.includes("linux")) {
    return [
      "Linux System Audio Setup:",
      "",
      "1. Install PulseAudio utilities:",
      "   sudo apt install pulseaudio-utils   # Debian/Ubuntu",
      "   sudo dnf install pulseaudio-utils   # Fedora",
      "   sudo pacman -S pulseaudio           # Arch",
      "",
      "2. Verify the monitor source is available:",
      "   pactl list short sources | grep monitor",
      "",
      "3. The default sink monitor will be used automatically.",
      "   No additional virtual audio device is needed.",
    ].join("\n");
  }

  if (normalized === "macos" || normalized === "darwin") {
    return [
      "macOS System Audio Setup:",
      "",
      "1. Install BlackHole virtual audio driver:",
      "   brew install blackhole-2ch",
      "   Or download from: https://github.com/ExistentialAudio/BlackHole",
      "",
      "2. Create a Multi-Output Device in Audio MIDI Setup:",
      "   - Open /Applications/Utilities/Audio MIDI Setup",
      "   - Click + > Create Multi-Output Device",
      "   - Check both your speakers and BlackHole 2ch",
      "   - Set this as your system output",
      "",
      "3. Install ffmpeg:",
      "   brew install ffmpeg",
      "",
      "4. Sonolect will capture from BlackHole 2ch automatically.",
    ].join("\n");
  }

  if (normalized === "windows" || normalized === "win32") {
    return [
      "Windows System Audio Setup:",
      "",
      "1. Enable Stereo Mix:",
      "   - Right-click the speaker icon in the taskbar",
      "   - Select 'Sounds' > 'Recording' tab",
      "   - Right-click in the empty area > 'Show Disabled Devices'",
      "   - Right-click 'Stereo Mix' > 'Enable'",
      "",
      "2. Install ffmpeg:",
      "   - Download from https://ffmpeg.org/download.html",
      "   - Add ffmpeg to your PATH",
      "",
      "3. Sonolect will capture from Stereo Mix automatically.",
    ].join("\n");
  }

  return "System audio capture setup instructions are not available for this platform. Supported platforms: Linux, macOS, Windows.";
}
