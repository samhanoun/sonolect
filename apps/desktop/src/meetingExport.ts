import type { MeetingSession } from "./meetingMode";

export type MeetingExportFormat = "notes" | "transcript" | "srt" | "summary";

export function formatSrtTimestamp(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")},${millis.toString().padStart(3, "0")}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getParticipants(session: MeetingSession): string[] {
  const speakers = new Set<string>();
  for (const seg of session.segments) {
    if (seg.speaker?.trim()) speakers.add(seg.speaker.trim());
  }
  return [...speakers].sort();
}

function formatTimestampHMS(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function exportMeetingNotes(session: MeetingSession): string {
  const parts: string[] = [];
  parts.push(`# ${session.config.title}`);
  parts.push("");
  parts.push(`Date: ${session.startedAt}`);
  parts.push(`Duration: ${formatDuration(session.durationMs)}`);
  const participants = getParticipants(session);
  if (participants.length > 0) {
    parts.push(`Participants: ${participants.join(", ")}`);
  }
  parts.push(`Status: ${session.status}`);
  parts.push("");
  parts.push("## Content");
  parts.push("");
  for (const seg of session.segments) {
    const speaker = seg.speaker?.trim() || "Unknown";
    parts.push(`**${speaker}**: ${seg.text.trim()}`);
  }
  return parts.join("\n");
}

export function exportMeetingTranscript(session: MeetingSession): string {
  if (session.segments.length === 0) return "";
  return session.segments
    .map((seg) => {
      const ts = formatTimestampHMS(seg.startMs);
      const speaker = seg.speaker?.trim() || "Unknown";
      return `[${ts}] ${speaker}: ${seg.text.trim()}`;
    })
    .join("\n");
}

export function exportMeetingSrt(session: MeetingSession): string {
  if (session.segments.length === 0) return "";
  return session.segments
    .map((seg, i) => {
      const start = formatSrtTimestamp(seg.startMs);
      const end = formatSrtTimestamp(seg.endMs);
      const speaker = seg.speaker?.trim();
      const text = speaker ? `${speaker}: ${seg.text.trim()}` : seg.text.trim();
      return `${i + 1}\n${start} --> ${end}\n${text}`;
    })
    .join("\n\n");
}

export function exportMeetingSummary(session: MeetingSession): string {
  const parts: string[] = [];
  const fullText = session.segments.map((s) => s.text.trim()).join(" ");

  parts.push("## Summary");
  parts.push("");
  const sentences = fullText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  parts.push(sentences.slice(0, 3).join(" ") || "No content.");
  parts.push("");

  const keyPointPatterns = [
    /(?:^|\.\s+|\n)([^.\n]*?\b(?:important|key|critical|main|significant)\b[^.\n]*)/gi,
    /(?:^|\.\s+|\n)([^.\n]*?\b(?:note that|keep in mind|remember)\b[^.\n]*)/gi,
  ];
  const keyPoints = new Set<string>();
  for (const pattern of keyPointPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(fullText)) !== null) {
      const point = match[1]!.trim();
      if (point.length > 0) keyPoints.add(point);
    }
  }
  if (keyPoints.size > 0) {
    parts.push("## Key Points");
    parts.push("");
    for (const point of keyPoints) parts.push(`- ${point}`);
    parts.push("");
  }

  const actionPatterns = [
    /(?:^|\.\s+|\n)([^.\n]*?\b(?:need to|should|will|must)\b[^.\n]*)/gi,
    /(?:action item:\s*)([^\n.]+)/gi,
    /(?:TODO:\s*)([^\n.]+)/gi,
    /(?:task:\s*)([^\n.]+)/gi,
  ];
  const actionItems = new Set<string>();
  for (const pattern of actionPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(fullText)) !== null) {
      const item = match[1]!.trim();
      if (item.length > 0) actionItems.add(item);
    }
  }
  if (actionItems.size > 0) {
    parts.push("## Action Items");
    parts.push("");
    for (const item of actionItems) parts.push(`- [ ] ${item}`);
    parts.push("");
  }

  const decisionPattern =
    /(?:^|\.\s+|\n)([^.\n]*?\b(?:decided|agreed|conclusion|resolved|determined)\b[^.\n]*)/gi;
  const decisions = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = decisionPattern.exec(fullText)) !== null) {
    const decision = match[1]!.trim();
    if (decision.length > 0) decisions.add(decision);
  }
  if (decisions.size > 0) {
    parts.push("## Decisions");
    parts.push("");
    for (const decision of decisions) parts.push(`- ${decision}`);
    parts.push("");
  }

  const participants = getParticipants(session);
  if (participants.length > 0) {
    parts.push("## Participants");
    parts.push("");
    for (const p of participants) parts.push(`- ${p}`);
    parts.push("");
  }

  return parts.join("\n").trimEnd();
}

export function exportMeeting(
  session: MeetingSession,
  format: MeetingExportFormat,
): string {
  switch (format) {
    case "notes":
      return exportMeetingNotes(session);
    case "transcript":
      return exportMeetingTranscript(session);
    case "srt":
      return exportMeetingSrt(session);
    case "summary":
      return exportMeetingSummary(session);
  }
}
