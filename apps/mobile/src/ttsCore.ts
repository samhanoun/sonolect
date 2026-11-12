/**
 * Read-aloud logic, pure so it is tested without a device. tts.ts wires it
 * to expo-speech 58 and the iOS audio session.
 *
 * - Android's TextToSpeech refuses text longer than its limit (4000
 *   characters) and expo-speech 58 leaves that rejection unhandled, so long
 *   text is spoken in chunks (speech-5, ux-10).
 * - One controller owns playback for the whole app: a Stop anywhere stops
 *   it, a callback from a replaced utterance never changes the state
 *   (speech-14), and the iOS audio session is taken and given back once per
 *   playback (speech-6, ios-5).
 */

/** The largest chunk spoken at once, below Android's 4000 characters. */
export const MAX_TTS_CHUNK = 3900;

/** Sentence ends: Latin, Arabic and full-width CJK. */
const SENTENCE_ENDS = new Set([".", "!", "?", "…", "؟", "。", "！", "？"]);

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Where to end the next chunk of `text`, which is longer than `limit`. */
function cutPoint(text: string, limit: number): number {
  // After the last sentence end that is followed by a space.
  for (let i = limit - 1; i > 0; i -= 1) {
    if (SENTENCE_ENDS.has(text.charAt(i)) && text.charAt(i + 1) === " ") {
      return i + 1;
    }
  }
  // At the last space; one at `limit` still leaves a full chunk before it.
  const space = text.lastIndexOf(" ", limit);
  if (space > 0) return space;
  // Text without spaces, such as Chinese or Japanese: after a sentence end.
  for (let i = limit - 1; i > 0; i -= 1) {
    if (SENTENCE_ENDS.has(text.charAt(i))) return i + 1;
  }
  // One very long word: cut it, but never inside a surrogate pair.
  return limit > 1 && isHighSurrogate(text.charCodeAt(limit - 1))
    ? limit - 1
    : limit;
}

/**
 * Splits text into chunks of at most min(MAX_TTS_CHUNK, maxInputLength)
 * characters: after a sentence end, otherwise at the last space, otherwise
 * hard at the limit. Whitespace is collapsed to single spaces, chunks are
 * never empty, and except after a hard cut the chunks joined with spaces
 * equal the collapsed text.
 */
