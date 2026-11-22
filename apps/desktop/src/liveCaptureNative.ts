/**
 * The browser and desktop halves of a live recording: reading the microphone
 * as raw samples, and the native commands that record them.
 */
import type { CaptureQuality } from "./captureStorage";
import type { DesktopWhisperResult } from "./desktopWhisper";
import {
  LiveCaptureSession,
  streamRecordedAudio,
  type LiveCaptureHandlers,
  type LiveCaptureNativeResult,
  type LiveCaptureSettings,
  type LiveCaptureTransport,
  type LivePartialEvent,
  type PcmFormat,
} from "./liveCapture";
import { localizeNativeMessage } from "./nativeMessages";
import { interleave } from "./pcmStream";
import { nativeProviderCall } from "./providerSettings";
import type { TranscriptSegment } from "./segmentEditor";

export type PcmSource = {
  sampleRate: number;
  /** Channels in each block, interleaved: 1, or 2 in high quality. */
  channels?: number;
  /** "worklet" on the audio thread, or the older "processor" fallback. */
  kind: "worklet" | "processor";
  close: () => Promise<void>;
};

const WORKLET_URL = "/pcm-capture.worklet.js";

/**
 * The context the microphone is read in: at 16 kHz for speech, which most
 * webviews resample to themselves when asked, or at 48 kHz in high quality.
 * A webview that refuses the rate gives its own, which the web layer (for
 * speech) or the native side (in high quality) converts.
 */
function createContext(sampleRate: number): AudioContext {
  try {
    return new AudioContext({ sampleRate });
  } catch {
    return new AudioContext();
  }
}

/**
 * How many channels to record: two only in high quality, and only from a
 * microphone that reports two. WebKit reports no channel count, so its
 * microphones record mono; a node set to two channels would only copy a
 * mono source, so it cannot tell either.
 */
export function captureChannels(
  stream: MediaStream,
  quality: CaptureQuality = "speech",
): 1 | 2 {
  if (quality !== "high") return 1;
  const track = stream.getAudioTracks?.()[0];
  return track?.getSettings?.().channelCount === 2 ? 2 : 1;
}

/**
 * Reads a microphone stream as blocks of samples: mono, or in high quality
 * the microphone's two channels interleaved when it has them. `onBlock` gets
 * each block with the rate it was captured at and its channel count.
 */
export async function openPcmSource(
  stream: MediaStream,
  onBlock: (block: Float32Array, sampleRate: number, channels?: number) => void,
  quality: CaptureQuality = "speech",
): Promise<PcmSource> {
  const context = createContext(quality === "high" ? 48000 : 16000);
  const sampleRate = context.sampleRate;
  const channels = captureChannels(stream, quality);
  const source = context.createMediaStreamSource(stream);
  // Silent path to the output, so every webview keeps pulling audio through.
  const sink = context.createGain();
  sink.gain.value = 0;
  sink.connect(context.destination);

  let node: AudioNode;
  let kind: PcmSource["kind"];
  try {
    await context.audioWorklet.addModule(WORKLET_URL);
    const worklet = new AudioWorkletNode(context, "pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: channels,
      channelCountMode: "explicit",
      processorOptions: { channels },
    });
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) =>
      onBlock(event.data, sampleRate, channels);
    node = worklet;
    kind = "worklet";
  } catch {
    // Webviews without audio worklets still have the script processor.
    const processor = context.createScriptProcessor(4096, channels, channels);
    processor.onaudioprocess = (event) =>
      onBlock(
        interleave(
          Array.from({ length: channels }, (_, index) =>
            event.inputBuffer.getChannelData(index).slice(),
          ),
        ),
        sampleRate,
        channels,
      );
    node = processor;
    kind = "processor";
  }
  source.connect(node);
  node.connect(sink);
  // Not awaited: started without a click in the window (a global hotkey),
  // a webview may keep the context suspended and never settle this promise.
  // The caller notices that no audio arrives.
  if (context.state === "suspended")
    void context.resume().catch(() => undefined);

  return {
    sampleRate,
    channels,
    kind,
    close: async () => {
      source.disconnect();
      node.disconnect();
      sink.disconnect();
      if (node instanceof AudioWorkletNode) node.port.onmessage = null;
      else (node as ScriptProcessorNode).onaudioprocess = null;
      if (context.state !== "closed") await context.close();
    },
  };
}

/**
 * The headers of one piece: the recording it belongs to and, for a
 * high-quality recording, its rate and channels. A piece without them is
 * 16 kHz mono, as the native side has always taken it.
 */
export function captureAppendHeaders(
  captureId: string,
  format?: PcmFormat,
): Record<string, string> {
  return {
    "x-sonolect-capture": captureId,
    ...(format
      ? {
          "x-sonolect-rate": String(format.rate),
          "x-sonolect-channels": String(format.channels),
        }
      : {}),
  };
}

