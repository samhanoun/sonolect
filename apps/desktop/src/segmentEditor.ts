export type TranscriptSegment = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  speaker?: string;
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
  const firstIndex = segments.findIndex((segment) => segment.id === firstId);
  const secondIndex = segments.findIndex((segment) => segment.id === secondId);
  if (
    firstIndex === -1 ||
    secondIndex === -1 ||
    Math.abs(firstIndex - secondIndex) !== 1
  ) {
    return segments;
  }

  const lowerIndex = Math.min(firstIndex, secondIndex);
  const upperIndex = Math.max(firstIndex, secondIndex);
  const first = segments[lowerIndex]!;
  const second = segments[upperIndex]!;
  const merged: TranscriptSegment = {
    ...first,
    text: `${first.text.trim()} ${second.text.trim()}`.trim(),
    endMs: second.endMs,
  };
  const speaker = first.speaker || second.speaker;
  if (speaker) merged.speaker = speaker;

  return [
    ...segments.slice(0, lowerIndex),
    merged,
    ...segments.slice(upperIndex + 1),
  ];
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
