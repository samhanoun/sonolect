import type { TranscriptSegment } from "./segmentEditor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpeakerProfile = {
  id: string;
  label: string;
  sampleSegments: number[];
  voicePrint?: string | undefined;
};

export type DiarizationResult = {
  segments: TranscriptSegment[];
  speakers: SpeakerProfile[];
  confidence: number;
};

// ---------------------------------------------------------------------------
// Speaker colors
// ---------------------------------------------------------------------------

const SPEAKER_COLORS = [
  "#4A90D9", // blue
  "#E57373", // red
  "#81C784", // green
  "#FFB74D", // orange
  "#BA68C8", // purple
  "#4DD0E1", // cyan
  "#F06292", // pink
  "#AED581", // lime
  "#FF8A65", // deep orange
  "#7986CB", // indigo
];

export function assignSpeakerColors(
  speakers: SpeakerProfile[],
): Record<string, string> {
  const colors: Record<string, string> = {};
  for (let i = 0; i < speakers.length; i++) {
    colors[speakers[i]!.label] = SPEAKER_COLORS[i % SPEAKER_COLORS.length]!;
  }
  return colors;
}

// ---------------------------------------------------------------------------
// Heuristic diarization
// ---------------------------------------------------------------------------

/**
 * Estimates speaker assignments based on segment patterns:
 * - Segments separated by larger silence gaps likely indicate speaker turns
 * - Segments with similar length patterns may belong to the same speaker
 * - Alternating turns are the most common meeting pattern
 */
export function estimateSpeakerFromSegments(
  segments: TranscriptSegment[],
): DiarizationResult {
  if (segments.length === 0) {
    return { segments: [], speakers: [], confidence: 0 };
  }

  // If all segments already have speakers, just collect profiles
  const allHaveSpeakers = segments.every((s) => s.speaker);
  if (allHaveSpeakers) {
    const profiles = buildSpeakerProfiles(segments);
    return { segments: [...segments], speakers: profiles, confidence: 1 };
  }

  // Calculate silence gaps between segments
  const gaps: number[] = [];
  for (let i = 1; i < segments.length; i++) {
    const gap = segments[i]!.startMs - segments[i - 1]!.endMs;
    gaps.push(gap);
  }

  // Use the median gap as threshold for speaker changes
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap =
    sortedGaps.length > 0
      ? sortedGaps[Math.floor(sortedGaps.length / 2)]!
      : 500;
  const turnThreshold = Math.max(medianGap * 1.5, 300);

  // Assign speakers based on alternating turns at silence gaps
  let currentSpeakerIndex = 0;
  const maxSpeakers = estimateSpeakerCount(segments, gaps, turnThreshold);
  const labeled: TranscriptSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    // Keep existing speaker if present
    if (seg.speaker) {
      labeled.push(seg);
      continue;
    }

    if (i > 0) {
      const gap = gaps[i - 1]!;
      if (gap >= turnThreshold) {
        currentSpeakerIndex = (currentSpeakerIndex + 1) % maxSpeakers;
      }
    }

    labeled.push({
      ...seg,
      speaker: `Speaker ${currentSpeakerIndex + 1}`,
    });
  }

  const profiles = buildSpeakerProfiles(labeled);

  // Confidence is lower for heuristic assignment
  const confidence = Math.max(
    0.3,
    Math.min(0.7, 0.5 + (gaps.length > 0 ? 0.1 : 0)),
  );

  return { segments: labeled, speakers: profiles, confidence };
}

function estimateSpeakerCount(
  segments: TranscriptSegment[],
  gaps: number[],
  turnThreshold: number,
): number {
  // Count how many speaker turns are detected
  let turnCount = 1;
  for (const gap of gaps) {
    if (gap >= turnThreshold) {
      turnCount++;
    }
  }

  // Estimate based on turn count — assume 2-4 speakers for meetings
  if (turnCount <= 2) return 2;
  if (turnCount <= 5) return 2;
  if (turnCount <= 10) return 3;
  return Math.min(4, Math.ceil(turnCount / 4));
}

function buildSpeakerProfiles(segments: TranscriptSegment[]): SpeakerProfile[] {
  const speakerMap = new Map<string, number[]>();

  for (let i = 0; i < segments.length; i++) {
    const speaker = segments[i]!.speaker;
    if (speaker) {
      const indices = speakerMap.get(speaker);
      if (indices) {
        indices.push(i);
      } else {
        speakerMap.set(speaker, [i]);
      }
    }
  }

  const profiles: SpeakerProfile[] = [];
  let profileIndex = 0;
  for (const [label, sampleSegments] of speakerMap) {
    profileIndex++;
    profiles.push({
      id: `speaker-${profileIndex}`,
      label,
      sampleSegments,
    });
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// Merge consecutive segments from same speaker
// ---------------------------------------------------------------------------

export function mergeSpeakerSegments(
  segments: TranscriptSegment[],
): TranscriptSegment[] {
  if (segments.length === 0) return [];

  const merged: TranscriptSegment[] = [];
  let current = { ...segments[0]! };

  for (let i = 1; i < segments.length; i++) {
    const next = segments[i]!;
    const sameSpeaker =
      current.speaker !== undefined &&
      next.speaker !== undefined &&
      current.speaker === next.speaker;

    if (sameSpeaker) {
      current = {
        ...current,
        text: `${current.text} ${next.text}`,
        endMs: next.endMs,
      };
    } else {
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged;
}
