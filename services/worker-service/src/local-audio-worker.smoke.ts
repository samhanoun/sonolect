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

const successCommandArgs = [
  process.execPath,
  "-e",
  "const path = require('node:path'); const [audioPath, mimeType, language] = process.argv.slice(1); console.log('Offline transcript for ' + path.basename(audioPath) + ' in ' + language + ' from ' + mimeType + '.');",
  "{audioPath}",
  "{mimeType}",
  "{language}",
];

const processed = await processNextQueuedAudioJob({
  storePath,
  localSttCommandArgs: successCommandArgs,
});
assert.equal(processed?.job.id, "job-queued");
assert.equal(processed?.job.status, "completed");
assert.ok(processed.transcript);
assert.equal(processed.transcript.status, "completed");
assert.equal(
  processed?.transcript.rawText,
  "Offline transcript for meeting.webm in en from audio/webm.",
);
assert.equal(processed?.transcript.finalText, processed?.transcript.rawText);
assert.deepEqual(processed?.transcript.tags, [
  "audio",
  "local-stt",
  "offline-transcribed",
]);
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
  transcripts: Transcript[];
};
assert.equal(
  afterFailure.audioJobs.find((job) => job.id === "job-missing-transcript")
    ?.status,
  "failed",
);

const {
  rawText: _queuedRawText,
  finalText: _queuedFinalText,
  ...queuedTranscriptInput
} = queuedTranscript;
const commandFailureTranscript: Transcript = {
  ...queuedTranscriptInput,
  id: "transcript-command-failure",
  status: "processing",
  tags: ["audio", "queued"],
  updatedAt: now,
};
const commandFailureJob: AudioUploadJob = {
  ...queuedJob,
  id: "job-command-failure",
  transcriptId: commandFailureTranscript.id,
  status: "queued",
  updatedAt: now,
};
afterFailure.audioJobs.push(commandFailureJob);
afterFailure.transcripts.push(commandFailureTranscript);
await writeFile(storePath, JSON.stringify(afterFailure, null, 2), "utf8");

const failureCommandArgs = [
  process.execPath,
  "-e",
  "console.error('offline stt exploded'); process.exit(7);",
  "{audioPath}",
];
const commandFailed = await processNextQueuedAudioJob({
  storePath,
  localSttCommandArgs: failureCommandArgs,
});
assert.equal(commandFailed?.job.id, "job-command-failure");
assert.equal(commandFailed?.job.status, "failed");
assert.match(commandFailed?.job.error ?? "", /Local STT command failed/);
assert.match(commandFailed?.job.error ?? "", /offline stt exploded/);

const afterCommandFailure = JSON.parse(await readFile(storePath, "utf8")) as {
  audioJobs: AudioUploadJob[];
  transcripts: Transcript[];
};
assert.equal(
  afterCommandFailure.audioJobs.find((job) => job.id === "job-command-failure")
    ?.status,
  "failed",
);
const failedTranscript = afterCommandFailure.transcripts.find(
  (item) => item.id === "transcript-command-failure",
);
assert.equal(failedTranscript?.status, "failed");
assert.deepEqual(failedTranscript?.tags, [
  "audio",
  "local-stt",
  "transcription-failed",
]);

const shellMetaAudioPath = join(tempDir, "meeting;touch injected.webm");
await writeFile(
  shellMetaAudioPath,
  Buffer.from("fake local audio with shell chars"),
);
const mergeTranscript: Transcript = {
  ...queuedTranscriptInput,
  id: "transcript-merge",
  status: "processing",
  tags: ["audio", "queued", "keep-me"],
  updatedAt: now,
};
const mergeJob: AudioUploadJob = {
  ...queuedJob,
  id: "job-merge",
  transcriptId: mergeTranscript.id,
  status: "queued",
  upload: {
    ...queuedJob.upload,
    localPath: shellMetaAudioPath,
  },
  updatedAt: now,
};
afterCommandFailure.audioJobs.push(mergeJob);
afterCommandFailure.transcripts.push(mergeTranscript);
await writeFile(
  storePath,
  JSON.stringify(afterCommandFailure, null, 2),
  "utf8",
);

