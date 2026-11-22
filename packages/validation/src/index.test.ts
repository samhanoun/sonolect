import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  agentCommandExecutionRequestSchema,
  audioSourceSchema,
  createTranscriptSchema,
  listTranscriptsQuerySchema,
  updateTranscriptSchema,
} from "./index.js";

describe("createTranscriptSchema", () => {
  it("applies defaults on create", () => {
    const parsed = createTranscriptSchema.parse({ title: "Standup" });
    assert.equal(parsed.language, "en");
    assert.equal(parsed.mode, "dictate");
    assert.equal(parsed.privacyMode, false);
    assert.deepEqual(parsed.tags, []);
    assert.equal(parsed.status, "completed");
  });
});

describe("updateTranscriptSchema", () => {
  it("keeps only the fields that were sent (no defaults on update)", () => {
    const parsed = updateTranscriptSchema.parse({ title: "Renamed" });
    assert.deepEqual(parsed, { title: "Renamed" });
  });

  it("rejects an empty update", () => {
    assert.equal(updateTranscriptSchema.safeParse({}).success, false);
  });

  it("still validates field rules", () => {
    assert.equal(
      updateTranscriptSchema.safeParse({ title: "" }).success,
      false,
    );
    assert.equal(
      updateTranscriptSchema.safeParse({ durationMs: -1 }).success,
      false,
    );
  });
});

describe("other schemas", () => {
  it("coerces list query params", () => {
    const parsed = listTranscriptsQuerySchema.parse({
      limit: "10",
      includeDeleted: "true",
    });
    assert.equal(parsed.limit, 10);
    assert.equal(parsed.includeDeleted, true);
  });

  it("reads includeDeleted=false and 0 as false, and refuses other words", () => {
    for (const value of ["false", "0", "FALSE"])
      assert.equal(
        listTranscriptsQuerySchema.parse({ includeDeleted: value })
          .includeDeleted,
        false,
        value,
      );
    for (const value of ["true", "1"])
      assert.equal(
        listTranscriptsQuerySchema.parse({ includeDeleted: value })
          .includeDeleted,
        true,
        value,
      );
    assert.equal(listTranscriptsQuerySchema.parse({}).includeDeleted, false);
    for (const value of ["maybe", "yes", "no", "on", "off", "y", "enabled"])
      assert.equal(
        listTranscriptsQuerySchema.safeParse({ includeDeleted: value }).success,
        false,
        value,
      );
  });

  it("accepts audio types with parameters and keeps only the media type", async () => {
    const { audioMimeTypeSchema, createAudioUploadJobSchema } =
      await import("./index.js");
    for (const [value, expected] of [
      ["audio/webm", "audio/webm"],
      ["audio/webm;codecs=opus", "audio/webm"],
      ['audio/ogg; codecs="opus"', "audio/ogg"],
      ["Audio/MP4; codecs=mp4a.40.2", "audio/mp4"],
    ])
      assert.equal(audioMimeTypeSchema.parse(value), expected, value);
    for (const value of [
      "text/plain",
      "audio/",
      "audio/webm;",
      "audio/webm; codecs",
      "audio/webm\ncodecs=opus",
      `audio/webm;codecs=${"a".repeat(100)}`,
    ])
      assert.equal(audioMimeTypeSchema.safeParse(value).success, false, value);

    const job = createAudioUploadJobSchema.parse({
      mimeType: "audio/webm;codecs=opus",
      sizeBytes: 3,
      durationMs: 1,
      language: "fr-CA",
    });
    assert.equal(job.mimeType, "audio/webm");
    assert.equal(job.language, "fr-CA");
    assert.equal(
      createAudioUploadJobSchema.safeParse({
        mimeType: "audio/webm",
        sizeBytes: 3,
        durationMs: 1,
        language: "--threads",
      }).success,
      false,
    );
  });

  it("requires uri or base64 for audio", () => {
    assert.equal(audioSourceSchema.safeParse({}).success, false);
    assert.equal(
      audioSourceSchema.safeParse({ uri: "gs://b/o" }).success,
      true,
    );
  });

  it("accepts string-keyed command arguments", () => {
    const parsed = agentCommandExecutionRequestSchema.parse({
      command: "summarize",
      arguments: { length: 3 },
    });
    assert.deepEqual(parsed.arguments, { length: 3 });
  });
});

describe("input limits", () => {
  it("accepts language tags and rejects option-like or malformed values", async () => {
    const { languageTagSchema } = await import("./index.js");
    for (const tag of ["en", "fr-CA", "zh-Hant-TW", "es-419", "auto"])
      assert.equal(languageTagSchema.safeParse(tag).success, true, tag);
    for (const tag of ["-x", "--model=/etc/passwd", "en US", "e", "en;rm", ""])
      assert.equal(languageTagSchema.safeParse(tag).success, false, tag);
    assert.equal(
      updateTranscriptSchema.safeParse({ language: "--threads" }).success,
      false,
    );
  });

  it("caps free text and collection sizes", async () => {
    const { refinementRequestSchema, trackUsageSchema } =
      await import("./index.js");
    assert.equal(
      createTranscriptSchema.safeParse({ rawText: "a".repeat(2_000_001) })
        .success,
      false,
    );
    assert.equal(
      createTranscriptSchema.safeParse({
        tags: Array.from({ length: 51 }, (_, index) => `tag-${index}`),
      }).success,
      false,
    );
    assert.equal(
      agentCommandExecutionRequestSchema.safeParse({
        command: "summarize",
        context: "a".repeat(50_001),
      }).success,
      false,
    );
    assert.equal(
      refinementRequestSchema.safeParse({
        action: "translate",
        text: "Bonjour",
        targetLanguage: "en; DROP",
      }).success,
      false,
    );
    for (const userId of ["../other-user", "user one"])
      assert.equal(
        trackUsageSchema.safeParse({
          userId,
          metric: "minutes",
          quantity: 1,
          source: "audio",
        }).success,
        false,
      );
  });

  it("only accepts audio MIME types and https callbacks", async () => {
    const { transcriptionJobRequestSchema } = await import("./index.js");
    const base = { audio: { uri: "gs://bucket/object" } };
    assert.equal(transcriptionJobRequestSchema.safeParse(base).success, true);
    assert.equal(
      transcriptionJobRequestSchema.safeParse({
        audio: { uri: "gs://bucket/object", mimeType: "text/html" },
      }).success,
      false,
    );
    assert.equal(
      transcriptionJobRequestSchema.safeParse({
        ...base,
        callbackUrl: "http://169.254.169.254/latest/meta-data",
      }).success,
      false,
    );
  });
});
