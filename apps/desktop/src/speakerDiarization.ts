export type SpeakerSegment = {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
};

export function assignSpeakersByGap(
  segments: Array<{ text: string; startMs: number; endMs: number }>,
  gapThresholdMs: number = 2000,
): SpeakerSegment[] {
  if (segments.length === 0) return [];

  let currentSpeakerIndex = 0;
  const result: SpeakerSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (i > 0) {
      const gap = seg.startMs - segments[i - 1]!.endMs;
      if (gap > gapThresholdMs) {
        currentSpeakerIndex += 1;
      }
    }
    result.push({
      speaker: `Speaker ${currentSpeakerIndex + 1}`,
      startMs: seg.startMs,
      endMs: seg.endMs,
      text: seg.text,
    });
  }

  return result;
}

export function mergeSpeakerSegments(
  segments: SpeakerSegment[],
): SpeakerSegment[] {
  if (segments.length === 0) return [];

  const result: SpeakerSegment[] = [{ ...segments[0]! }];

  for (let i = 1; i < segments.length; i++) {
    const current = segments[i]!;
    const last = result[result.length - 1]!;

    if (current.speaker === last.speaker) {
      last.endMs = current.endMs;
      last.text = `${last.text.trim()} ${current.text.trim()}`.trim();
    } else {
      result.push({ ...current });
    }
  }

  return result;
}

export function getSpeakerStats(segments: SpeakerSegment[]): Array<{
  speaker: string;
  totalMs: number;
  segmentCount: number;
  wordCount: number;
}> {
  const statsMap = new Map<
    string,
    { totalMs: number; segmentCount: number; wordCount: number }
  >();

  for (const seg of segments) {
    const existing = statsMap.get(seg.speaker);
    const words = seg.text.trim().split(/\s+/).filter(Boolean).length;
    if (existing) {
      existing.totalMs += seg.endMs - seg.startMs;
      existing.segmentCount += 1;
      existing.wordCount += words;
    } else {
      statsMap.set(seg.speaker, {
        totalMs: seg.endMs - seg.startMs,
        segmentCount: 1,
        wordCount: words,
      });
    }
  }

  return [...statsMap.entries()].map(([speaker, stats]) => ({
    speaker,
    ...stats,
  }));
}