const concurrentCommandScript =
  "const fs = require('node:fs'); const path = require('node:path'); " +
  "const [audioPath, mimeType, language, storePath] = process.argv.slice(1); " +
  "const store = JSON.parse(fs.readFileSync(storePath, 'utf8')); " +
  "store.audioJobs.push({ id: 'job-concurrent', userId: 'user-1', transcriptId: 'transcript-concurrent', status: 'queued', mimeType: 'audio/webm', sizeBytes: 1, durationMs: 1, source: 'desktop', upload: { strategy: 'inline-metadata', storage: 'local-placeholder' }, createdAt: '2026-01-02T03:04:06.000Z', updatedAt: '2026-01-02T03:04:06.000Z' }); " +
  "store.transcripts.push({ id: 'transcript-concurrent', userId: 'user-1', title: 'Concurrent', language: 'en', mode: 'dictate', privacyMode: false, status: 'processing', durationMs: 1, tags: ['audio', 'queued'], createdAt: '2026-01-02T03:04:06.000Z', updatedAt: '2026-01-02T03:04:06.000Z' }); " +
  "fs.writeFileSync(storePath, JSON.stringify(store, null, 2)); " +
  "console.log('Argv transcript for ' + path.basename(audioPath) + ' in ' + language + ' from ' + mimeType + '.');";
const mergeProcessed = await processNextQueuedAudioJob({
  storePath,
  localSttCommandArgs: [
    process.execPath,
    "-e",
    concurrentCommandScript,
    "{audioPath}",
    "{mimeType}",
    "{language}",
    storePath,
  ],
});
assert.equal(mergeProcessed?.job.id, "job-merge");
assert.equal(mergeProcessed?.job.status, "completed");
assert.equal(
  mergeProcessed?.transcript?.rawText,
  "Argv transcript for meeting;touch injected.webm in en from audio/webm.",
);
assert.ok(mergeProcessed?.transcript?.tags.includes("keep-me"));

const afterMerge = JSON.parse(await readFile(storePath, "utf8")) as {
  audioJobs: AudioUploadJob[];
  transcripts: Transcript[];
};
assert.equal(
  afterMerge.audioJobs.find((job) => job.id === "job-concurrent")?.status,
  "queued",
);
assert.equal(
  afterMerge.transcripts.find((item) => item.id === "transcript-concurrent")
    ?.status,
  "processing",
);
assert.equal(
  afterMerge.transcripts.find((item) => item.id === "transcript-merge")?.status,
  "completed",
);

const abortTranscript: Transcript = {
  ...queuedTranscriptInput,
  id: "transcript-abort",
  status: "processing",
  tags: ["audio", "queued"],
  updatedAt: now,
};
const abortJob: AudioUploadJob = {
  ...queuedJob,
  id: "job-abort",
  transcriptId: abortTranscript.id,
  status: "queued",
  updatedAt: now,
};
afterMerge.audioJobs.push(abortJob);
afterMerge.transcripts.push(abortTranscript);
await writeFile(storePath, JSON.stringify(afterMerge, null, 2), "utf8");
const abortController = new AbortController();
abortController.abort();
const aborted = await processNextQueuedAudioJob({
  storePath,
  localSttCommandArgs: [process.execPath, "-e", "console.log('too late')"],
  signal: abortController.signal,
});
assert.equal(aborted?.job.id, "job-abort");
assert.equal(aborted?.job.status, "queued");
assert.equal(aborted?.transcript?.status, "processing");
const afterAbort = JSON.parse(await readFile(storePath, "utf8")) as {
  audioJobs: AudioUploadJob[];
  transcripts: Transcript[];
};
assert.equal(
  afterAbort.audioJobs.find((job) => job.id === "job-abort")?.status,
  "queued",
);
assert.equal(
  afterAbort.transcripts.find((item) => item.id === "transcript-abort")?.status,
  "processing",
);
await writeFile(
  storePath,
  JSON.stringify(
    {
      ...afterAbort,
      audioJobs: afterAbort.audioJobs.filter((job) => job.id !== "job-abort"),
    },
    null,
    2,
  ),
  "utf8",
);

const none = await processNextQueuedAudioJob({
  storePath,
  localSttCommandArgs: successCommandArgs,
});
assert.equal(none, undefined);

console.log("Local audio worker smoke test passed");
