import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  createMeetingSession,
  addTranscriptChunk,
  pauseMeeting,
  resumeMeeting,
  endMeeting,
  getMeetingDuration,
  formatMeetingDuration,
  assignSpeakerToChunks,
  getMeetingSpeakers,
  splitMeetingByTopics,
} from "./meetingMode";
import type {
  MeetingConfig,
  MeetingSession,
  MeetingTranscriptChunk,
} from "./meetingMode";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: MeetingConfig = {
  participants: ["Alice", "Bob"],
  autoDetectSpeakers: true,
  language: "en",
  maxDurationMs: 3_600_000,
};

function makeChunk(
  overrides: Partial<MeetingTranscriptChunk> = {},
): MeetingTranscriptChunk {
  return {
    text: "Hello world.",
    startMs: 0,
    endMs: 1000,
    isFinal: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createMeetingSession
// ---------------------------------------------------------------------------

describe("createMeetingSession", () => {
  it("creates a session with the given config", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    assert.equal(session.title, "Untitled Meeting");
    assert.deepEqual(session.participants, ["Alice", "Bob"]);
    assert.equal(session.status, "active");
    assert.equal(session.segments.length, 0);
    assert.equal(session.totalDurationMs, 0);
    assert.ok(session.id.startsWith("meeting-"));
    assert.ok(session.startedAt.length > 0);
  });

  it("uses provided title", () => {
    const session = createMeetingSession({
      ...DEFAULT_CONFIG,
      title: "Sprint Review",
    });
    assert.equal(session.title, "Sprint Review");
  });

  it("defaults to 'Untitled Meeting' when no title is given", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    assert.equal(session.title, "Untitled Meeting");
  });

  it("creates unique IDs for each session", () => {
    const s1 = createMeetingSession(DEFAULT_CONFIG);
    const s2 = createMeetingSession(DEFAULT_CONFIG);
    assert.notEqual(s1.id, s2.id);
  });

  it("does not mutate the config participants array", () => {
    const config = { ...DEFAULT_CONFIG, participants: ["Alice"] };
    const session = createMeetingSession(config);
    session.participants.push("Bob");
    assert.equal(config.participants.length, 1);
  });
});

// ---------------------------------------------------------------------------
// addTranscriptChunk
// ---------------------------------------------------------------------------

describe("addTranscriptChunk", () => {
  it("appends a chunk as a segment", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    const updated = addTranscriptChunk(
      session,
      makeChunk({ text: "Hi there." }),
    );
    assert.equal(updated.segments.length, 1);
    assert.equal(updated.segments[0]!.text, "Hi there.");
  });

  it("preserves speaker from chunk", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    const updated = addTranscriptChunk(
      session,
      makeChunk({ speaker: "Alice" }),
    );
    assert.equal(updated.segments[0]!.speaker, "Alice");
  });

  it("omits speaker field when chunk has no speaker", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    const updated = addTranscriptChunk(session, makeChunk());
    assert.equal(updated.segments[0]!.speaker, undefined);
  });

  it("updates totalDurationMs", () => {
    let session = createMeetingSession(DEFAULT_CONFIG);
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 0, endMs: 5000 }),
    );
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 5200, endMs: 10000 }),
    );
    assert.equal(session.totalDurationMs, 10000);
  });

  it("does not mutate the original session", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    const updated = addTranscriptChunk(session, makeChunk());
    assert.equal(session.segments.length, 0);
    assert.equal(updated.segments.length, 1);
  });
});

// ---------------------------------------------------------------------------
// pauseMeeting / resumeMeeting
// ---------------------------------------------------------------------------

describe("pauseMeeting", () => {
  it("sets status to paused", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    const paused = pauseMeeting(session);
    assert.equal(paused.status, "paused");
  });

  it("is a no-op if already paused", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    const paused = pauseMeeting(session);
    const doublePaused = pauseMeeting(paused);
    assert.equal(doublePaused.status, "paused");
  });

  it("is a no-op if ended", () => {
    const session = endMeeting(createMeetingSession(DEFAULT_CONFIG));
    const result = pauseMeeting(session);
    assert.equal(result.status, "ended");
  });
});

