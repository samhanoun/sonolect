import type { NoteSegment } from "./domain";
import { collapseWhitespace } from "./refine";

/**
 * When each part of a dictation was said, so a note can become subtitles.
 * Pure, so tests can drive it: captureLoop.ts feeds it the recognizer's
 * events with the loop's clock.
 *
 * Times come from the recognizer when its result carries usable segment
 * timestamps (expo-speech-recognition 58.0.1: SFTranscriptionSegment on iOS,
 * RecognitionPart on Android 14+ with on-device recognition), and from the
 * app's clock otherwise: from the first words heard (or the native
 * 'speechstart') to the final result. Those are marked approx.
 */

/** A result segment as expo-speech-recognition reports it. */
export interface EnginePart {
  /** Milliseconds from the start of the recognizer session's audio. */
  startTimeMillis: number;
  endTimeMillis: number;
  segment: string;
}

/** More segments than this in one note are not kept (the text is). */
export const MAX_SEGMENTS = 2_000;
/** Six hours: a later time is not a timing. */
export const MAX_SEGMENT_MS = 6 * 3_600_000;
/** An utterance longer than this is split at its word timings. */
export const MAX_CUE_MS = 7_000;
/** Two subtitle lines of 42 characters. */
export const MAX_CUE_CHARS = 84;
/** A pause this long between two words starts a new cue. */
export const CUE_PAUSE_MS = 700;
/**
 * How far the recognizer's times may sit from what the app saw and still be
 * used: a session clock that does not match the app's is not trusted.
 */
export const ENGINE_TOLERANCE_MS = 1_500;
/**
 * How long before the app first heard them the recognizer's words may
 * start: the delay from speech to its first interim result. Times that
 * start earlier are counted from another origin, such as the utterance.
 */
export const ENGINE_EARLY_MS = 3_000;
/** The last word of an Android result has no length: give it this much. */
const LAST_WORD_MS = 300;
/**
 * Android ends each word where the next one starts (expo-speech-recognition
 * 58.0.1, ExpoSpeechService.kt), so a pause looks like a long word: a word
 * is taken to end this long after it starts, at most.
 */
const MAX_WORD_MS = 1_500;

/** When a word ends, for cues: see LAST_WORD_MS and MAX_WORD_MS. */
function wordEnd(word: EnginePart): number {
  return Math.min(
    Math.max(word.endTimeMillis, word.startTimeMillis + LAST_WORD_MS),
    word.startTimeMillis + MAX_WORD_MS,
  );
}

const SENTENCE_END = /[.!?…؟。！？]$/;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The usable word timings of a result, or null when there are none. */
function usableParts(
  parts: readonly EnginePart[] | undefined,
): EnginePart[] | null {
  if (!parts || parts.length === 0) return null;
  const words: EnginePart[] = [];
  let previousStart = -1;
  for (const part of parts) {
    if (
      typeof part?.segment !== "string" ||
      !finite(part.startTimeMillis) ||
      !finite(part.endTimeMillis) ||
      part.startTimeMillis < 0 ||
      part.endTimeMillis < part.startTimeMillis ||
      part.startTimeMillis < previousStart
    ) {
      return null;
    }
    previousStart = part.startTimeMillis;
    if (part.segment.trim()) words.push(part);
  }
  // Partial results on the web and on iOS report every time as 0.
  if (words.length === 0 || !words.some((word) => word.endTimeMillis > 0)) {
    return null;
  }
  return words;
}

/** Cues of at most MAX_CUE_MS and MAX_CUE_CHARS, split at pauses. */
function cuesFromWords(
  words: readonly EnginePart[],
  offsetMs: number,
): NoteSegment[] {
  const cues: NoteSegment[] = [];
  let current: EnginePart[] = [];
  const flush = () => {
    const first = current[0];
    const last = current.at(-1);
    if (!first || !last) return;
    cues.push({
      startMs: offsetMs + first.startTimeMillis,
      endMs: offsetMs + wordEnd(last),
      text: collapseWhitespace(current.map((word) => word.segment).join(" ")),
    });
    current = [];
  };
  for (const word of words) {
    const first = current[0];
    const last = current.at(-1);
    if (first && last) {
      const text = current.map((item) => item.segment).join(" ");
      if (
        word.startTimeMillis - wordEnd(last) >= CUE_PAUSE_MS ||
        wordEnd(word) - first.startTimeMillis > MAX_CUE_MS ||
        text.length + 1 + word.segment.length > MAX_CUE_CHARS ||
        SENTENCE_END.test(last.segment.trim())
      ) {
        flush();
      }
    }
    current.push(word);
  }
  flush();
  return cues;
}

