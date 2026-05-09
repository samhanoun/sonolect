import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  createMeetingSession,
  startMeeting,
  pauseMeeting,
  resumeMeeting,
  endMeeting,
  addSegmentToMeeting,
  getMeetingTranscriptText,
  DEFAULT_MEETING_CONFIG,
} from "./meetingMode";
import type { TranscriptSegment } from "./segmentEditor";

function makeSegment(
  overrides: Partial<TranscriptSegment> = {},
): TranscriptSegment {
  return {
    id: "seg-1",
    text: "Hello world",
    startMs: 0,
    endMs: 1000,
    ...overrides,
  };
}

describe("meetingMode", () => {
  describe("createMeetingSession", () => {
    it("creates a session with default config when no overrides given", () => {
      const session = createMeetingSession();
      assert.equal(session.config.title, DEFAULT_MEETING_CONFIG.title);
      assert.equal(session.config.language, DEFAULT_MEETING_CONFIG.language);
      assert.equal(
        session.config.speakerCount,
        DEFAULT_MEETING_CONFIG.speakerCount,
      );
      assert.equal(session.config.autoSave, DEFAULT_MEETING_CONFIG.autoSave);
      assert.equal(session.status, "idle");
      assert.deepEqual(session.segments, []);
      assert.equal(session.durationMs, 0);
      assert.ok(session.id.startsWith("meeting-"));
      assert.ok(session.startedAt);
    });

    it("merges custom config over defaults", () => {
      const session = createMeetingSession({
        title: "Standup",
        speakerCount: 4,
      });
      assert.equal(session.config.title, "Standup");
      assert.equal(session.config.speakerCount, 4);
      assert.equal(session.config.language, DEFAULT_MEETING_CONFIG.language);
      assert.equal(session.config.autoSave, DEFAULT_MEETING_CONFIG.autoSave);
    });

    it("assigns incrementing ids across calls", () => {
      const a = createMeetingSession();
      const b = createMeetingSession();
      assert.notEqual(a.id, b.id);
    });
  });

  describe("full lifecycle: create -> start -> pause -> resume -> end", () => {
    it("transitions through every valid state", () => {
      let session = createMeetingSession({ title: "Lifecycle" });
      assert.equal(session.status, "idle");

      session = startMeeting(session);
      assert.equal(session.status, "active");

      session = pauseMeeting(session);
      assert.equal(session.status, "paused");

      session = resumeMeeting(session);
      assert.equal(session.status, "active");

      session = endMeeting(session);
      assert.equal(session.status, "completed");
      assert.ok(session.endedAt);
    });
  });

  describe("invalid transitions", () => {
    it("pauseMeeting on idle returns unchanged session", () => {
      const session = createMeetingSession();
      const result = pauseMeeting(session);
      assert.equal(result, session);
      assert.equal(result.status, "idle");
    });

    it("startMeeting on active returns unchanged session", () => {
      const session = startMeeting(createMeetingSession());
      const result = startMeeting(session);
      assert.equal(result, session);
      assert.equal(result.status, "active");
    });

    it("resumeMeeting on active returns unchanged session", () => {
      const session = startMeeting(createMeetingSession());
      const result = resumeMeeting(session);
      assert.equal(result, session);
      assert.equal(result.status, "active");
    });

    it("pauseMeeting on paused returns unchanged session", () => {
      let session = startMeeting(createMeetingSession());
      session = pauseMeeting(session);
      const result = pauseMeeting(session);
      assert.equal(result, session);
      assert.equal(result.status, "paused");
    });

    it("endMeeting on idle returns unchanged session", () => {
      const session = createMeetingSession();
      const result = endMeeting(session);
      assert.equal(result, session);
      assert.equal(result.status, "idle");
    });

    it("endMeeting on completed returns unchanged session", () => {
      let session = startMeeting(createMeetingSession());
      session = endMeeting(session);
      const result = endMeeting(session);
      assert.equal(result, session);
      assert.equal(result.status, "completed");
    });
  });

  describe("addSegmentToMeeting", () => {
    it("appends the segment to the session", () => {
      const session = createMeetingSession();
      const seg = makeSegment();
      const updated = addSegmentToMeeting(session, seg);
      assert.equal(updated.segments.length, 1);
      assert.deepEqual(updated.segments[0], seg);
    });

    it("updates durationMs to the max endMs of all segments", () => {
      let session = createMeetingSession();
      session = addSegmentToMeeting(session, makeSegment({ endMs: 2000 }));
      assert.equal(session.durationMs, 2000);
      session = addSegmentToMeeting(
        session,
        makeSegment({ id: "seg-2", endMs: 500 }),
      );
      assert.equal(session.durationMs, 2000);
      session = addSegmentToMeeting(
        session,
        makeSegment({ id: "seg-3", endMs: 5000 }),
      );
      assert.equal(session.durationMs, 5000);
    });

    it("accumulates multiple segments", () => {
      let session = createMeetingSession();
      session = addSegmentToMeeting(
        session,
        makeSegment({ id: "s1", text: "One" }),
      );
      session = addSegmentToMeeting(
        session,
        makeSegment({ id: "s2", text: "Two" }),
      );
      session = addSegmentToMeeting(
        session,
        makeSegment({ id: "s3", text: "Three" }),
      );
      assert.equal(session.segments.length, 3);
    });
  });

  describe("getMeetingTranscriptText", () => {
    it("joins segment texts with double newline", () => {
      let session = createMeetingSession();
      session = addSegmentToMeeting(
        session,
        makeSegment({ id: "s1", text: "Alpha" }),
      );
      session = addSegmentToMeeting(
        session,
        makeSegment({ id: "s2", text: "Beta" }),
      );
      session = addSegmentToMeeting(
        session,
        makeSegment({ id: "s3", text: "Gamma" }),
      );
      assert.equal(getMeetingTranscriptText(session), "Alpha\n\nBeta\n\nGamma");
    });

    it("returns empty string for session with no segments", () => {
      const session = createMeetingSession();
      assert.equal(getMeetingTranscriptText(session), "");
    });

    it("filters out whitespace-only segments", () => {
      let session = createMeetingSession();
      session = addSegmentToMeeting(
        session,
        makeSegment({ id: "s1", text: "Hello" }),
      );
      session = addSegmentToMeeting(
        session,
        makeSegment({ id: "s2", text: "   " }),
      );
      session = addSegmentToMeeting(
        session,
        makeSegment({ id: "s3", text: "World" }),
      );
      assert.equal(getMeetingTranscriptText(session), "Hello\n\nWorld");
    });
  });

  describe("endMeeting sets endedAt and completed status", () => {
    it("sets endedAt timestamp and status to completed on active session", () => {
      let session = startMeeting(createMeetingSession());
      assert.equal(session.endedAt, undefined);
      session = endMeeting(session);
      assert.equal(session.status, "completed");
      assert.ok(session.endedAt);
      const parsed = new Date(session.endedAt);
      assert.ok(!isNaN(parsed.getTime()));
    });

    it("sets endedAt and completed on paused session", () => {
      let session = startMeeting(createMeetingSession());
      session = pauseMeeting(session);
      session = endMeeting(session);
      assert.equal(session.status, "completed");
      assert.ok(session.endedAt);
    });
  });

  describe("startMeeting updates startedAt", () => {
    it("overwrites startedAt with a fresh timestamp", () => {
      const session = createMeetingSession();
      const originalStartedAt = session.startedAt;
      const started = startMeeting(session);
      assert.ok(started.startedAt);
      assert.equal(started.status, "active");
      const original = new Date(originalStartedAt).getTime();
      const updated = new Date(started.startedAt).getTime();
      assert.ok(updated >= original);
    });
  });
});
