export type TranscriptSegment = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  speaker?: string;
  /** The saved recording this segment was spoken in, for click-to-play. */
  captureId?: string;
  /** The timing is an estimate, not what the speech engine reported. */
  approx?: boolean;
  /**
   * Joined from more than one recording. It has no audio of its own, and the
   * transcript it sits in can no longer be saved back to a single recording.
   */
  mixed?: boolean;
};

function createSegmentId(index: number, text: string) {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `seg-${index + 1}-${slug || "empty"}`;
}

function estimateDurationMs(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(750, Math.round((words / 150) * 60_000));
}

export function textToSegments(transcript: string): TranscriptSegment[] {
  let cursorMs = 0;
  return transcript
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ])/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((text, index) => {
      const startMs = index === 0 ? 0 : cursorMs + 200;
      const endMs = startMs + estimateDurationMs(text);
      cursorMs = endMs;
      return {
        id: createSegmentId(index, text),
        text,
        startMs,
        endMs,
      };
    });
}

export function segmentsToText(segments: TranscriptSegment[]) {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function mergeTranscriptSegments(
  segments: TranscriptSegment[],
  firstId: string,
  secondId: string,
): TranscriptSegment[] {
  return mergeSegmentRun(segments, [firstId, secondId]);
}

export function splitTranscriptSegment(
  segments: TranscriptSegment[],
  segmentId: string,
  splitIndex: number,
): TranscriptSegment[] {
  const index = segments.findIndex((segment) => segment.id === segmentId);
  if (index === -1) return segments;

  const segment = segments[index]!;
  const before = segment.text.slice(0, splitIndex).trim();
  const after = segment.text.slice(splitIndex).trim();
  if (!before || !after) return segments;

  const totalLength = before.length + after.length;
  const ratio = before.length / totalLength;
  const splitMs = Math.max(
    segment.startMs + 1,
    Math.min(
      segment.endMs - 1,
      Math.round(segment.startMs + (segment.endMs - segment.startMs) * ratio),
    ),
  );

  const first: TranscriptSegment = {
    ...segment,
    id: `${segment.id}-a`,
    text: before,
    endMs: splitMs,
  };
  const second: TranscriptSegment = {
    ...segment,
    id: `${segment.id}-b`,
    text: after,
    startMs: splitMs,
  };

  return [
    ...segments.slice(0, index),
    first,
    second,
    ...segments.slice(index + 1),
  ];
}

export function assignSpeakerLabel(
  segment: TranscriptSegment,
  speaker: string,
): TranscriptSegment {
  const clean = speaker.trim();
  if (!clean) {
    const { speaker: _speaker, ...rest } = segment;
    return rest;
  }
  return { ...segment, speaker: clean };
}

/** The paragraphs of a transcript, as the text editor shows its segments. */
function paragraphs(transcript: string) {
  return transcript
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Keeps timings, speakers and audio links when the transcript is edited as
 * plain text. Paragraphs that did not change keep their segment. The changed
 * stretch in between shares the time span of the segments it replaces, in
 * proportion to the length of each new paragraph.
 *
 * Text that never came from a recording has nothing to keep, so it is simply
 * split into segments again.
 */
export function resyncSegments(
  previous: TranscriptSegment[],
  transcript: string,
): TranscriptSegment[] {
  if (!previous.some((segment) => segment.captureId))
    return textToSegments(transcript);
  const next = paragraphs(transcript);
  const old = previous.filter((segment) => segment.text.trim());

  let head = 0;
  while (
    head < old.length &&
    head < next.length &&
    old[head]!.text.trim() === next[head]
  )
    head += 1;
  let tail = 0;
  while (
    tail < old.length - head &&
    tail < next.length - head &&
    old[old.length - 1 - tail]!.text.trim() === next[next.length - 1 - tail]
  )
    tail += 1;

  const replaced = old.slice(head, old.length - tail);
  const inserted = next.slice(head, next.length - tail);
  // Inside the changed stretch, paragraphs that still match keep their
  // segment too; only the gaps between them are re-timed.
  const middle: TranscriptSegment[] = [];
  let from = 0;
  let to = 0;
  const anchors = [
    ...unchangedPairs(
      replaced.map((segment) => segment.text.trim()),
      inserted,
    ),
    [replaced.length, inserted.length] as const,
  ];
  for (const [oldIndex, newIndex] of anchors) {
    middle.push(
      ...redistribute(
        replaced.slice(from, oldIndex),
        inserted.slice(to, newIndex),
        middle[middle.length - 1] ?? old[head - 1],
      ),
    );
    if (oldIndex < replaced.length) middle.push(replaced[oldIndex]!);
    from = oldIndex + 1;
    to = newIndex + 1;
  }
  const ids = new Set<string>();
  return [
    ...old.slice(0, head),
    ...middle,
    ...old.slice(old.length - tail),
  ].map((segment) => {
    let id = segment.id;
    while (ids.has(id)) id = `${id}-x`;
    ids.add(id);
    return id === segment.id ? segment : { ...segment, id };
  });
}

/** Index pairs of the longest run of paragraphs both versions share, in order. */
function unchangedPairs(
  before: string[],
  after: string[],
): (readonly [number, number])[] {
  // Far beyond any hand edit; such a rewrite is re-timed as one stretch.
  if (!before.length || !after.length || before.length * after.length > 250_000)
    return [];
  const width = after.length + 1;
  const lengths = new Uint16Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i -= 1)
    for (let j = after.length - 1; j >= 0; j -= 1)
      lengths[i * width + j] =
        before[i] === after[j]
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(
              lengths[(i + 1) * width + j]!,
              lengths[i * width + j + 1]!,
            );
  const pairs: (readonly [number, number])[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)
      i += 1;
    else j += 1;
  }
  return pairs;
}