/** The desktop app's recorder commands. */
export const nativeLiveCapture: LiveCaptureTransport = {
  begin: (settings: LiveCaptureSettings) =>
    nativeProviderCall<string>("capture_begin", {
      language: settings.language,
      modelPath: settings.modelPath?.trim() || undefined,
      provider: settings.provider,
      model: settings.model,
      quality: settings.quality,
    }),
  append: (captureId, pcm, format) =>
    nativeProviderCall<number>(
      "capture_append",
      pcm,
      captureAppendHeaders(captureId, format),
    ),
  finish: (captureId) =>
    nativeProviderCall<LiveCaptureNativeResult>("capture_finish", {
      id: captureId,
    }),
  cancel: (captureId) =>
    nativeProviderCall<void>("capture_cancel", { id: captureId }),
  listen: async (onPartial) => {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<LivePartialEvent>("capture-partial", (event) =>
      onPartial(event.payload),
    );
  },
};

export type LiveRecording = {
  captureId: string;
  /** Stops the microphone feed and resolves with the whole transcript. */
  finish: () => Promise<DesktopWhisperResult & { durationMs: number }>;
  /** Stops and throws the recording away. */
  cancel: () => Promise<void>;
};

/** How long the first block of microphone audio may take to arrive. */
const FIRST_AUDIO_MS = 1500;

/**
 * Records a microphone stream through the native recorder: no length limit
 * short of four hours, and text arrives while the user is still speaking.
 * Resolves with `undefined` when the recorder or the audio capture cannot
 * start, or when no audio arrives (a webview may refuse to run audio
 * processing for a recording started without a click), so the caller can
 * fall back to the short-recording path. The stream itself stays the
 * caller's to stop.
 */
export async function recordLive(
  stream: MediaStream,
  settings: LiveCaptureSettings,
  handlers: LiveCaptureHandlers = {},
  transport: LiveCaptureTransport = nativeLiveCapture,
  open: typeof openPcmSource = openPcmSource,
  firstAudioMs = FIRST_AUDIO_MS,
): Promise<LiveRecording | undefined> {
  let session: LiveCaptureSession;
  try {
    session = await LiveCaptureSession.start(transport, settings, handlers);
  } catch {
    return undefined;
  }
  let heard = () => {};
  const firstAudio = new Promise<boolean>((resolve) => {
    heard = () => resolve(true);
  });
  let source: PcmSource;
  try {
    source = await open(
      stream,
      (block, sampleRate, channels) => {
        heard();
        session.push(block, sampleRate, channels);
      },
      settings.quality,
    );
  } catch {
    await session.cancel().catch(() => undefined);
    return undefined;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flowing = await Promise.race([
    firstAudio,
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), firstAudioMs);
    }),
  ]);
  clearTimeout(timer);
  if (!flowing) {
    await source.close().catch(() => undefined);
    await session.cancel().catch(() => undefined);
    return undefined;
  }
  return {
    captureId: session.captureId,
    finish: async () => {
      await source.close().catch(() => undefined);
      const result = await session.finish();
      return { ...result, durationMs: session.durationMs };
    },
    cancel: async () => {
      await source.close().catch(() => undefined);
      await session.cancel();
    },
  };
}

/** Which sound a recording started in the Studio takes. */
export const CAPTURE_SOURCES = ["microphone", "system"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];
export const CAPTURE_SOURCE_KEY = "sonolect.captureSource";

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadCaptureSource(
  storage: Pick<Storage, "getItem"> | undefined = browserStorage(),
): CaptureSource {
  try {
    return storage?.getItem(CAPTURE_SOURCE_KEY) === "system"
      ? "system"
      : "microphone";
  } catch {
    return "microphone";
  }
}

export function saveCaptureSource(
  source: CaptureSource,
  storage:
    Pick<Storage, "setItem" | "removeItem"> | undefined = browserStorage(),
): void {
  try {
    if (source === "system") storage?.setItem(CAPTURE_SOURCE_KEY, source);
    else storage?.removeItem(CAPTURE_SOURCE_KEY);
  } catch {
    // Without storage the choice lasts until the app closes.
  }
}

export type SystemAudioEnded = { id: string; message: string };

/**
 * The desktop app's system-audio feed: what is playing on this computer,
 * recorded natively and added to a live recording without passing through
 * the window. Replaced by a fake in tests.
 */
export type SystemAudioFeed = {
  available: () => Promise<boolean>;
  /** Feeds the recording until `stop`. */
  start: (captureId: string) => Promise<void>;
  /** Resolves once all of the audio is in the recording. */
  stop: () => Promise<void>;
  /** Loudness, and a feed that ended by itself. Resolves with unsubscribe. */
  listen: (handlers: {
    onLevel: (level: number) => void;
    onEnded: (event: SystemAudioEnded) => void;
  }) => Promise<() => void>;
};

