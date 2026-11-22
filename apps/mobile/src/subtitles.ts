import type { NoteSegment } from "./domain";
import { MAX_CUE_CHARS } from "./noteSegments";

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

/** Splits text at sentence ends, then at spaces, into parts that fit a cue. */
function splitText(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > max) {
      parts.push(current);
      current = word;
    } else {
      current = next;
    }
    if (/[.!?…؟]$/.test(word) && current.length >= max / 2) {
      parts.push(current);
      current = "";
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** At most two lines, broken at the space nearest the middle. */
export function wrapCueText(text: string, max = MAX_LINE_CHARS): string {
  if (text.length <= max) return text;
  const middle = text.length / 2;
  let best = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== " ") continue;
    if (best < 0 || Math.abs(index - middle) < Math.abs(best - middle)) {
      best = index;
    }
  }
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/**
 * The cues of a note: each segment cleaned with `clean` (the note's own
 * clean-up), long ones split with their time shared by length, in order and
 * never overlapping.
 */
export function subtitleCues(
  segments: readonly NoteSegment[],
  clean: (text: string) => string = (text) => text.trim(),
): Cue[] {
  const cues: Cue[] = [];
  for (const segment of segments) {
    const text = clean(segment.text).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const parts = splitText(text, MAX_CUE_CHARS);
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

/** "-->" would end the timing line of a cue. */
function cueSafe(text: string): string {
  return text.replace(/-->/g, "→");
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
  const header = note
    ? `WEBVTT\n\nNOTE ${note.replace(/-->/g, "→")}\n`
    : "WEBVTT\n";
  if (cues.length === 0) return header;
  return `${header}\n${cues
    .map(
      (cue) =>
        `${formatCueTime(cue.startMs, ".")} --> ${formatCueTime(cue.endMs, ".")}\n${wrapCueText(escapeVtt(cueSafe(cue.text)))}`,
    )
    .join("\n\n")}\n`;
}

/** Whether a note can be saved as subtitles. */
export function hasSubtitles(turn: { segments?: readonly NoteSegment[] }) {
  return (turn.segments?.length ?? 0) > 0;
}
