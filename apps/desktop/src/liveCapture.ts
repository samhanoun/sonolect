/**
 * A recording that is sent to the native recorder while it is being made.
 *
 * The audio never sits in the web layer: every half second goes to disk on
 * the native side, which transcribes it at pauses and reports the text as
 * `capture-partial` events. That is what lifts the old three-minute limit
 * and shows text while the user is still speaking. A speech-quality
 * recording sends 16 kHz mono, as the native side has always taken it; a
 * high-quality one sends its source's rate and channels as they are, with
 * headers that say so, and the native side converts them.
 */
import {
  normalizeWhisperSegments,
  type DesktopWhisperResult,
  type DesktopWhisperSegmentPayload,
} from "./desktopWhisper";
import type { CaptureQuality } from "./captureStorage";
import {
  PcmBatcher,
  PcmResampler,
  capturePieceSamples,
  floatToPcm16,
  mixToMono,
  pcmBytes,
  pcmLevel,
} from "./pcmStream";
import { getT } from "./i18n";
import type { TranscriptSegment } from "./segmentEditor";

export type LiveCaptureSettings = {
  language?: string;
  modelPath?: string;
  /** An online speech model; the local engine when absent or "local". */
  provider?: string;
  model?: string;
  /** "high" keeps a 48 kHz copy of a live recording; speech when absent. */
  quality?: CaptureQuality;
};

/** The rate and channels of the pieces a high-quality recording sends. */
export type PcmFormat = { rate: number; channels: number };

export type LivePartialEvent = {
  captureId: string;
  segments: DesktopWhisperSegmentPayload[];
};

export type LiveCaptureNativeResult = {
  text: string;
  segments?: DesktopWhisperSegmentPayload[];
  language?: string;
  captureId?: string;
};

/** The native side of a live recording. Replaced by a fake in tests. */
export type LiveCaptureTransport = {
  begin: (settings: LiveCaptureSettings) => Promise<string>;
  /**
   * Sends one piece; resolves with the length recorded so far. Without a
   * format the piece is 16 kHz mono.
   */
  append: (
    captureId: string,
    pcm: Uint8Array,
    format?: PcmFormat,
  ) => Promise<number>;
  finish: (captureId: string) => Promise<LiveCaptureNativeResult>;
  cancel: (captureId: string) => Promise<void>;
  /** Subscribes to live text; resolves with the unsubscribe function. */
  listen: (onPartial: (event: LivePartialEvent) => void) => Promise<() => void>;
};

export type LiveCaptureHandlers = {
  /** Everything understood so far, each time a new stretch is transcribed. */
  onPartial?: (segments: TranscriptSegment[]) => void;
  /** Loudness from 0 to 1, about fifteen times a second. */
  onLevel?: (level: number) => void;
  /**
   * The recorder refused more audio (the four-hour limit, or the recording is
   * gone). Called once; the caller should stop recording.
   */
  onStalled?: (message: string) => void;
};

/** Pieces that may wait to be sent before the recording is given up. */
const MAX_WAITING_PIECES = 240;

export class LiveCaptureSession {
  private resampler: PcmResampler | undefined;
  private batcher = new PcmBatcher();
  /** A high-quality recording's format, fixed by its first block. */
  private format: PcmFormat | undefined;
  private readonly heard: DesktopWhisperSegmentPayload[] = [];
  private queue: Promise<void> = Promise.resolve();
  private waiting = 0;
  private stalled: string | undefined;
  /** No more audio is taken. */
  private closed = false;
  /** The recording is over; late events are ignored. */
  private ended = false;
  private recordedMs = 0;

  private constructor(
    readonly captureId: string,
    private readonly transport: LiveCaptureTransport,
    private readonly handlers: LiveCaptureHandlers,
    private unlisten: () => void,
    private readonly highQuality: boolean,
  ) {}

  static async start(
    transport: LiveCaptureTransport,
    settings: LiveCaptureSettings,
    handlers: LiveCaptureHandlers = {},
  ): Promise<LiveCaptureSession> {
    // Listen first: the ID is only known once the recording exists.
    const pending: LivePartialEvent[] = [];
    let session: LiveCaptureSession | undefined;
    const unlisten = await transport.listen((event) => {
      if (session) session.receive(event);
      else pending.push(event);
    });
    try {
      const captureId = await transport.begin(settings);
      session = new LiveCaptureSession(
        captureId,
        transport,
        handlers,
        unlisten,
        settings.quality === "high",
      );
      pending.forEach((event) => session!.receive(event));
      return session;
    } catch (error) {
      unlisten();
      throw error;
    }
  }

  /** How much audio the native side has confirmed, in milliseconds. */
  get durationMs() {
    return this.recordedMs;
  }

