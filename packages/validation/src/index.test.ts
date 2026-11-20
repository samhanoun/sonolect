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
    const { refinementRequestSchema, syncPushSchema, trackUsageSchema } =
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
    assert.equal(
      trackUsageSchema.safeParse({
        userId: "../other-user",
        metric: "minutes",
        quantity: 1,
        source: "audio",
      }).success,
      false,
    );
    assert.equal(
      syncPushSchema.safeParse({
        userId: "user one",
        deviceId: "desktop",
        changes: [],
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
