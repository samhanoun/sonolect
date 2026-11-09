export type AudioCaptureStatus =
  "unavailable" | "available" | "capturing" | "stopped" | "error";

export interface SystemAudioState {
  status: AudioCaptureStatus;
  error?: string;
  startedAt?: string;
  sampleRate: number;
  channels: number;
}

export function createInitialAudioState(): SystemAudioState {
  return { status: "unavailable", sampleRate: 44100, channels: 1 };
}

let tauriInvoke: ((cmd: string, args?: object) => Promise<unknown>) | null =
  null;

export function setTauriInvoke(
  fn: (cmd: string, args?: object) => Promise<unknown>,
): void {
  tauriInvoke = fn;
}

async function invoke<T>(cmd: string, args?: object): Promise<T> {
  if (!tauriInvoke) throw new Error("Tauri invoke not available");
  return tauriInvoke(cmd, args) as Promise<T>;
}

export async function checkSystemAudioAvailable(): Promise<boolean> {
  try {
    return await invoke<boolean>("check_system_audio_available");
  } catch {
    return false;
  }
}

export async function startSystemAudioCapture(
  outputPath: string,
): Promise<SystemAudioState> {
  try {
    await invoke("start_system_audio_capture", { outputPath });
    return {
      status: "capturing",
      startedAt: new Date().toISOString(),
      sampleRate: 44100,
      channels: 1,
    };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      sampleRate: 44100,
      channels: 1,
    };
  }
}

export async function stopSystemAudioCapture(): Promise<SystemAudioState> {
  try {
    await invoke("stop_system_audio_capture");
    return { status: "stopped", sampleRate: 44100, channels: 1 };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      sampleRate: 44100,
      channels: 1,
    };
  }
}

export type Platform = "linux" | "macos" | "windows" | "unknown";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("linux")) return "linux";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  return "unknown";
}

export interface PlatformSetupGuide {
  platform: Platform;
  title: string;
  steps: string[];
  checkCommand: string;
}

export function getSetupGuide(platform: Platform): PlatformSetupGuide {
  switch (platform) {
    case "linux":
      return {
        platform: "linux",
        title: "PulseAudio Monitor Setup",
        steps: [
          "Install PulseAudio if not present: sudo apt install pulseaudio",
          "Identify your monitor source: pactl list short sources | grep monitor",
          "The app will capture from the default monitor source automatically",
          "Ensure PulseAudio is running: pulseaudio --check",
        ],
        checkCommand: "pactl list short sources | grep monitor",
      };
    case "macos":
      return {
        platform: "macos",
        title: "BlackHole Virtual Audio Setup",
        steps: [
          "Install BlackHole: brew install blackhole-2ch",
          "Open Audio MIDI Setup (Applications → Utilities)",
          "Create a Multi-Output Device combining your speakers + BlackHole 2ch",
          "Set the Multi-Output Device as your system output",
          "The app will capture from BlackHole 2ch input",
        ],
        checkCommand: "system_profiler SPAudioDataType | grep -i blackhole",
      };
    case "windows":
      return {
        platform: "windows",
        title: "Stereo Mix / WASAPI Loopback Setup",
        steps: [
          "Right-click the speaker icon → Sound settings → More sound settings",
          "Go to the Recording tab",
          "Right-click empty space → Show Disabled Devices",
          "Enable 'Stereo Mix' if available",
          "If no Stereo Mix, the app uses WASAPI loopback capture automatically",
        ],
        checkCommand:
          "powershell Get-WmiObject Win32_SoundDevice | Select Name",
      };
    default:
      return {
        platform: "unknown",
        title: "Unsupported Platform",
        steps: ["System audio capture is not supported on this platform"],
        checkCommand: "",
      };
  }
}