/**
 * Records the segments of one dictation. Mirrors TranscriptAccumulator: the
 * capture loop calls result() and commitInterim() wherever it calls them on
 * the accumulator, so the segments hold the same text as the note.
 */
export class SegmentRecorder {
  private segments: NoteSegment[] = [];
  /** Epoch ms of time 0: the first session's audio start. */
  private origin: number | null = null;
  private sessions = 0;
  /** Epoch ms the current session's audio started. */
  private sessionAt: number | null = null;
  /** When the current utterance was first heard. */
  private heardAt: number | null = null;
  /** The native 'speechstart' since the last final result. */
  private speechAt: number | null = null;
  private interim = "";

  /** A recognizer session starts now (the loop's clock). */
  sessionStarted(now: number): void {
    this.sessions += 1;
    this.origin ??= now;
    this.sessionAt = now;
    this.heardAt = null;
    this.speechAt = null;
    this.interim = "";
  }

  /**
   * Native 'audiostart': its epoch timestamp marks the session's audio, the
   * time its segment timestamps count from.
   */
  audioStarted(timestamp: unknown): void {
    if (!finite(timestamp) || this.sessions === 0) return;
    if (this.sessions === 1 && this.segments.length === 0) {
      this.origin = timestamp;
    }
    this.sessionAt = timestamp;
  }

  /** Native 'speechstart'. */
  speechStarted(now: number): void {
    this.speechAt ??= now;
  }

  /** A result of the current session, as the accumulator gets it. */
  result(
    transcript: string,
    isFinal: boolean,
    now: number,
    parts?: readonly EnginePart[],
  ): void {
    const text = transcript.trim();
    if (text && this.heardAt === null) this.heardAt = now;
    if (!isFinal) {
      this.interim = text;
      return;
    }
    this.interim = "";
    if (text) {
      const heard = Math.min(this.speechAt ?? now, this.heardAt ?? now);
      const timed = this.fromEngine(text, parts, heard, now);
      if (timed) for (const segment of timed) this.push(segment);
      else this.push(this.estimated(text, heard, now));
    }
    this.heardAt = null;
    this.speechAt = null;
  }

  /** The session ended: its interim text is kept, as the accumulator does. */
  commitInterim(now: number): void {
    if (this.interim) {
      const heard = Math.min(this.speechAt ?? now, this.heardAt ?? now);
      this.push(this.estimated(this.interim, heard, now));
    }
    this.interim = "";
    this.heardAt = null;
    this.speechAt = null;
  }

  list(): NoteSegment[] {
    return this.segments.map((segment) => ({ ...segment }));
  }

  private relative(epochMs: number): number {
    return Math.max(0, Math.round(epochMs - (this.origin ?? epochMs)));
  }

  private estimated(text: string, heard: number, now: number): NoteSegment {
    return {
      startMs: this.relative(heard),
      endMs: this.relative(now),
      text,
      approx: true,
    };
  }

  /** Segments timed by the recognizer, or null when its times don't fit. */
  private fromEngine(
    text: string,
    parts: readonly EnginePart[] | undefined,
    heard: number,
    now: number,
  ): NoteSegment[] | null {
    const words = usableParts(parts);
    if (!words || this.sessionAt === null || this.origin === null) return null;
    const offset = Math.round(this.sessionAt - this.origin);
    const first = words[0]!;
    const startMs = offset + first.startTimeMillis;
    const endMs = offset + Math.max(...words.map((word) => word.endTimeMillis));
    const lastEnd = this.segments.at(-1)?.endMs ?? 0;
    // The words were said before the result came, and started about when
    // the app first heard them, after the previous segment.
    if (
      endMs > this.relative(now) + ENGINE_TOLERANCE_MS ||
      startMs > this.relative(heard) + ENGINE_TOLERANCE_MS ||
      startMs < this.relative(heard) - ENGINE_EARLY_MS ||
      startMs < lastEnd - ENGINE_TOLERANCE_MS
    ) {
      return null;
    }
    // The cues say the result's own words, so the segments say what the
    // note says; the recognizer's words only give their times. When the two
    // do not line up word for word, the result stays one segment.
    const said = text.split(/\s+/).filter(Boolean);
    if (endMs - startMs <= MAX_CUE_MS || said.length !== words.length) {
      const last = words.at(-1)!;
      return [
        {
          startMs,
          endMs: Math.max(endMs, offset + last.startTimeMillis + LAST_WORD_MS),
          text,
        },
      ];
    }
    return cuesFromWords(
      words.map((word, index) => ({ ...word, segment: said[index]! })),
      offset,
    );
  }