export const nativeSystemAudio: SystemAudioFeed = {
  available: () =>
    nativeProviderCall<boolean>("check_system_audio_available").catch(
      () => false,
    ),
  start: (captureId) =>
    nativeProviderCall<void>("start_system_audio_capture", { id: captureId }),
  stop: () => nativeProviderCall<void>("stop_system_audio_capture"),
  listen: async ({ onLevel, onEnded }) => {
    const { listen } = await import("@tauri-apps/api/event");
    const stops = await Promise.all([
      listen<number>("system-audio-level", (event) => onLevel(event.payload)),
      listen<SystemAudioEnded>("system-audio-ended", (event) =>
        onEnded(event.payload),
      ),
    ]);
    return () => stops.forEach((stop) => stop());
  },
};

/**
 * Records what is playing on this computer through the native recorder,
 * with the same limits and live text as a microphone recording. Unlike
 * `recordLive` there is nothing to fall back to, so it rejects with the
 * reason when the recorder or the feed cannot start.
 */
export async function recordSystemAudio(
  settings: LiveCaptureSettings,
  handlers: LiveCaptureHandlers = {},
  transport: LiveCaptureTransport = nativeLiveCapture,
  feed: SystemAudioFeed = nativeSystemAudio,
  now: () => number = Date.now,
): Promise<LiveRecording> {
  const session = await LiveCaptureSession.start(transport, settings, handlers);
  let unlisten = () => {};
  let startedAt = 0;
  let started = false;
  let endedEarly: string | undefined;
  let over = false;
  const close = async () => {
    over = true;
    handlers.onLevel?.(0);
    unlisten();
    await feed.stop().catch(() => undefined);
  };
  try {
    unlisten = await feed.listen({
      onLevel: (level) => {
        if (!over) handlers.onLevel?.(level);
      },
      onEnded: (event) => {
        if (over || event.id !== session.captureId) return;
        const message = localizeNativeMessage(event.message);
        if (started) handlers.onStalled?.(message);
        else endedEarly ??= message;
      },
    });
    await feed.start(session.captureId);
    // A recorder that exits at once (its process can end before the start
    // is acknowledged) never started: say why instead of recording nothing.
    if (endedEarly !== undefined) throw new Error(endedEarly);
    started = true;
    startedAt = now();
  } catch (error) {
    await close();
    await session.cancel().catch(() => undefined);
    throw error;
  }
  return {
    captureId: session.captureId,
    finish: async () => {
      const durationMs = Math.max(0, now() - startedAt);
      await close();
      return { ...(await session.finish()), durationMs };
    },
    cancel: async () => {
      await close();
      await session.cancel();
    },
  };
}

/** Decodes an audio file, at 16 kHz when the webview can do that itself. */
async function decodeForSpeech(file: Blob) {
  const data = await file.arrayBuffer();
  let context: BaseAudioContext;
  try {
    context = new OfflineAudioContext(1, 1, 16000);
  } catch {
    context = new AudioContext();
  }
  try {
    const decoded = await context.decodeAudioData(data);
    return {
      sampleRate: decoded.sampleRate,
      durationMs: Math.round(decoded.duration * 1000),
      channels: Array.from({ length: decoded.numberOfChannels }, (_, index) =>
        decoded.getChannelData(index),
      ),
    };
  } finally {
    if (context instanceof AudioContext) await context.close();
  }
}

export type AudioFileProgress = {
  /** How far into the file the text has got, in milliseconds. */
  transcribedMs: number;
  durationMs: number;
  segments: TranscriptSegment[];
};

/**
 * Transcribes an audio file of any length through the live recorder, which
 * saves it to the library and works through it chunk by chunk. Resolves with
 * `undefined` when the recorder cannot start (no speech model, say), so the
 * caller can fall back to the short-recording path and its messages.
 */
export async function transcribeAudioFile(
  file: Blob,
  settings: LiveCaptureSettings,
  onProgress?: (progress: AudioFileProgress) => void,
  transport: LiveCaptureTransport = nativeLiveCapture,
): Promise<(DesktopWhisperResult & { durationMs: number }) | undefined> {
  const audio = await decodeForSpeech(file);
  let session: LiveCaptureSession;
  try {
    session = await LiveCaptureSession.start(transport, settings, {
      onPartial: (segments) =>
        onProgress?.({
          transcribedMs: segments.at(-1)?.endMs ?? 0,
          durationMs: audio.durationMs,
          segments,
        }),
    });
  } catch {
    return undefined;
  }
  try {
    await streamRecordedAudio(session, audio.channels, audio.sampleRate);
  } catch (error) {
    await session.cancel().catch(() => undefined);
    throw error;
  }
  return { ...(await session.finish()), durationMs: audio.durationMs };
}