describe("resumeMeeting", () => {
  it("sets status to active from paused", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    const paused = pauseMeeting(session);
    const resumed = resumeMeeting(paused);
    assert.equal(resumed.status, "active");
  });

  it("is a no-op if already active", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    const result = resumeMeeting(session);
    assert.equal(result.status, "active");
  });

  it("is a no-op if ended", () => {
    const session = endMeeting(createMeetingSession(DEFAULT_CONFIG));
    const result = resumeMeeting(session);
    assert.equal(result.status, "ended");
  });
});

// ---------------------------------------------------------------------------
// endMeeting
// ---------------------------------------------------------------------------

describe("endMeeting", () => {
  it("sets status to ended and endedAt timestamp", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    const ended = endMeeting(session);
    assert.equal(ended.status, "ended");
    assert.ok(ended.endedAt);
    assert.ok(ended.endedAt.length > 0);
  });

  it("is a no-op if already ended", () => {
    const session = endMeeting(createMeetingSession(DEFAULT_CONFIG));
    const endedAt = session.endedAt;
    const result = endMeeting(session);
    assert.equal(result.endedAt, endedAt);
  });

  it("can end a paused meeting", () => {
    const session = pauseMeeting(createMeetingSession(DEFAULT_CONFIG));
    const ended = endMeeting(session);
    assert.equal(ended.status, "ended");
  });

  it("computes total duration on end", () => {
    let session = createMeetingSession(DEFAULT_CONFIG);
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 0, endMs: 5000 }),
    );
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 5500, endMs: 12000 }),
    );
    const ended = endMeeting(session);
    assert.equal(ended.totalDurationMs, 12000);
  });
});

// ---------------------------------------------------------------------------
// getMeetingDuration / formatMeetingDuration
// ---------------------------------------------------------------------------

describe("getMeetingDuration", () => {
  it("returns 0 for empty session", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    assert.equal(getMeetingDuration(session), 0);
  });

  it("returns span from first to last segment", () => {
    let session = createMeetingSession(DEFAULT_CONFIG);
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 1000, endMs: 3000 }),
    );
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 4000, endMs: 8000 }),
    );
    assert.equal(getMeetingDuration(session), 7000);
  });
});

describe("formatMeetingDuration", () => {
  it("formats seconds only", () => {
    assert.equal(formatMeetingDuration(5000), "5s");
  });

  it("formats minutes and seconds", () => {
    assert.equal(formatMeetingDuration(125_000), "2m 5s");
  });

  it("formats hours, minutes, and seconds", () => {
    assert.equal(formatMeetingDuration(4_985_000), "1h 23m 5s");
  });

  it("formats exactly 1 hour", () => {
    assert.equal(formatMeetingDuration(3_600_000), "1h 0m 0s");
  });

  it("handles 0ms", () => {
    assert.equal(formatMeetingDuration(0), "0s");
  });

  it("handles negative values as 0s", () => {
    assert.equal(formatMeetingDuration(-1000), "0s");
  });
});

// ---------------------------------------------------------------------------
// assignSpeakerToChunks
// ---------------------------------------------------------------------------

describe("assignSpeakerToChunks", () => {
  it("renames speakers based on the map", () => {
    let session = createMeetingSession(DEFAULT_CONFIG);
    session = addTranscriptChunk(session, makeChunk({ speaker: "Speaker 1" }));
    session = addTranscriptChunk(
      session,
      makeChunk({ speaker: "Speaker 2", startMs: 1200, endMs: 2000 }),
    );

    const updated = assignSpeakerToChunks(session, {
      "Speaker 1": "Alice",
      "Speaker 2": "Bob",
    });

    assert.equal(updated.segments[0]!.speaker, "Alice");
    assert.equal(updated.segments[1]!.speaker, "Bob");
  });

  it("leaves unmapped speakers unchanged", () => {
    let session = createMeetingSession(DEFAULT_CONFIG);
    session = addTranscriptChunk(session, makeChunk({ speaker: "Speaker 3" }));

    const updated = assignSpeakerToChunks(session, {
      "Speaker 1": "Alice",
    });

    assert.equal(updated.segments[0]!.speaker, "Speaker 3");
  });

  it("handles segments without speakers", () => {
    let session = createMeetingSession(DEFAULT_CONFIG);
    session = addTranscriptChunk(session, makeChunk());

    const updated = assignSpeakerToChunks(session, {
      "Speaker 1": "Alice",
    });

    assert.equal(updated.segments[0]!.speaker, undefined);
  });
});

