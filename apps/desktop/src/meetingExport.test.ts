import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  exportMeetingNotes,
  exportMeetingTranscript,
  exportMeetingSrt,
  exportMeetingSummary,
  getMeetingStats,
} from "./meetingExport";
import type { MeetingSession } from "./meetingMode";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMeetingSession(
  overrides: Partial<MeetingSession> = {},
): MeetingSession {
  return {
    id: "meeting-test-1",
    title: "Sprint Planning",
    startedAt: "2026-05-06T10:00:00.000Z",
    participants: ["Alice", "Bob", "Sarah"],
    segments: [
      {
        id: "seg-1",
        text: "Good morning everyone.",
        startMs: 0,
        endMs: 2000,
        speaker: "Alice",
      },
      {
        id: "seg-2",
        text: "We need to review the backlog items.",
        startMs: 2500,
        endMs: 5000,
        speaker: "Bob",
      },
      {
        id: "seg-3",
        text: "I will prepare the sprint report by Friday.",
        startMs: 5200,
        endMs: 8000,
        speaker: "Sarah",
      },
      {
        id: "seg-4",
        text: "Let's finalize the priorities.",
        startMs: 8500,
        endMs: 11000,
        speaker: "Alice",
      },
    ],
    status: "ended",
    totalDurationMs: 11000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// exportMeetingNotes
// ---------------------------------------------------------------------------

describe("exportMeetingNotes", () => {
  it("includes title as heading", () => {
    const notes = exportMeetingNotes(makeMeetingSession());
    assert.ok(notes.includes("# Sprint Planning"));
  });

  it("includes date", () => {
    const notes = exportMeetingNotes(makeMeetingSession());
    assert.ok(notes.includes("**Date:**"));
    assert.ok(notes.includes("2026-05-06"));
  });

  it("includes participants", () => {
    const notes = exportMeetingNotes(makeMeetingSession());
    assert.ok(notes.includes("**Participants:**"));
    assert.ok(notes.includes("Alice, Bob, Sarah"));
  });

  it("includes duration", () => {
    const notes = exportMeetingNotes(makeMeetingSession());
    assert.ok(notes.includes("**Duration:**"));
  });

  it("includes timeline with speaker labels and timestamps", () => {
    const notes = exportMeetingNotes(makeMeetingSession());
    assert.ok(notes.includes("## Timeline"));
    assert.ok(notes.includes("[0:00] **Alice:**"));
    assert.ok(notes.includes("**Bob:**"));
    assert.ok(notes.includes("Good morning everyone."));
  });

  it("handles empty participants", () => {
    const notes = exportMeetingNotes(makeMeetingSession({ participants: [] }));
    assert.ok(!notes.includes("**Participants:**"));
  });

  it("handles session with no duration", () => {
    const notes = exportMeetingNotes(
      makeMeetingSession({ totalDurationMs: 0 }),
    );
    // Should not include duration line
    assert.ok(!notes.includes("**Duration:**"));
  });
});

// ---------------------------------------------------------------------------
// exportMeetingTranscript
// ---------------------------------------------------------------------------

describe("exportMeetingTranscript", () => {
  it("produces plain text with timestamps and speakers", () => {
    const transcript = exportMeetingTranscript(makeMeetingSession());
    assert.ok(transcript.includes("[0:00] Alice: Good morning everyone."));
    assert.ok(transcript.includes("Bob: We need to review"));
  });

  it("handles segments without speakers", () => {
    const session = makeMeetingSession({
      segments: [{ id: "seg-1", text: "Hello.", startMs: 0, endMs: 1000 }],
    });
    const transcript = exportMeetingTranscript(session);
    assert.ok(transcript.includes("[0:00] Hello."));
    assert.ok(!transcript.includes(":  Hello.")); // no double colon
  });

  it("formats timestamps correctly for longer durations", () => {
    const session = makeMeetingSession({
      segments: [
        {
          id: "seg-1",
          text: "Late segment.",
          startMs: 3_661_000,
          endMs: 3_665_000,
          speaker: "Alice",
        },
      ],
    });
    const transcript = exportMeetingTranscript(session);
    assert.ok(transcript.includes("[1:01:01]"));
  });
});

// ---------------------------------------------------------------------------
// exportMeetingSrt
// ---------------------------------------------------------------------------

describe("exportMeetingSrt", () => {
  it("produces valid SRT format", () => {
    const srt = exportMeetingSrt(makeMeetingSession());
    assert.ok(
      srt.includes(
        "1\n00:00:00,000 --> 00:00:02,000\nAlice: Good morning everyone.",
      ),
    );
    assert.ok(srt.includes("2\n00:00:02,500 --> 00:00:05,000\nBob:"));
  });

  it("uses sequential numbering", () => {
    const srt = exportMeetingSrt(makeMeetingSession());
    const lines = srt.split("\n");
    const numbers = lines.filter((l) => /^\d+$/.test(l));
    assert.equal(numbers[0], "1");
    assert.equal(numbers[1], "2");
    assert.equal(numbers[2], "3");
    assert.equal(numbers[3], "4");
  });

  it("handles segments without speakers", () => {
    const session = makeMeetingSession({
      segments: [{ id: "seg-1", text: "Hello.", startMs: 0, endMs: 1000 }],
    });
    const srt = exportMeetingSrt(session);
    assert.ok(srt.includes("1\n00:00:00,000 --> 00:00:01,000\nHello."));
  });

  it("returns empty string for empty segments", () => {
    const session = makeMeetingSession({ segments: [] });
    const srt = exportMeetingSrt(session);
    assert.equal(srt, "");
  });
});

// ---------------------------------------------------------------------------
// exportMeetingSummary
// ---------------------------------------------------------------------------

describe("exportMeetingSummary", () => {
  it("returns a non-empty summary", () => {
    const summary = exportMeetingSummary(makeMeetingSession());
    assert.ok(summary.length > 0);
  });

  it("includes meeting notes format", () => {
    const summary = exportMeetingSummary(makeMeetingSession());
    assert.ok(summary.includes("Meeting Notes"));
  });

  it("includes attendees in summary", () => {
    const summary = exportMeetingSummary(makeMeetingSession());
    assert.ok(summary.includes("Alice"));
  });
});

// ---------------------------------------------------------------------------
// getMeetingStats
// ---------------------------------------------------------------------------

describe("getMeetingStats", () => {
  it("returns correct duration string", () => {
    const stats = getMeetingStats(makeMeetingSession());
    assert.equal(stats.duration, "11s");
  });

  it("returns correct segment count", () => {
    const stats = getMeetingStats(makeMeetingSession());
    assert.equal(stats.segmentCount, 4);
  });

  it("returns correct speaker count", () => {
    const stats = getMeetingStats(makeMeetingSession());
    assert.equal(stats.speakerCount, 3);
  });

  it("returns positive word count", () => {
    const stats = getMeetingStats(makeMeetingSession());
    assert.ok(stats.wordCount > 0);
  });

  it("returns positive average segment length", () => {
    const stats = getMeetingStats(makeMeetingSession());
    assert.ok(stats.averageSegmentLength > 0);
  });

  it("handles empty session", () => {
    const session = makeMeetingSession({
      segments: [],
      totalDurationMs: 0,
    });
    const stats = getMeetingStats(session);
    assert.equal(stats.segmentCount, 0);
    assert.equal(stats.wordCount, 0);
    assert.equal(stats.speakerCount, 0);
    assert.equal(stats.averageSegmentLength, 0);
    assert.equal(stats.duration, "0s");
  });
});
