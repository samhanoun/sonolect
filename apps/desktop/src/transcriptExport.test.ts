import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  exportTranscript,
  type TranscriptExportFormat,
} from "./transcriptExport";
import type { TranscriptSegment } from "./segmentEditor";

const segments: TranscriptSegment[] = [
  { id: "a", text: "Hello world.", startMs: 0, endMs: 1234, speaker: "A" },
  { id: "b", text: "Second line.", startMs: 1500, endMs: 3500 },
];

describe("transcript export formats", () => {
  it("exports plain text and markdown", () => {
    assert.equal(
      exportTranscript({ format: "txt", transcript: "Hello world." }).content,
      "Hello world.",
    );
    const markdown = exportTranscript({
      format: "md",
      transcript: "Hello world.",
      title: "Demo",
    });
    assert.equal(markdown.filename, "transcript.md");
    assert.equal(markdown.mimeType, "text/markdown;charset=utf-8");
    assert.equal(markdown.content, "# Demo\n\nHello world.");
  });

  it("exports SRT and VTT cues using segment timestamps", () => {
    const srt = exportTranscript({ format: "srt", transcript: "", segments });
    assert.match(
      srt.content,
      /1\n00:00:00,000 --> 00:00:01,234\nA: Hello world\./,
    );
    assert.match(
      srt.content,
      /2\n00:00:01,500 --> 00:00:03,500\nSecond line\./,
    );

    const vtt = exportTranscript({ format: "vtt", transcript: "", segments });
    assert.ok(vtt.content.startsWith("WEBVTT\n\n"));
    assert.match(
      vtt.content,
      /00:00:00\.000 --> 00:00:01\.234\nA: Hello world\./,
    );
  });

  it("exports JSON with transcript, segments, and metadata", () => {
    const json = exportTranscript({
      format: "json",
      transcript: "Hello world.",
      segments,
      sessionId: "session-1",
      title: "Demo",
    });
    const payload = JSON.parse(json.content);
    assert.equal(json.filename, "transcript.json");
    assert.equal(payload.sessionId, "session-1");
    assert.equal(payload.title, "Demo");
    assert.equal(payload.transcript, "Hello world.");
    assert.equal(payload.segments.length, 2);
  });

  it("supports every required desktop export format", () => {
    const formats: TranscriptExportFormat[] = [
      "txt",
      "md",
      "srt",
      "vtt",
      "json",
    ];
    for (const format of formats) {
      assert.ok(
        exportTranscript({ format, transcript: "Body", segments }).content
          .length > 0,
      );
    }
  });
});