  /** Whole milliseconds, as every device stores them (the desktop's are u64). */
  private push(segment: NoteSegment): void {
    if (this.segments.length >= MAX_SEGMENTS) return;
    const lastEnd = this.segments.at(-1)?.endMs ?? 0;
    const startMs = Math.max(Math.round(segment.startMs), lastEnd);
    this.segments.push({
      ...segment,
      startMs,
      endMs: Math.max(Math.round(segment.endMs), startMs),
    });
  }
}

/**
 * The segments of a stored note, or undefined when there are none worth
 * keeping. Unknown fields are dropped (security-6); a broken entry is
 * dropped, never the note. Times are kept in whole milliseconds.
 */
export function sanitizeSegments(
  value: unknown,
  maxTextLength: number,
): NoteSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const segments: NoteSegment[] = [];
  let total = 0;
  for (const item of value as unknown[]) {
    if (segments.length >= MAX_SEGMENTS) break;
    if (typeof item !== "object" || item === null) continue;
    const { startMs, endMs, text, approx } = item as Record<string, unknown>;
    if (
      !finite(startMs) ||
      !finite(endMs) ||
      startMs < 0 ||
      endMs < startMs ||
      endMs > MAX_SEGMENT_MS ||
      typeof text !== "string" ||
      !text.trim()
    ) {
      continue;
    }
    total += text.length;
    if (total > maxTextLength) break;
    segments.push({
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
      text,
      ...(approx === true ? { approx: true as const } : {}),
    });
  }
  segments.sort((left, right) => left.startMs - right.startMs);
  return segments.length > 0 ? segments : undefined;
}

const hasWords = (item: unknown): boolean =>
  typeof item === "object" &&
  item !== null &&
  typeof (item as { text?: unknown }).text === "string" &&
  (item as { text: string }).text.trim() !== "";

/**
 * The segments the phone shows for a note that came through sync: all of
 * them, or none when the phone's limits (sanitizeSegments: 2 000 segments,
 * the text limit, six hours) would drop one that has words. Subtitles of
 * part of a note would be wrong. A note with no length, or whose segments
 * all have none, shows none either: those are no times. The desktop's
 * studio gives such parts to a typed note, which lasts 0 ms. The note
 * keeps every segment for sync either way (sync/noteMapping.ts).
 */
export function segmentsToShow(
  value: unknown,
  maxTextLength: number,
  durationMs: number,
): NoteSegment[] | undefined {
  if (!Array.isArray(value) || !(durationMs > 0)) return undefined;
  const segments = sanitizeSegments(value, maxTextLength);
  if (!segments || segments.length !== value.filter(hasWords).length) {
    return undefined;
  }
  return segments.some((segment) => segment.endMs > segment.startMs)
    ? segments
    : undefined;
}

/**
 * Whether segments say the words of a text, whatever the spacing, as the
 * desktop compares a studio edit with the saved transcript (same_words in
 * local_history.rs). The desktop's studio shows a note's segments as its
 * text, so a note sends only segments that say its words.
 */
export function segmentsSayText(
  segments: readonly NoteSegment[],
  text: string,
): boolean {
  const words = (value: string) => value.split(/\s+/).filter(Boolean);
  const said = segments.flatMap((segment) => words(segment.text));
  const written = words(text);
  return (
    said.length === written.length &&
    said.every((word, index) => word === written[index])
  );
}
