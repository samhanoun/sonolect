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