  /** Why the recorder stopped taking audio, if it did. */
  get stalledBy() {
    return this.stalled;
  }

  /** Resolves once everything pushed so far has reached the recorder. */
  async sent(): Promise<void> {
    await this.queue;
  }

  /** The text understood so far. */
  get partialSegments(): TranscriptSegment[] {
    return normalizeWhisperSegments(this.heard).map((segment, index) => ({
      ...segment,
      id: `live-${index + 1}`,
    }));
  }

  private receive(event: LivePartialEvent) {
    if (this.ended || event.captureId !== this.captureId) return;
    this.heard.push(...event.segments);
    this.handlers.onPartial?.(this.partialSegments);
  }

  /**
   * Adds a block of microphone audio at the given sample rate, with
   * `channels` interleaved. A speech-quality recording mixes it to mono and
   * brings it to 16 kHz; a high-quality one sends it as it is, in pieces of
   * half a second, and every block must keep the first one's format.
   */
  push(block: Float32Array, sampleRate: number, channels = 1) {
    if (this.closed || this.stalled) return;
    if (this.highQuality) {
      if (!this.format) {
        this.format = { rate: sampleRate, channels };
        this.batcher = new PcmBatcher(
          capturePieceSamples(sampleRate, channels),
        );
      } else if (
        this.format.rate !== sampleRate ||
        this.format.channels !== channels
      ) {
        this.stall(getT()("native.pcmFormatChanged"));
        return;
      }
      this.handlers.onLevel?.(pcmLevel(block));
      for (const piece of this.batcher.push(floatToPcm16(block)))
        this.send(piece);
      return;
    }
    const mono = mixToMono(block, channels);
    if (this.resampler?.sourceRate !== sampleRate)
      this.resampler = new PcmResampler(sampleRate);
    this.handlers.onLevel?.(pcmLevel(mono));
    for (const piece of this.batcher.push(
      floatToPcm16(this.resampler.push(mono)),
    ))
      this.send(piece);
  }

  private send(piece: Int16Array) {
    if (this.stalled) return;
    if (this.waiting >= MAX_WAITING_PIECES) {
      this.stall(getT()("capture.recorderBehind"));
      return;
    }
    this.waiting += 1;
    this.queue = this.queue.then(async () => {
      if (this.stalled) return;
      try {
        this.recordedMs = await this.transport.append(
          this.captureId,
          pcmBytes(piece),
          this.format,
        );
      } catch (error) {
        this.stall(error instanceof Error ? error.message : String(error));
      } finally {
        this.waiting -= 1;
      }
    });
  }

  private stall(message: string) {
    if (this.stalled) return;
    this.stalled = message;
    if (!this.closed) this.handlers.onStalled?.(message);
  }

  /**
   * Ends the recording and returns its transcript. Audio recorded before the
   * recorder stalled is still transcribed and kept.
   */
  async finish(): Promise<DesktopWhisperResult> {
    if (this.closed) throw new Error("This recording has already ended.");
    const rest = this.batcher.flush();
    if (rest) this.send(rest);
    this.closed = true;
    await this.queue;
    try {
      const result = await this.transport.finish(this.captureId);
      return {
        text: result.text.trim(),
        segments: normalizeWhisperSegments(result.segments ?? []),
        ...(result.language ? { language: result.language } : {}),
        captureId: result.captureId ?? this.captureId,
      };
    } finally {
      this.ended = true;
      this.unlisten();
    }
  }

  /** Stops and throws the recording away. */
  async cancel(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.ended = true;
    this.stalled ??= "cancelled";
    await this.queue;
    try {
      await this.transport.cancel(this.captureId);
    } finally {
      this.unlisten();
    }
  }
}

/**
 * Sends audio that already exists (an imported file) through a session, one
 * second at a time, mixed down to mono. Waits for each second to be stored,
 * so a long file never queues up in memory twice.
 */
export async function streamRecordedAudio(
  session: LiveCaptureSession,
  channels: Float32Array[],
  sampleRate: number,
): Promise<void> {
  const frames = channels[0]?.length ?? 0;
  const block = Math.max(1, Math.round(sampleRate));
  for (let offset = 0; offset < frames; offset += block) {
    const end = Math.min(frames, offset + block);
    let mono = channels[0]!.subarray(offset, end);
    if (channels.length > 1) {
      const mixed = new Float32Array(end - offset);
      for (const channel of channels)
        for (let index = 0; index < mixed.length; index++)
          mixed[index]! += (channel[offset + index] ?? 0) / channels.length;
      mono = mixed;
    }
    session.push(mono, sampleRate);
    await session.sent();
    if (session.stalledBy) throw new Error(session.stalledBy);
  }
}
