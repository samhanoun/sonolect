import type { TranscriptSegment } from "./segmentEditor";

export type TranscriptExportFormat = "txt" | "md" | "srt" | "vtt" | "json";

export type TranscriptExportOptions = {
  format: TranscriptExportFormat;
  transcript: string;
  segments?: TranscriptSegment[];
  title?: string;
  sessionId?: string | null;
  exportedAt?: string;
};

export type TranscriptExportResult = {
  content: string;
  filename: string;
  mimeType: string;
};

const MIME_BY_FORMAT: Record<TranscriptExportFormat, string> = {
  txt: "text/plain;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  srt: "application/x-subrip;charset=utf-8",
  vtt: "text/vtt;charset=utf-8",
  json: "application/json;charset=utf-8",
};

export function exportTranscript(
  options: TranscriptExportOptions,
): TranscriptExportResult {
  const format = options.format;
  return {
    filename: `transcript.${format}`,
    mimeType: MIME_BY_FORMAT[format],
    content: renderExportContent(options),
  };
}

function renderExportContent(options: TranscriptExportOptions) {
  switch (options.format) {
    case "txt":
      return options.transcript;
    case "md":
      return renderMarkdown(options.transcript, options.title);
    case "srt":
      return renderSrt(options.segments, options.transcript);
    case "vtt":
      return renderVtt(options.segments, options.transcript);
    case "json":
      return JSON.stringify(
        {
          sessionId: options.sessionId ?? null,
          title: options.title ?? null,
          transcript: options.transcript,
          segments: options.segments ?? [],
          exportedAt: options.exportedAt ?? new Date().toISOString(),
        },
        null,
        2,
      );
  }
}

function renderMarkdown(transcript: string, title?: string) {
  const body = transcript.trim();
  const heading = title?.trim();
  return heading ? `# ${heading}\n\n${body}` : body;
}

function renderSrt(
  segments: TranscriptSegment[] | undefined,
  transcript: string,
) {
  return cueSegments(segments, transcript)
    .map(
      (segment, index) =>
        `${index + 1}\n${formatCueTime(segment.startMs, ",")} --> ${formatCueTime(segment.endMs, ",")}\n${cueText(segment)}`,
    )
    .join("\n\n");
}

function renderVtt(
  segments: TranscriptSegment[] | undefined,
  transcript: string,
) {
  const cues = cueSegments(segments, transcript)
    .map(
      (segment) =>
        `${formatCueTime(segment.startMs, ".")} --> ${formatCueTime(segment.endMs, ".")}\n${cueText(segment)}`,
    )
    .join("\n\n");
  return `WEBVTT\n\n${cues}`;
}

function cueSegments(
  segments: TranscriptSegment[] | undefined,
  transcript: string,
) {
  const usable = (segments ?? []).filter((segment) => segment.text.trim());
  if (usable.length > 0) return usable;
  const text = transcript.trim();
  return text ? [{ id: "transcript", text, startMs: 0, endMs: 1000 }] : [];
}

function cueText(segment: TranscriptSegment) {
  const text = segment.text.trim();
  return segment.speaker?.trim() ? `${segment.speaker.trim()}: ${text}` : text;
}

function formatCueTime(ms: number, separator: "," | ".") {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const milliseconds = safeMs % 1000;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(
      2,
      "0",
    )}:${seconds.toString().padStart(2, "0")}${separator}${milliseconds
    .toString()
    .padStart(3, "0")}`;
}
