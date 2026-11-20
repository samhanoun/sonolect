/**
 * A recording that is sent to the native recorder while it is being made.
 *
 * The audio never sits in the web layer: every half second goes to disk on
 * the native side, which transcribes it at pauses and reports the text as
 * `capture-partial` events. That is what lifts the old three-minute limit
 * and shows text while the user is still speaking.
 */
import {
  normalizeWhisperSegments,
  type DesktopWhisperResult,
  type DesktopWhisperSegmentPayload,
} from "./desktopWhisper";
import {
  PcmBatcher,
  PcmResampler,
  floatToPcm16,
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
};

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
  /** Sends one piece; resolves with the length recorded so far. */
  append: (captureId: string, pcm: Uint8Array) => Promise<number>;
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
  private readonly batcher = new PcmBatcher();
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

  /** Adds a block of microphone audio at the given sample rate. */
  push(block: Float32Array, sampleRate: number) {
    if (this.closed || this.stalled) return;
    if (this.resampler?.sourceRate !== sampleRate)
      this.resampler = new PcmResampler(sampleRate);
    this.handlers.onLevel?.(pcmLevel(block));
    for (const piece of this.batcher.push(
      floatToPcm16(this.resampler.push(block)),
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
