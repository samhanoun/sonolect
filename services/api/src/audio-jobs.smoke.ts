import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "./index.js";
import type { AudioUploadJob, Transcript } from "@sonolect/types";

const audioDir = await mkdtemp(join(tmpdir(), "sonolect-api-audio-test-"));
const app = await createApp({ logger: false, audioDir, audioMaxBytes: 1_024 });

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

  const audioPayload = Buffer.from("fake webm audio bytes");
  const uploaded = await app.inject({
    method: "POST",
    url: `/audio/jobs/${job.id}/audio`,
    headers: {
      "x-user-id": "audio-user",
      "content-type": "audio/webm",
    },
    payload: audioPayload,
  });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const uploadedJob = uploaded.json<AudioUploadJob>();
  assert.equal(uploadedJob.id, job.id);
  assert.equal(uploadedJob.mimeType, "audio/webm");
  assert.equal(uploadedJob.sizeBytes, audioPayload.length);
  assert.equal(uploadedJob.upload.strategy, "binary-local");
  assert.equal(uploadedJob.upload.storage, "local-file");
  assert.equal(uploadedJob.upload.mimeType, "audio/webm");
  assert.equal(uploadedJob.upload.sizeBytes, audioPayload.length);
  assert.ok(uploadedJob.upload.localPath);
  assert.equal(
    relative(audioDir, uploadedJob.upload.localPath).startsWith(".."),
    false,
  );
  assert.deepEqual(await readFile(uploadedJob.upload.localPath), audioPayload);
  assert.equal(
    (await stat(uploadedJob.upload.localPath)).size,
    audioPayload.length,
  );

  const fetchedUploaded = await app.inject({
    method: "GET",
    url: `/audio/jobs/${job.id}`,
    headers: { "x-user-id": "audio-user" },
  });
  assert.equal(fetchedUploaded.statusCode, 200, fetchedUploaded.body);
  assert.deepEqual(
    fetchedUploaded.json<AudioUploadJob>().upload,
    uploadedJob.upload,
  );

  const wrongOwnerUpload = await app.inject({
    method: "POST",
    url: `/audio/jobs/${job.id}/audio`,
    headers: { "x-user-id": "other-user", "content-type": "audio/webm" },
    payload: Buffer.from("other audio"),
  });
  assert.equal(wrongOwnerUpload.statusCode, 404, wrongOwnerUpload.body);

  const missingJobUpload = await app.inject({
    method: "POST",
    url: "/audio/jobs/../../etc/passwd/audio",
    headers: { "x-user-id": "audio-user", "content-type": "audio/webm" },
    payload: Buffer.from("unsafe"),
  });
  assert.equal(missingJobUpload.statusCode, 404, missingJobUpload.body);

  const invalidContentType = await app.inject({
    method: "POST",
    url: `/audio/jobs/${job.id}/audio`,
    headers: { "x-user-id": "audio-user", "content-type": "text/plain" },
    payload: Buffer.from("not audio"),
  });
  assert.equal(invalidContentType.statusCode, 415, invalidContentType.body);

  const tooLarge = await app.inject({
    method: "POST",
    url: `/audio/jobs/${job.id}/audio`,
    headers: { "x-user-id": "audio-user", "content-type": "audio/webm" },
    payload: Buffer.alloc(1_025),
  });
  assert.equal(tooLarge.statusCode, 413, tooLarge.body);

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
  await rm(audioDir, { recursive: true, force: true });
}

console.log("API audio upload job smoke test passed");
