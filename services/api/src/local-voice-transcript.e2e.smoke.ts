import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import type { AudioUploadJob, Transcript } from "@sonolect/types";
import { createApp } from "./index.js";
import { processNextQueuedAudioJob } from "../../worker-service/src/local-audio-worker.js";

const tempDir = await mkdtemp(join(tmpdir(), "sonolect-local-voice-e2e-"));
const audioDir = join(tempDir, "audio");
const storePath = join(tempDir, "local-store.json");
const userId = "local-e2e-user";
const audioPayload = Buffer.from("deterministic local audio bytes");

const app = await createApp({
  logger: false,
  storePath,
  audioDir,
  audioMaxBytes: 1_024,
});

try {
  const created = await app.inject({
    method: "POST",
    url: "/audio/jobs",
    headers: { "x-user-id": userId },
    payload: {
      fileName: "daily-note.webm",
      mimeType: "audio/webm",
      sizeBytes: audioPayload.length,
      durationMs: 12_500,
      transcriptTitle: "Daily note",
      source: "desktop",
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const createdJob = created.json<AudioUploadJob>();
  assert.equal(createdJob.status, "queued");
  assert.equal(createdJob.userId, userId);
  assert.ok(createdJob.transcriptId);

  const uploaded = await app.inject({
    method: "POST",
    url: `/audio/jobs/${createdJob.id}/audio`,
    headers: {
      "x-user-id": userId,
      "content-type": "audio/webm",
    },
    payload: audioPayload,
  });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const uploadedJob = uploaded.json<AudioUploadJob>();
  assert.equal(uploadedJob.status, "queued");
  assert.equal(uploadedJob.upload.storage, "local-file");
  assert.ok(uploadedJob.upload.localPath);
  assert.equal(
    relative(audioDir, uploadedJob.upload.localPath).startsWith(".."),
    false,
  );
  assert.deepEqual(await readFile(uploadedJob.upload.localPath), audioPayload);

  const beforeWorker = JSON.parse(await readFile(storePath, "utf8")) as {
    audioJobs?: AudioUploadJob[];
    transcripts?: Transcript[];
  };
  assert.equal(beforeWorker.audioJobs?.length, 1);
  assert.equal(beforeWorker.audioJobs?.[0]?.id, createdJob.id);
  assert.equal(beforeWorker.audioJobs?.[0]?.upload.storage, "local-file");
  assert.equal(beforeWorker.transcripts?.length, 1);
  assert.equal(beforeWorker.transcripts?.[0]?.id, createdJob.transcriptId);
  assert.equal(beforeWorker.transcripts?.[0]?.status, "processing");

  const processed = await processNextQueuedAudioJob({
    storePath,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });
  assert.equal(processed?.job.id, createdJob.id);
  assert.equal(processed?.job.status, "completed");
  assert.equal(processed?.transcript?.id, createdJob.transcriptId);
  assert.equal(processed?.transcript?.status, "completed");
  assert.equal(
    processed?.transcript?.finalText,
    "Mock transcript for daily-note.webm (12.5 seconds).",
  );

  const fetchedJob = await app.inject({
    method: "GET",
    url: `/audio/jobs/${createdJob.id}`,
    headers: { "x-user-id": userId },
  });
  assert.equal(fetchedJob.statusCode, 200, fetchedJob.body);
  const completedJob = fetchedJob.json<AudioUploadJob>();
  assert.equal(completedJob.status, "completed");
  assert.equal(completedJob.completedAt, "2026-01-02T03:04:05.000Z");

  const fetchedTranscript = await app.inject({
    method: "GET",
    url: `/transcripts/${createdJob.transcriptId}`,
    headers: { "x-user-id": userId },
  });
  assert.equal(fetchedTranscript.statusCode, 200, fetchedTranscript.body);
  const completedTranscript = fetchedTranscript.json<Transcript>();
  assert.equal(completedTranscript.status, "completed");
  assert.equal(completedTranscript.title, "Daily note");
  assert.equal(
    completedTranscript.finalText,
    "Mock transcript for daily-note.webm (12.5 seconds).",
  );
  assert.deepEqual(completedTranscript.tags, ["audio", "mock-transcribed"]);

  const listed = await app.inject({
    method: "GET",
    url: "/transcripts?limit=10",
    headers: { "x-user-id": userId },
  });
  assert.equal(listed.statusCode, 200, listed.body);
  const listBody = listed.json<{ items: Transcript[] }>();
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0]?.id, createdJob.transcriptId);
  assert.equal(listBody.items[0]?.status, "completed");
} finally {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
}

console.log("Local voice-to-transcript E2E smoke test passed");