function redistribute(
  replaced: TranscriptSegment[],
  inserted: string[],
  before: TranscriptSegment | undefined,
): TranscriptSegment[] {
  if (!inserted.length) return [];
  // One paragraph edited in place keeps everything but its text.
  if (replaced.length === inserted.length)
    return replaced.map((segment, index) => ({
      ...segment,
      text: inserted[index]!,
    }));
  if (!replaced.length) {
    // New paragraphs have no audio of their own; they sit at the cut.
    const at = before?.endMs ?? 0;
    return inserted.map((text, index) => ({
      id: `${createSegmentId(index, text)}-new-${at}`,
      text,
      startMs: at,
      endMs: at,
      approx: true,
    }));
  }
  const first = replaced[0]!;
  const last = replaced[replaced.length - 1]!;
  const sameCapture = replaced.every(
    (segment) => segment.captureId === first.captureId,
  );
  const mixed = fromSeveralRecordings(replaced);
  const sameSpeaker = replaced.every(
    (segment) => segment.speaker === first.speaker,
  );
  const startMs = sameCapture ? first.startMs : 0;
  const span = sameCapture ? Math.max(0, last.endMs - first.startMs) : 0;
  const total = inserted.reduce((sum, text) => sum + text.length, 0) || 1;
  let cursor = startMs;
  let used = 0;
  return inserted.map((text, index) => {
    used += text.length;
    const endMs =
      index === inserted.length - 1
        ? startMs + span
        : Math.round(startMs + (span * used) / total);
    const segment: TranscriptSegment = {
      id: `${first.id}-r${index + 1}`,
      text,
      startMs: cursor,
      endMs,
      approx: true,
    };
    if (sameCapture && !mixed && first.captureId)
      segment.captureId = first.captureId;
    if (mixed) segment.mixed = true;
    if (sameSpeaker && first.speaker) segment.speaker = first.speaker;
    cursor = endMs;
    return segment;
  });
}

/**
 * Whether these segments were spoken in more than one recording. Typed text
 * has no recording and does not count.
 */
function fromSeveralRecordings(segments: TranscriptSegment[]): boolean {
  const ids = new Set(
    segments.map((segment) => segment.captureId).filter(Boolean),
  );
  return ids.size > 1 || segments.some((segment) => segment.mixed);
}

export type SavedCaptureSegment = {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string | null;
};

/**
 * The editor segments of one saved recording. A recording transcribed online
 * has no timings, so its sentences are spread over its length by their size
 * and marked as estimates.
 */
export function segmentsFromCapture(capture: {
  id: string;
  durationMs: number;
  transcript: string | null;
  segments?: SavedCaptureSegment[] | null;
}): TranscriptSegment[] {
  const saved = (capture.segments ?? []).filter((segment) =>
    segment.text.trim(),
  );
  if (saved.length)
    return saved.map((segment, index) => {
      const startMs = Math.max(0, Math.round(segment.startMs));
      const next: TranscriptSegment = {
        id: `capture-${capture.id}-${index + 1}`,
        text: segment.text.trim(),
        startMs,
        endMs: Math.max(startMs, Math.round(segment.endMs)),
        captureId: capture.id,
      };
      const speaker = segment.speaker?.trim();
      if (speaker) next.speaker = speaker;
      return next;
    });

  const parts = textToSegments(capture.transcript ?? "");
  const total = parts.reduce((sum, part) => sum + part.text.length, 0) || 1;
  const duration = Math.max(0, Math.round(capture.durationMs));
  let used = 0;
  let cursor = 0;
  return parts.map((part, index) => {
    used += part.text.length;
    const endMs =
      index === parts.length - 1
        ? duration
        : Math.round((duration * used) / total);
    const segment: TranscriptSegment = {
      id: `capture-${capture.id}-${index + 1}`,
      text: part.text,
      startMs: cursor,
      endMs,
      captureId: capture.id,
      approx: true,
    };
    cursor = endMs;
    return segment;
  });
}