// ---------------------------------------------------------------------------
// getMeetingSpeakers
// ---------------------------------------------------------------------------

describe("getMeetingSpeakers", () => {
  it("returns unique sorted speakers", () => {
    let session = createMeetingSession(DEFAULT_CONFIG);
    session = addTranscriptChunk(
      session,
      makeChunk({ speaker: "Bob", startMs: 0, endMs: 1000 }),
    );
    session = addTranscriptChunk(
      session,
      makeChunk({ speaker: "Alice", startMs: 1200, endMs: 2000 }),
    );
    session = addTranscriptChunk(
      session,
      makeChunk({ speaker: "Bob", startMs: 2200, endMs: 3000 }),
    );

    assert.deepEqual(getMeetingSpeakers(session), ["Alice", "Bob"]);
  });

  it("returns empty array for no speakers", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    assert.deepEqual(getMeetingSpeakers(session), []);
  });
});

// ---------------------------------------------------------------------------
// splitMeetingByTopics
// ---------------------------------------------------------------------------

describe("splitMeetingByTopics", () => {
  it("splits on silence gaps exceeding threshold", () => {
    let session = createMeetingSession(DEFAULT_CONFIG);
    session = addTranscriptChunk(
      session,
      makeChunk({ text: "Topic one.", startMs: 0, endMs: 3000 }),
    );
    session = addTranscriptChunk(
      session,
      makeChunk({ text: "Still topic one.", startMs: 3200, endMs: 6000 }),
    );
    // 6000ms gap here
    session = addTranscriptChunk(
      session,
      makeChunk({ text: "Topic two.", startMs: 12000, endMs: 15000 }),
    );

    const topics = splitMeetingByTopics(session, 5000);
    assert.equal(topics.length, 2);
    assert.equal(topics[0]!.segments.length, 2);
    assert.equal(topics[1]!.segments.length, 1);
  });

  it("returns single topic when no gaps exceed threshold", () => {
    let session = createMeetingSession(DEFAULT_CONFIG);
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 0, endMs: 1000 }),
    );
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 1200, endMs: 2000 }),
    );

    const topics = splitMeetingByTopics(session, 5000);
    assert.equal(topics.length, 1);
    assert.equal(topics[0]!.segments.length, 2);
  });

  it("returns empty array for empty session", () => {
    const session = createMeetingSession(DEFAULT_CONFIG);
    const topics = splitMeetingByTopics(session);
    assert.equal(topics.length, 0);
  });

  it("uses default 5000ms gap", () => {
    let session = createMeetingSession(DEFAULT_CONFIG);
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 0, endMs: 1000 }),
    );
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 7000, endMs: 8000 }),
    );

    const topics = splitMeetingByTopics(session);
    assert.equal(topics.length, 2);
  });

  it("generates correct topic titles", () => {
    let session = createMeetingSession({ ...DEFAULT_CONFIG, title: "Review" });
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 0, endMs: 1000 }),
    );
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 7000, endMs: 8000 }),
    );

    const topics = splitMeetingByTopics(session);
    assert.equal(topics[0]!.title, "Review - Topic 1");
    assert.equal(topics[1]!.title, "Review - Topic 2");
  });

  it("computes duration per topic", () => {
    let session = createMeetingSession(DEFAULT_CONFIG);
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 0, endMs: 3000 }),
    );
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 3200, endMs: 5000 }),
    );
    session = addTranscriptChunk(
      session,
      makeChunk({ startMs: 20000, endMs: 22000 }),
    );

    const topics = splitMeetingByTopics(session, 5000);
    assert.equal(topics[0]!.totalDurationMs, 5000);
    assert.equal(topics[1]!.totalDurationMs, 2000); // single segment: 22000 - 20000
  });
});
