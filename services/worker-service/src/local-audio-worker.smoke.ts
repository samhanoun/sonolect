import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strict as assert } from "node:assert";
import type { AudioUploadJob, Transcript } from "@sonolect/types";
import { processNextQueuedAudioJob } from "./local-audio-worker.js";

const now = "2026-01-02T03:04:05.000Z";
const tempDir = await mkdtemp(join(tmpdir(), "sonolect-worker-"));
const storePath = join(tempDir, "local-store.json");
const audioPath = join(tempDir, "meeting.webm");
await writeFile(audioPath, Buffer.from("fake local audio"));

const unuploadedQueuedJob: AudioUploadJob = {
  id: "job-awaiting-upload",
  userId: "user-1",
  transcriptId: "transcript-awaiting-upload",
  status: "queued",
  fileName: "waiting.webm",
  mimeType: "audio/webm",
  sizeBytes: 1024,
  durationMs: 30000,
  source: "desktop",
  upload: { strategy: "inline-metadata", storage: "local-placeholder" },
  createdAt: "2026-01-02T03:04:04.000Z",
  updatedAt: now,
};

const queuedJob: AudioUploadJob = {
  id: "job-queued",
  userId: "user-1",
  transcriptId: "transcript-queued",
  status: "queued",
  fileName: "meeting.webm",
  mimeType: "audio/webm",
  sizeBytes: 2048,
  durationMs: 65000,
  source: "desktop",
  upload: {
    strategy: "binary-local",
    storage: "local-file",
    localPath: audioPath,
    mimeType: "audio/webm",
    sizeBytes: 2048,
    uploadedAt: now,
  },
  createdAt: now,
  updatedAt: now,
};

const existingCompletedJob: AudioUploadJob = {
  ...queuedJob,
  id: "job-completed",
  transcriptId: "transcript-completed",
  status: "completed",
};

const awaitingUploadTranscript: Transcript = {
  id: "transcript-awaiting-upload",
  userId: "user-1",
  title: "Waiting",
  language: "en",
  mode: "dictate",
  privacyMode: false,
  status: "processing",
  durationMs: 30000,
  tags: ["audio", "queued"],
  createdAt: now,
  updatedAt: now,
};

const queuedTranscript: Transcript = {
  id: "transcript-queued",
  userId: "user-1",
  title: "Meeting",
  language: "en",
  mode: "dictate",
  privacyMode: false,
  status: "processing",
  durationMs: 65000,
  tags: ["audio", "queued"],
  createdAt: now,
  updatedAt: now,
};

await writeFile(
  storePath,
  JSON.stringify(
    {
      audioJobs: [existingCompletedJob, unuploadedQueuedJob, queuedJob],
      transcripts: [awaitingUploadTranscript, queuedTranscript],
    },
    null,
    2,
  ),
  "utf8",
);

const processed = await processNextQueuedAudioJob({ storePath });
assert.equal(processed?.job.id, "job-queued");
assert.equal(processed?.job.status, "completed");
assert.ok(processed.transcript);
assert.equal(processed.transcript.status, "completed");
assert.equal(
  processed?.transcript.rawText,
  "Mock transcript for meeting.webm (65 seconds).",
);
assert.equal(processed?.transcript.finalText, processed?.transcript.rawText);
assert.ok(processed?.job.updatedAt !== now);
assert.ok(processed?.transcript.updatedAt !== now);

const afterSuccess = JSON.parse(await readFile(storePath, "utf8")) as {
  audioJobs: AudioUploadJob[];
  transcripts: Transcript[];
};
assert.equal(
  afterSuccess.audioJobs.find((job) => job.id === "job-awaiting-upload")
    ?.status,
  "queued",
);
assert.deepEqual(
  afterSuccess.audioJobs.find((job) => job.id === "job-awaiting-upload")
    ?.upload,
  unuploadedQueuedJob.upload,
);
assert.equal(
  afterSuccess.audioJobs.find((job) => job.id === "job-queued")?.status,
  "completed",
);
assert.equal(
  afterSuccess.audioJobs.find((job) => job.id === "job-completed")?.status,
  "completed",
);
assert.equal(
  afterSuccess.transcripts.find((item) => item.id === "transcript-queued")
    ?.status,
  "completed",
);

const missingTranscriptJob: AudioUploadJob = {
  ...queuedJob,
  id: "job-missing-transcript",
  transcriptId: "does-not-exist",
  status: "queued",
  updatedAt: now,
};
afterSuccess.audioJobs.push(missingTranscriptJob);
await writeFile(storePath, JSON.stringify(afterSuccess, null, 2), "utf8");

const failed = await processNextQueuedAudioJob({ storePath });
assert.equal(failed?.job.id, "job-missing-transcript");
assert.equal(failed?.job.status, "failed");
assert.match(failed?.job.error ?? "", /Transcript does-not-exist not found/);

const afterFailure = JSON.parse(await readFile(storePath, "utf8")) as {
  audioJobs: AudioUploadJob[];
};
assert.equal(
  afterFailure.audioJobs.find((job) => job.id === "job-missing-transcript")
    ?.status,
  "failed",
);

const none = await processNextQueuedAudioJob({ storePath });
assert.equal(none, undefined);

console.log("Local audio worker smoke test passed");