/** Moves a segment one place up or down. */
export function moveTranscriptSegment(
  segments: TranscriptSegment[],
  segmentId: string,
  direction: "up" | "down",
): TranscriptSegment[] {
  const index = segments.findIndex((segment) => segment.id === segmentId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= segments.length) return segments;
  const next = [...segments];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/**
 * The selected segments in transcript order when they sit next to each other
 * and can be merged, otherwise nothing.
 */
export function mergeableRun(
  segments: TranscriptSegment[],
  selectedIds: string[],
): TranscriptSegment[] {
  const indexes = segments
    .map((segment, index) => (selectedIds.includes(segment.id) ? index : -1))
    .filter((index) => index !== -1);
  if (indexes.length < 2) return [];
  const contiguous = indexes.every(
    (index, position) => position === 0 || index === indexes[position - 1]! + 1,
  );
  return contiguous ? indexes.map((index) => segments[index]!) : [];
}

/** Merges a run of neighbouring segments into one. */
export function mergeSegmentRun(
  segments: TranscriptSegment[],
  selectedIds: string[],
): TranscriptSegment[] {
  const run = mergeableRun(segments, selectedIds);
  if (!run.length) return segments;
  const first = run[0]!;
  const text = run
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
  let merged: TranscriptSegment;
  if (fromSeveralRecordings(run)) {
    // Recordings share no timeline: the result belongs to none of them.
    merged = {
      id: first.id,
      text,
      startMs: first.startMs,
      endMs: first.endMs,
      approx: true,
      mixed: true,
    };
  } else {
    // Segments can be moved, so the first one shown is not always the first
    // one spoken: the merged range covers all the audio it came from.
    const recorded = run.filter((segment) => segment.captureId);
    const timed = recorded.length ? recorded : run;
    merged = {
      id: first.id,
      text,
      startMs: Math.min(...timed.map((segment) => segment.startMs)),
      endMs: Math.max(...timed.map((segment) => segment.endMs)),
    };
    const captureId = recorded[0]?.captureId;
    if (captureId) merged.captureId = captureId;
    if (run.some((segment) => segment.approx)) merged.approx = true;
  }
  const speaker = run.find((segment) => segment.speaker)?.speaker;
  if (speaker) merged.speaker = speaker;
  const start = segments.indexOf(first);
  return [
    ...segments.slice(0, start),
    merged,
    ...segments.slice(start + run.length),
  ];
}

/** The speaker names in use, in order of first appearance. */
export function speakerNames(segments: TranscriptSegment[]): string[] {
  const names: string[] = [];
  for (const segment of segments) {
    const name = segment.speaker?.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** How many colours the studio has for speakers. */
export const SPEAKER_COLOR_COUNT = 6;

/** The colour slot of a speaker: stable while the speaker list is. */
export function speakerColorIndex(
  segments: TranscriptSegment[],
  speaker: string | undefined,
): number | undefined {
  const name = speaker?.trim();
  if (!name) return undefined;
  const index = speakerNames(segments).indexOf(name);
  return index === -1 ? undefined : index % SPEAKER_COLOR_COUNT;
}

/** 83 000 ms as "1:23", and with hours once a recording needs them. */
export function formatTimestamp(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

/** The segment being spoken at a playback position, if any. */
export function segmentAtTime(
  segments: TranscriptSegment[],
  captureId: string | undefined,
  positionMs: number,
): string | undefined {
  if (!captureId) return undefined;
  let current: string | undefined;
  for (const segment of segments) {
    if (segment.captureId !== captureId) continue;
    if (segment.startMs <= positionMs) {
      if (positionMs < segment.endMs) return segment.id;
      // Between two segments the one just heard stays highlighted.
      current = segment.id;
    }
  }
  return current;
}

/**
 * The recording an edited transcript can be saved back to: the one every
 * recorded segment belongs to. A transcript built from several recordings has
 * no single home.
 */
export function singleCaptureId(
  segments: TranscriptSegment[],
): string | undefined {
  if (fromSeveralRecordings(segments)) return undefined;
  return segments.find((segment) => segment.captureId)?.captureId;
}