export function chunkForSpeech(text: string, maxInputLength: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const engineLimit = maxInputLength > 0 ? maxInputLength : MAX_TTS_CHUNK;
  const limit = Math.max(1, Math.floor(Math.min(MAX_TTS_CHUNK, engineLimit)));
  const chunks: string[] = [];
  let rest = normalized;
  while (rest.length > limit) {
    const cut = cutPoint(rest, limit);
    const chunk = rest.slice(0, cut).trimEnd();
    if (chunk) chunks.push(chunk);
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export type TtsStatus = "idle" | "playing" | "paused";

export interface TtsState {
  readonly status: TtsStatus;
  /** What is being read: a note id, or the Reader. Null when idle. */
  readonly ownerId: string | null;
}

export interface TtsSpeakOptions {
  language?: string | undefined;
  rate?: number | undefined;
  /** A voice identifier from the engine's voice list. */
  voice?: string | undefined;
}

export interface TtsUtteranceCallbacks {
  /** Only the last chunk has it. */
  onDone?: () => void;
  onStopped: () => void;
  onError: () => void;
}

export interface TtsDeps {
  /** Queues one utterance after the ones already queued. */
  speak(
    text: string,
    options: TtsSpeakOptions,
    callbacks: TtsUtteranceCallbacks,
  ): void;
  /** Stops speaking and empties the queue. */
  stop(): Promise<void> | void;
  pause(): Promise<void> | void;
  resume(): Promise<void> | void;
  /** The engine's limit per utterance (expo-speech maxSpeechInputLength). */
  maxInputLength: number;
  /** Takes the audio session for playback (iOS). */
  beforeSpeak(): void;
  /** Gives the audio session back, once the engine has stopped (iOS). */
  afterSpeak(): void;
  /** False while reading aloud is not allowed, such as during a dictation. */
  canPlay?(): boolean;
}

export interface TtsController {
  /**
   * Reads text aloud for ownerId, replacing whatever was playing. False
   * when there is nothing to read or playing is not allowed now.
   */
  play(ownerId: string, text: string, options?: TtsSpeakOptions): boolean;
  /**
   * Stops at once. The promise resolves once the engine has stopped and
   * the audio session is given back.
   */
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getState(): TtsState;
  /** For useSyncExternalStore. */
  subscribe(listener: () => void): () => void;
}

export const IDLE_TTS_STATE: TtsState = { status: "idle", ownerId: null };

function settle(run: () => Promise<void> | void): Promise<void> {
  try {
    return Promise.resolve(run()).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

export function createTtsController(deps: TtsDeps): TtsController {
  /**
   * Changes at every play and every end. A callback acts only while its
   * utterance's token is still current: Android reports the stop of the
   * replaced utterance after the new one has started (speech-14).
   */
  let token = 0;
  let state: TtsState = IDLE_TTS_STATE;
  /** beforeSpeak ran and afterSpeak has not yet. */
  let held = false;
  /** The last stop of the engine, with its release. */
  let settling: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const setState = (next: TtsState) => {
    if (next.status === state.status && next.ownerId === state.ownerId) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const release = () => {
    if (!held) return;
    held = false;
    try {
      deps.afterSpeak();
    } catch {
      // The session stays as it is; the next dictation or playback sets it.
    }
  };

  /**
   * Stops the engine, then gives the session back, unless a new playback
   * started meanwhile: it keeps the session.
   */
  const stopEngine = (): Promise<void> => {
    const stoppedAt = token;
    settling = settle(() => deps.stop()).then(() => {
      if (token === stoppedAt) release();
    });
    return settling;
  };

  const end = (
    utteranceToken: number,
    how: "done" | "stopped" | "error",
  ): void => {
    if (utteranceToken !== token) return;
    token += 1;
    setState(IDLE_TTS_STATE);
    // After an error the rest of the queue must not keep playing.
    if (how === "error") void stopEngine();
    else release();
  };

  return {
    play(ownerId, text, options = {}) {
      const chunks = chunkForSpeech(text, deps.maxInputLength);
      if (chunks.length === 0) return false;
      if (deps.canPlay && !deps.canPlay()) return false;
      token += 1;
      const current = token;
      // Android queues with QUEUE_ADD: the new text would otherwise play
      // after the old one.
      void settle(() => deps.stop());
      if (!held) {
        held = true;
        try {
          deps.beforeSpeak();
        } catch {
          // Playback still works on the session as it is.
        }
      }
      setState({ status: "playing", ownerId });
      chunks.forEach((chunk, index) => {
        if (current !== token) return;
        const callbacks: TtsUtteranceCallbacks = {
          // On iOS a stop cancels only the current utterance, so every
          // chunk reports its stop and errors.
          onStopped: () => end(current, "stopped"),
          onError: () => end(current, "error"),
          ...(index === chunks.length - 1
            ? { onDone: () => end(current, "done") }
            : {}),
        };
        try {
          deps.speak(chunk, options, callbacks);
        } catch {
          end(current, "error");
        }
      });
      return current === token;
    },

    stop() {
      if (state.status === "idle") return settling;
      token += 1;
      setState(IDLE_TTS_STATE);
      return stopEngine();
    },

    async pause() {
      if (state.status !== "playing") return;
      const current = token;
      try {
        await deps.pause();
      } catch {
        return;
      }
      if (current === token && state.status === "playing") {
        setState({ status: "paused", ownerId: state.ownerId });
      }
    },

    async resume() {
      if (state.status !== "paused") return;
      const current = token;
      try {
        await deps.resume();
      } catch {
        return;
      }
      if (current === token && state.status === "paused") {
        setState({ status: "playing", ownerId: state.ownerId });
      }
    },

    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A voice as expo-speech lists it. */
export interface TtsVoice {
  identifier: string;
  name: string;
  /** 'Enhanced' or 'Default'. */
  quality: string;
  language: string;
}

/** The most voice chips the Reader shows. */
export const MAX_VOICES = 6;

function baseLanguage(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0] ?? "";
}

/**
 * The voices for a language: same base language, enhanced first, then the
 * same region, at most MAX_VOICES. On Android, network voices are left out:
 * they send the text to Google.
 */
export function filterVoices<V extends TtsVoice>(
  voices: readonly V[],
  language: string,
  platform: string,
): V[] {
  const base = baseLanguage(language);
  const tag = language.toLowerCase();
  const rank = (voice: V) =>
    (voice.quality === "Enhanced" ? 0 : 2) +
    (voice.language.toLowerCase() === tag ? 0 : 1);
  return voices
    .filter(
      (voice) =>
        typeof voice.language === "string" &&
        baseLanguage(voice.language) === base &&
        !(platform === "android" && /network/i.test(voice.identifier)),
    )
    .map((voice, index) => ({ voice, index }))
    .sort((a, b) => rank(a.voice) - rank(b.voice) || a.index - b.index)
    .slice(0, MAX_VOICES)
    .map(({ voice }) => voice);
}

/**
 * A voice chip's label. Android names voices with identifiers such as
 * 'fr-fr-x-frc-local', so it gets the language, quality and a number.
 */
export function voiceLabel(
  voice: TtsVoice,
  index: number,
  t: { reader: { qualityEnhanced: string; qualityStandard: string } },
  platform: string,
): string {
  if (platform !== "android") return voice.name;
  const quality =
    voice.quality === "Enhanced"
      ? t.reader.qualityEnhanced
      : t.reader.qualityStandard;
  return `${voice.language} · ${quality} ${index + 1}`;
}

/** '1.25×' in English, '1,25×' in French; undefined: the device's format. */
export function formatRate(rate: number, locale: string | undefined): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(rate)}×`;
}
