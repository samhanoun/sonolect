import { strict as assert } from "node:assert";
import { createApp } from "./index.js";
import type { AudioUploadJob, Transcript } from "@sonolect/types";

const app = await createApp({ logger: false });

try {
  const created = await app.inject({
    method: "POST",
    url: "/audio/jobs",
    headers: { "x-user-id": "audio-user" },
    payload: {
      fileName: "capture.webm",
      mimeType: "audio/webm",
      sizeBytes: 123_456,
      durationMs: 4_321,
      transcriptTitle: "Audio capture",
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const job = created.json<AudioUploadJob>();
  assert.ok(job.id);
  assert.ok(job.transcriptId);
  assert.equal(job.userId, "audio-user");
  assert.equal(job.status, "queued");
  assert.equal(job.source, "desktop");
  assert.equal(job.fileName, "capture.webm");
  assert.equal(job.mimeType, "audio/webm");
  assert.equal(job.sizeBytes, 123_456);
  assert.equal(job.durationMs, 4_321);
  assert.deepEqual(job.upload, {
    strategy: "inline-metadata",
    storage: "local-placeholder",
  });

  const fetchedJob = await app.inject({
    method: "GET",
    url: `/audio/jobs/${job.id}`,
    headers: { "x-user-id": "audio-user" },
  });
  assert.equal(fetchedJob.statusCode, 200, fetchedJob.body);
  assert.equal(fetchedJob.json<AudioUploadJob>().id, job.id);

  const fetchedTranscript = await app.inject({
    method: "GET",
    url: `/transcripts/${job.transcriptId}`,
    headers: { "x-user-id": "audio-user" },
  });
  assert.equal(fetchedTranscript.statusCode, 200, fetchedTranscript.body);
  const transcript = fetchedTranscript.json<Transcript>();
  assert.equal(transcript.title, "Audio capture");
  assert.equal(transcript.status, "processing");
  assert.equal(transcript.durationMs, 4_321);

  const invalid = await app.inject({
    method: "POST",
    url: "/audio/jobs",
    payload: {
      mimeType: "audio/webm",
      sizeBytes: 0,
      durationMs: -1,
    },
  });
  assert.equal(invalid.statusCode, 400, invalid.body);

  const invalidMimeType = await app.inject({
    method: "POST",
    url: "/audio/jobs",
    payload: {
      mimeType: "text/plain",
      sizeBytes: 12,
      durationMs: 100,
    },
  });
  assert.equal(invalidMimeType.statusCode, 400, invalidMimeType.body);
} finally {
  await app.close();
}

console.log("API audio upload job smoke test passed");
