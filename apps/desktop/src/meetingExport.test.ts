import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  exportMeetingNotes,
  exportMeetingTranscript,
  exportMeetingSrt,
  exportMeetingSummary,
  exportMeeting,
  formatSrtTimestamp,
} from "./meetingExport";

type TranscriptSegment = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  speaker?: string;
};

type MeetingSession = {
  id: string;
  config: {
    title: string;
    language: string;
    speakerCount: number;
    autoSave: boolean;
  };
  status: "idle" | "active" | "paused" | "ending" | "completed";
  startedAt: string;
  endedAt?: string;
  segments: TranscriptSegment[];
  durationMs: number;
};

function makeMockSession(segments: TranscriptSegment[] = []): MeetingSession {
  const durationMs =
    segments.length > 0 ? Math.max(...segments.map((s) => s.endMs)) : 0;
  return {
    id: "meeting-1",
    config: {
      title: "Sprint Review",
      language: "en",
      speakerCount: 2,
      autoSave: true,
    },
    status: "completed",
    startedAt: "2026-05-09T10:00:00.000Z",
    endedAt: "2026-05-09T10:30:00.000Z",
    segments,
    durationMs,
  };
}

const threeSegments: TranscriptSegment[] = [
  {
    id: "s1",
    text: "We need to review the sprint goals.",
    startMs: 0,
    endMs: 5000,
    speaker: "Alice",
  },
  {
    id: "s2",
    text: "I agreed we should focus on performance.",
    startMs: 5500,
    endMs: 12000,
    speaker: "Bob",
  },
  {
    id: "s3",
    text: "Action item: update the dashboard by Friday.",
    startMs: 12500,
    endMs: 18000,
    speaker: "Alice",
  },
];

const session = makeMockSession(threeSegments);
const emptySession = makeMockSession();

describe("formatSrtTimestamp", () => {
  it("converts milliseconds to SRT timestamp format", () => {
    assert.equal(formatSrtTimestamp(0), "00:00:00,000");
    assert.equal(formatSrtTimestamp(1234), "00:00:01,234");
    assert.equal(formatSrtTimestamp(3661999), "01:01:01,999");
    assert.equal(formatSrtTimestamp(60000), "00:01:00,000");
  });

  it("handles negative values", () => {
    assert.equal(formatSrtTimestamp(-500), "00:00:00,000");
  });
});

describe("exportMeetingNotes", () => {
  it("includes title, date, duration, participants, and content", () => {
    const notes = exportMeetingNotes(session);
    assert.ok(notes.includes("# Sprint Review"));
    assert.ok(notes.includes("Date: 2026-05-09T10:00:00.000Z"));
    assert.ok(notes.includes("Duration:"));
    assert.ok(notes.includes("Alice"));
    assert.ok(notes.includes("Bob"));
    assert.ok(notes.includes("## Content"));
    assert.ok(notes.includes("**Alice**: We need to review the sprint goals."));
    assert.ok(
      notes.includes("**Bob**: I agreed we should focus on performance."),
    );
  });

  it("handles empty meeting", () => {
    const notes = exportMeetingNotes(emptySession);
    assert.ok(notes.includes("# Sprint Review"));
    assert.ok(!notes.includes("Participants:"));
  });
});

describe("exportMeetingTranscript", () => {
  it("produces timestamped transcript lines", () => {
    const transcript = exportMeetingTranscript(session);
    assert.ok(
      transcript.includes(
        "[00:00:00] Alice: We need to review the sprint goals.",
      ),
    );
    assert.ok(
      transcript.includes(
        "[00:00:05] Bob: I agreed we should focus on performance.",
      ),
    );
    assert.ok(
      transcript.includes(
        "[00:00:12] Alice: Action item: update the dashboard by Friday.",
      ),
    );
  });

  it("returns empty string for empty meeting", () => {
    assert.equal(exportMeetingTranscript(emptySession), "");
  });
});

describe("exportMeetingSrt", () => {
  it("produces valid SRT format", () => {
    const srt = exportMeetingSrt(session);
    const blocks = srt.split("\n\n");
    assert.equal(blocks.length, 3);

    assert.match(
      blocks[0]!,
      /^1\n00:00:00,000 --> 00:00:05,000\nAlice: We need to review the sprint goals\.$/,
    );
    assert.match(
      blocks[1]!,
      /^2\n00:00:05,500 --> 00:00:12,000\nBob: I agreed we should focus on performance\.$/,
    );
    assert.match(
      blocks[2]!,
      /^3\n00:00:12,500 --> 00:00:18,000\nAlice: Action item: update the dashboard by Friday\.$/,
    );
  });

  it("returns empty string for empty meeting", () => {
    assert.equal(exportMeetingSrt(emptySession), "");
  });
});

describe("exportMeetingSummary", () => {
  it("includes summary section", () => {
    const summary = exportMeetingSummary(session);
    assert.ok(summary.includes("## Summary"));
  });

  it("extracts action items via regex", () => {
    const summary = exportMeetingSummary(session);
    assert.ok(summary.includes("## Action Items"));
    assert.ok(summary.includes("update the dashboard by Friday"));
  });

  it("extracts decisions via regex", () => {
    const summary = exportMeetingSummary(session);
    assert.ok(summary.includes("## Decisions"));
    assert.ok(summary.includes("agreed"));
  });

  it("includes participants", () => {
    const summary = exportMeetingSummary(session);
    assert.ok(summary.includes("## Participants"));
    assert.ok(summary.includes("- Alice"));
    assert.ok(summary.includes("- Bob"));
  });
});

describe("exportMeeting dispatch", () => {
  it("dispatches to notes format", () => {
    const result = exportMeeting(session, "notes");
    assert.ok(result.includes("# Sprint Review"));
  });

  it("dispatches to transcript format", () => {
    const result = exportMeeting(session, "transcript");
    assert.ok(result.includes("[00:00:00]"));
  });

  it("dispatches to srt format", () => {
    const result = exportMeeting(session, "srt");
    assert.match(result, /1\n00:00:00,000 --> 00:00:05,000/);
  });

  it("dispatches to summary format", () => {
    const result = exportMeeting(session, "summary");
    assert.ok(result.includes("## Summary"));
  });
});
