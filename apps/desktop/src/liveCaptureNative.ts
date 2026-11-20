/**
 * The browser and desktop halves of a live recording: reading the microphone
 * as raw samples, and the native commands that record them.
 */
import type { DesktopWhisperResult } from "./desktopWhisper";
import {
  LiveCaptureSession,
  streamRecordedAudio,
  type LiveCaptureHandlers,
  type LiveCaptureNativeResult,
  type LiveCaptureSettings,
  type LiveCaptureTransport,
  type LivePartialEvent,
} from "./liveCapture";
import { nativeProviderCall } from "./providerSettings";
import type { TranscriptSegment } from "./segmentEditor";

export type PcmSource = {
  sampleRate: number;
  /** "worklet" on the audio thread, or the older "processor" fallback. */
  kind: "worklet" | "processor";
  close: () => Promise<void>;
};

const WORKLET_URL = "/pcm-capture.worklet.js";

function createContext(): AudioContext {
  try {
    // Most webviews resample the microphone themselves when asked.
    return new AudioContext({ sampleRate: 16000 });
  } catch {
    return new AudioContext();
  }
}

/**
 * Reads a microphone stream as mono blocks of samples. `onBlock` gets each
 * block with the rate it was captured at.
 */
export async function openPcmSource(
  stream: MediaStream,
  onBlock: (block: Float32Array, sampleRate: number) => void,
): Promise<PcmSource> {
  const context = createContext();
  const sampleRate = context.sampleRate;
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
      channelCount: 1,
      channelCountMode: "explicit",
    });
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) =>
      onBlock(event.data, sampleRate);
    node = worklet;
    kind = "worklet";
  } catch {
    // Webviews without audio worklets still have the script processor.
    const processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) =>
      onBlock(event.inputBuffer.getChannelData(0).slice(), sampleRate);
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

/** The desktop app's recorder commands. */
export const nativeLiveCapture: LiveCaptureTransport = {
  begin: (settings: LiveCaptureSettings) =>
    nativeProviderCall<string>("capture_begin", {
      language: settings.language,
      modelPath: settings.modelPath?.trim() || undefined,
      provider: settings.provider,
      model: settings.model,
    }),
  append: (captureId, pcm) =>
    nativeProviderCall<number>("capture_append", pcm, {
      "x-sonolect-capture": captureId,
    }),
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
    source = await open(stream, (block, sampleRate) => {
      heard();
      session.push(block, sampleRate);
    });
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
