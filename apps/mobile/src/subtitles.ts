import type { NoteSegment } from "./domain";
import { MAX_CUE_CHARS } from "./noteSegments";
import type { CleanedRun } from "./refine";

/**
 * A dictated note as SubRip (.srt) or WebVTT (.vtt) subtitles, from the
 * segments the capture loop timed (noteSegments.ts). Pure, so it is tested
 * without a device.
 */

export const SUBTITLE_FORMATS = ["srt", "vtt"] as const;
export type SubtitleFormat = (typeof SUBTITLE_FORMATS)[number];

/** How a subtitle file is named and how the share sheet sees it. */
export const SUBTITLE_FILE_TYPES: Record<
  SubtitleFormat,
  { extension: string; mimeType: string; uti: string }
> = {
  // iOS declares no type for either: they are shared as text files.
  srt: {
    extension: "srt",
    mimeType: "application/x-subrip",
    uti: "public.plain-text",
  },
  vtt: { extension: "vtt", mimeType: "text/vtt", uti: "public.plain-text" },
};

export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

/** A cue is on screen at least this long. */
export const MIN_CUE_MS = 700;
/** One subtitle line. */
export const MAX_LINE_CHARS = 42;
/** Lines in one cue. */
export const MAX_CUE_LINES = 2;

/**
 * Words packed into lines of at most `max` characters, each line as full
 * as it can be. A word longer than a line is a line of its own.
 */
function packLines(words: readonly string[], max: number): string[] {
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= max) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

/**
 * Splits text into parts that fit a cue: at most two lines of 42
 * characters, and a part ends at a sentence end once it is half full.
 */
function splitText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    if (
      current.length > 0 &&
      packLines([...current, word], MAX_LINE_CHARS).length > MAX_CUE_LINES
    ) {
      parts.push(current.join(" "));
      current = [];
    }
    current.push(word);
    if (
      /[.!?…؟]$/.test(word) &&
      current.join(" ").length >= MAX_CUE_CHARS / 2
    ) {
      parts.push(current.join(" "));
      current = [];
    }
  }
  if (current.length > 0) parts.push(current.join(" "));
  return parts;
}

/**
 * At most two lines of `max` characters, broken at the space nearest the
 * middle that keeps both lines short enough. A cue that cannot fit two
 * lines (a word longer than a line) is packed line by line.
 */
export function wrapCueText(text: string, max = MAX_LINE_CHARS): string {
  if (text.length <= max) return text;
  const middle = text.length / 2;
  let best = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== " ") continue;
    if (index > max || text.length - index - 1 > max) continue;
    if (best < 0 || Math.abs(index - middle) < Math.abs(best - middle)) {
      best = index;
    }
  }
  if (best >= 0) return `${text.slice(0, best)}\n${text.slice(best + 1)}`;
  return packLines(text.split(" ").filter(Boolean), max).join("\n");
}

/** Each segment as it was said, only trimmed. */
function asSaid(texts: readonly string[]): CleanedRun[] {
  return texts.map((text, index) => ({
    first: index,
    last: index,
    text: text.trim(),
  }));
}

/**
 * The cues of a note, in order and never overlapping. `clean` is the
 * note's clean-up over the segments in time order (cleanParts in
 * refine.ts), so a sentence or a dictionary phrase that goes on into the
 * next segment reads as it does in the note. Segments it cleans as one run
 * share their time; long runs are split with their time shared by length.
 */
export function subtitleCues(
  segments: readonly NoteSegment[],
  clean: (texts: readonly string[]) => readonly CleanedRun[] = asSaid,
): Cue[] {
  const ordered = [...segments].sort(
    (left, right) => left.startMs - right.startMs,
  );
  const cues: Cue[] = [];
  for (const run of clean(ordered.map((segment) => segment.text))) {
    const covered = ordered.slice(run.first, run.last + 1);
    const first = covered[0];
    if (!first) continue;
    const segment = {
      startMs: first.startMs,
      endMs: Math.max(...covered.map((item) => item.endMs)),
    };
    const text = run.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const parts = splitText(text);
    const span = Math.max(0, segment.endMs - segment.startMs);
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    let at = segment.startMs;
    for (const part of parts) {
      const length = total > 0 ? (span * part.length) / total : 0;
      cues.push({
        startMs: Math.round(at),
        endMs: Math.round(at + length),
        text: part,
      });
      at += length;
    }
  }
  cues.sort((left, right) => left.startMs - right.startMs);
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index]!;
    const previous = cues[index - 1];
    if (previous && cue.startMs < previous.endMs) cue.startMs = previous.endMs;
    const next = cues[index + 1];
    const longest = next ? Math.max(next.startMs, cue.startMs) : Infinity;
    cue.endMs = Math.min(
      Math.max(cue.endMs, cue.startMs + MIN_CUE_MS),
      longest,
    );
    if (cue.endMs <= cue.startMs) cue.endMs = cue.startMs + 1;
  }
  return cues;
}

/** HH:MM:SS,mmm (SRT) or HH:MM:SS.mmm (WebVTT). */
export function formatCueTime(ms: number, separator: "," | "."): string {
  const safe = Math.max(0, Math.round(ms));
  const pad = (value: number, size = 2) => value.toString().padStart(size, "0");
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(safe % 1000, 3)}`;
}

/**
 * "-->" is the arrow of a cue's timing line, so it cannot appear in a cue
 * or a NOTE. A plain string split, not a pattern: this is subtitle syntax,
 * and no HTML is filtered here (WebVTT text is escaped by escapeVtt).
 */
function cueSafe(text: string): string {
  return text.split("-->").join("→");
}

export function toSrt(cues: readonly Cue[]): string {
  if (cues.length === 0) return "";
  return `${cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatCueTime(cue.startMs, ",")} --> ${formatCueTime(cue.endMs, ",")}\n${wrapCueText(cueSafe(cue.text))}`,
    )
    .join("\n\n")}\n`;
}

function escapeVtt(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** WebVTT; `note` becomes a NOTE block, such as "timings are approximate". */
export function toVtt(cues: readonly Cue[], note?: string): string {
  const header = note ? `WEBVTT\n\nNOTE ${cueSafe(note)}\n` : "WEBVTT\n";
  if (cues.length === 0) return header;
  return `${header}\n${cues
    .map(
      (cue) =>
        `${formatCueTime(cue.startMs, ".")} --> ${formatCueTime(cue.endMs, ".")}\n${escapeVtt(wrapCueText(cueSafe(cue.text)))}`,
    )
    .join("\n\n")}\n`;
}

/** Whether a note can be saved as subtitles. */
export function hasSubtitles(turn: { segments?: readonly NoteSegment[] }) {
  return (turn.segments?.length ?? 0) > 0;
}
