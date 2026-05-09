import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createMeetingSession,
  startMeeting,
  addSegmentToMeeting,
  endMeeting,
  getMeetingTranscriptText,
} from "./meetingMode";
import { assignSpeakersByGap } from "./speakerDiarization";
import { exportMeeting } from "./meetingExport";
import {
  createPipelineState,
  processChunkResult,
  finalizePipeline,
  DEFAULT_PIPELINE_CONFIG,
  type TranscriptionResult,
} from "./liveMeetingPipeline";
import { extractActionItems, extractKeyDecisions } from "./aiSummary";

describe("meeting pipeline integration", () => {
  const segments = [
    {
      id: "seg-0",
      text: "Welcome everyone to the standup.",
      startMs: 0,
      endMs: 3000,
      speaker: "",
    },
    {
      id: "seg-1",
      text: "We need to finalize the API design by Friday.",
      startMs: 3200,
      endMs: 7000,
      speaker: "",
    },
    {
      id: "seg-2",
      text: "The team decided to use GraphQL for the new service.",
      startMs: 10500,
      endMs: 15000,
      speaker: "",
    },
    {
      id: "seg-3",
      text: "Action item: update the deployment pipeline.",
      startMs: 15200,
      endMs: 19000,
      speaker: "",
    },
    {
      id: "seg-4",
      text: "We agreed to schedule a follow-up next Monday.",
      startMs: 25000,
      endMs: 30000,
      speaker: "",
    },
  ];

  describe("meetingMode lifecycle", () => {
    it("create → start → add segments → end", () => {
      let session = createMeetingSession({
        title: "Integration Standup",
        speakerCount: 3,
      });
      assert.equal(session.status, "idle");
      assert.equal(session.config.title, "Integration Standup");
      assert.equal(session.config.speakerCount, 3);

      session = startMeeting(session);
      assert.equal(session.status, "active");

      for (const seg of segments) {
        session = addSegmentToMeeting(session, seg);
      }
      assert.equal(session.segments.length, 5);
      assert.equal(session.durationMs, 30000);

      session = endMeeting(session);
      assert.equal(session.status, "completed");
      assert.ok(session.endedAt);
    });

    it("getMeetingTranscriptText joins all segment text", () => {
      let session = createMeetingSession({ title: "Text Test" });
      session = startMeeting(session);
      for (const seg of segments) {
        session = addSegmentToMeeting(session, seg);
      }
      const text = getMeetingTranscriptText(session);
      assert.ok(text.includes("Welcome everyone"));
      assert.ok(text.includes("follow-up next Monday"));
      assert.ok(text.includes("API design"));
    });
  });

  describe("speakerDiarization on meeting segments", () => {
    it("assigns speakers based on gaps between segments", () => {
      const diarized = assignSpeakersByGap(segments, 2000);
      assert.equal(diarized.length, 5);
      assert.equal(diarized[0]!.speaker, "Speaker 1");
      assert.equal(diarized[1]!.speaker, "Speaker 1");
      assert.equal(diarized[2]!.speaker, "Speaker 2");
      assert.equal(diarized[3]!.speaker, "Speaker 2");
      assert.equal(diarized[4]!.speaker, "Speaker 3");
    });

    it("diarized segments preserve original text and timing", () => {
      const diarized = assignSpeakersByGap(segments, 2000);
      assert.equal(diarized[0]!.text, segments[0]!.text);
      assert.equal(diarized[0]!.startMs, 0);
      assert.equal(diarized[0]!.endMs, 3000);
      assert.equal(diarized[4]!.text, segments[4]!.text);
      assert.equal(diarized[4]!.startMs, 25000);
      assert.equal(diarized[4]!.endMs, 30000);
    });
  });

  describe("meetingExport in all 4 formats", () => {
    function buildSession() {
      let session = createMeetingSession({ title: "Export Test Meeting" });
      session = startMeeting(session);
      const diarized = assignSpeakersByGap(segments, 2000);
      for (const seg of diarized) {
        session = addSegmentToMeeting(session, {
          id: `seg-${seg.startMs}`,
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          speaker: seg.speaker,
        });
      }
      session = endMeeting(session);
      return session;
    }

    it("exports notes format with title and speaker labels", () => {
      const session = buildSession();
      const notes = exportMeeting(session, "notes");
      assert.ok(notes.includes("# Export Test Meeting"));
      assert.ok(notes.includes("**Speaker 1**:"));
      assert.ok(notes.includes("**Speaker 2**:"));
      assert.ok(notes.includes("**Speaker 3**:"));
      assert.ok(notes.includes("Welcome everyone"));
      assert.ok(notes.includes("Status: completed"));
    });

    it("exports transcript format with timestamps", () => {
      const session = buildSession();
      const transcript = exportMeeting(session, "transcript");
      assert.ok(transcript.includes("[00:00:00]"));
      assert.ok(transcript.includes("Speaker 1:"));
      assert.ok(transcript.includes("Speaker 2:"));
      assert.ok(transcript.includes("Speaker 3:"));
      assert.ok(transcript.includes("Welcome everyone"));
    });

    it("exports srt format with sequence numbers and time codes", () => {
      const session = buildSession();
      const srt = exportMeeting(session, "srt");
      assert.ok(srt.includes("1\n00:00:00,000 --> 00:00:03,000"));
      assert.ok(srt.includes("Speaker 1: Welcome everyone"));
      assert.ok(srt.includes("2\n"));
      assert.ok(srt.includes("5\n"));
    });

    it("exports summary format with action items and decisions", () => {
      const session = buildSession();
      const summary = exportMeeting(session, "summary");
      assert.ok(summary.includes("## Summary"));
      assert.ok(summary.includes("## Action Items"));
      assert.ok(summary.includes("update the deployment pipeline"));
      assert.ok(summary.includes("## Decisions"));
    });
  });

  describe("liveMeetingPipeline full flow", () => {
    it("createPipelineState → processChunkResult → finalizePipeline", () => {
      let state = createPipelineState("Pipeline Integration Test");
      assert.equal(state.status, "idle");
      assert.ok(state.session);
      assert.equal(state.session!.config.title, "Pipeline Integration Test");

      const results: TranscriptionResult[] = [
        {
          text: "Welcome to the meeting.",
          startMs: 0,
          endMs: 3000,
          confidence: 0.95,
        },
        {
          text: "We should migrate to Kubernetes.",
          startMs: 3500,
          endMs: 7000,
          confidence: 0.92,
        },
        {
          text: "The team decided to adopt TypeScript.",
          startMs: 12000,
          endMs: 16000,
          confidence: 0.88,
        },
        {
          text: "TODO: update the CI pipeline.",
          startMs: 16500,
          endMs: 20000,
          confidence: 0.91,
        },
        {
          text: "We agreed to meet again Thursday.",
          startMs: 28000,
          endMs: 32000,
          confidence: 0.93,
        },
      ];

      for (const r of results) {
        state = processChunkResult(state, r, DEFAULT_PIPELINE_CONFIG);
      }

      assert.equal(state.chunksProcessed, 5);
      assert.equal(state.status, "capturing");
      assert.equal(state.session!.segments.length, 5);
      assert.equal(state.totalDurationMs, 32000);
      assert.equal(state.session!.segments[0]!.text, "Welcome to the meeting.");
      assert.equal(
        state.session!.segments[4]!.text,
        "We agreed to meet again Thursday.",
      );

      const speakerNames = state.session!.segments.map((s) => s.speaker);
      assert.equal(speakerNames[0], "Speaker 1");
      assert.ok(speakerNames.some((s) => s !== "Speaker 1"));

      const finalized = finalizePipeline(state);
      assert.equal(finalized.status, "stopped");
      assert.equal(finalized.session!.status, "completed");
      assert.ok(finalized.session!.endedAt);
    });

    it("pipeline skips empty transcription results", () => {
      let state = createPipelineState("Empty Test");
      state = processChunkResult(
        state,
        { text: "   ", startMs: 0, endMs: 1000, confidence: 0.1 },
        DEFAULT_PIPELINE_CONFIG,
      );
      assert.equal(state.chunksProcessed, 0);
      assert.equal(state.session!.segments.length, 0);
    });
  });

  describe("aiSummary extraction from meeting text", () => {
    const meetingText =
      "Welcome to the standup. " +
      "We need to finalize the API design by Friday. " +
      "The team decided to use GraphQL for the new service. " +
      "Action item: update the deployment pipeline. " +
      "We agreed to schedule a follow-up next Monday. " +
      "Alice should review the security audit results. " +
      "TODO: migrate the staging database. " +
      "The committee resolved to adopt the new coding standards.";

    it("extracts action items from meeting text", () => {
      const items = extractActionItems(meetingText);
      assert.ok(items.length >= 3);
      assert.ok(items.some((i) => i.includes("finalize the API design")));
      assert.ok(
        items.some((i) => i.includes("update the deployment pipeline")),
      );
      assert.ok(items.some((i) => i.includes("migrate the staging database")));
      assert.ok(items.some((i) => i.includes("review the security audit")));
    });

    it("extracts key decisions from meeting text", () => {
      const decisions = extractKeyDecisions(meetingText);
      assert.ok(decisions.length >= 2);
      assert.ok(decisions.some((d) => d.includes("decided")));
      assert.ok(
        decisions.some((d) => d.includes("agreed") || d.includes("resolved")),
      );
    });
  });

  describe("full flow: create → add segments → diarize → export → extract", () => {
    it("end-to-end meeting pipeline", () => {
      let session = createMeetingSession({
        title: "Full Integration Meeting",
        speakerCount: 3,
      });
      session = startMeeting(session);
      assert.equal(session.status, "active");

      const rawSegments = [
        { text: "Let's discuss the Q3 roadmap.", startMs: 0, endMs: 4000 },
        {
          text: "We need to prioritize the auth rewrite.",
          startMs: 4500,
          endMs: 9000,
        },
        {
          text: "The team decided to sunset the legacy API.",
          startMs: 14000,
          endMs: 19000,
        },
        {
          text: "Action item: create migration scripts for all clients.",
          startMs: 19500,
          endMs: 24000,
        },
        {
          text: "We agreed that the rollout will happen in two phases.",
          startMs: 30000,
          endMs: 35000,
        },
      ];

      const diarized = assignSpeakersByGap(rawSegments, 2000);
      assert.equal(diarized.length, 5);
      assert.equal(diarized[0]!.speaker, "Speaker 1");

      for (const seg of diarized) {
        session = addSegmentToMeeting(session, {
          id: `full-${seg.startMs}`,
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          speaker: seg.speaker,
        });
      }

      session = endMeeting(session);
      assert.equal(session.status, "completed");
      assert.equal(session.segments.length, 5);
      assert.equal(session.durationMs, 35000);

      const notes = exportMeeting(session, "notes");
      assert.ok(notes.includes("# Full Integration Meeting"));
      assert.ok(notes.includes("Speaker 1"));

      const transcript = exportMeeting(session, "transcript");
      assert.ok(transcript.includes("[00:00:00]"));
      assert.ok(transcript.includes("Q3 roadmap"));

      const srt = exportMeeting(session, "srt");
      assert.ok(srt.includes("1\n"));
      assert.ok(srt.includes("-->"));

      const summary = exportMeeting(session, "summary");
      assert.ok(summary.includes("## Summary"));

      const fullText = getMeetingTranscriptText(session);
      const actionItems = extractActionItems(fullText);
      assert.ok(actionItems.length >= 2);
      assert.ok(
        actionItems.some((i) => i.includes("prioritize the auth rewrite")),
      );
      assert.ok(
        actionItems.some((i) => i.includes("create migration scripts")),
      );

      const decisions = extractKeyDecisions(fullText);
      assert.ok(decisions.length >= 1);
      assert.ok(
        decisions.some((d) => d.includes("decided") || d.includes("agreed")),
      );
    });
  });
});
