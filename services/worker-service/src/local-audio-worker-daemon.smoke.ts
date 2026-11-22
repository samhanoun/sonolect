import { strict as assert } from "node:assert";
import { getEventListeners } from "node:events";
import {
  parseLocalAudioWorkerDaemonConfig,
  runLocalAudioWorkerDaemon,
  type LocalAudioWorkerDaemonLogEntry,
} from "./local-audio-worker-daemon.js";
import type { LocalAudioWorkerResult } from "./local-audio-worker.js";

const config = parseLocalAudioWorkerDaemonConfig({
  argv: ["--store", "/tmp/sonolect/store.json", "--interval-ms", "2500"],
  env: {},
});
assert.deepEqual(config, {
  storePath: "/tmp/sonolect/store.json",
  pollIntervalMs: 2500,
});

const envConfig = parseLocalAudioWorkerDaemonConfig({
  argv: [],
  env: {
    SONOLECT_LOCAL_STORE_PATH: "/tmp/env-store.json",
    SONOLECT_LOCAL_AUDIO_WORKER_INTERVAL_MS: "1500",
  },
});
assert.equal(envConfig.storePath, "/tmp/env-store.json");
assert.equal(envConfig.pollIntervalMs, 1500);

const fallbackConfig = parseLocalAudioWorkerDaemonConfig({
  argv: [],
  env: { SONOLECT_API_STORE_PATH: "/tmp/api-store.json" },
});
assert.equal(fallbackConfig.storePath, "/tmp/api-store.json");
assert.equal(fallbackConfig.pollIntervalMs, 5000);

assert.throws(
  () => parseLocalAudioWorkerDaemonConfig({ argv: [], env: {} }),
  /Set SONOLECT_LOCAL_STORE_PATH or SONOLECT_API_STORE_PATH/,
);
assert.throws(
  () =>
    parseLocalAudioWorkerDaemonConfig({
      argv: ["--store", "/tmp/store.json", "--interval-ms", "0"],
      env: {},
    }),
  /poll interval must be a positive integer/,
);

const logs: unknown[] = [];
const tickCounts: number[] = [];
let sleptFor: number | undefined;
const result = await runLocalAudioWorkerDaemon({
  config,
  maxTicks: 2,
  log: (entry) => logs.push(entry),
  sleep: async (ms) => {
    sleptFor = ms;
  },
  processNextQueuedAudioJob: async ({ storePath, signal }) => {
    assert.equal(storePath, config.storePath);
    assert.equal(signal, undefined);
    tickCounts.push(tickCounts.length + 1);
    return tickCounts.length === 1
      ? {
          job: {
            id: "job-1",
            userId: "user-1",
            transcriptId: "transcript-1",
            status: "completed",
            fileName: "meeting.webm",
            mimeType: "audio/webm",
            sizeBytes: 1,
            durationMs: 1000,
            source: "desktop",
            upload: {
              strategy: "binary-local",
              storage: "local-file",
              localPath: "/tmp/audio.webm",
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
            completedAt: "2026-01-01T00:00:01.000Z",
          },
        }
      : undefined;
  },
});

assert.equal(result.ticks, 2);
assert.equal(result.processed, 1);
assert.equal(result.completed, 1);
assert.equal(result.failed, 0);
assert.equal(sleptFor, 2500);
// Each tick works until the queue is empty: tick 1 takes the job, then finds
// nothing more; tick 2 finds nothing.
assert.deepEqual(tickCounts, [1, 2, 3]);
assert.deepEqual(logs[0], {
  event: "local-audio-worker-daemon.start",
  storePath: "/tmp/sonolect/store.json",
  pollIntervalMs: 2500,
});
assert.deepEqual(logs.at(-1), {
  event: "local-audio-worker-daemon.stop",
  reason: "max-ticks",
  ticks: 2,
  processed: 1,
  completed: 1,
  failed: 0,
});

const abortController = new AbortController();
let abortProcessed = 0;
const abortedResult = await runLocalAudioWorkerDaemon({
  config,
  signal: abortController.signal,
  log: () => undefined,
  sleep: async () => undefined,
  processNextQueuedAudioJob: async ({ signal }) => {
    assert.equal(signal, abortController.signal);
    abortProcessed += 1;
    abortController.abort();
    return {
      job: {
        id: `abort-job-${abortProcessed}`,
        userId: "user-1",
        transcriptId: "transcript-1",
        status: "completed",
        fileName: "meeting.webm",
        mimeType: "audio/webm",
        sizeBytes: 1,
        durationMs: 1000,
        source: "desktop",
        upload: {
          strategy: "binary-local",
          storage: "local-file",
          localPath: "/tmp/audio.webm",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
      },
    };
  },
});
assert.equal(abortProcessed, 1);
assert.equal(abortedResult.processed, 1);
assert.equal(abortedResult.ticks, 1);

const completedJob = (id: string): LocalAudioWorkerResult => ({
  job: {
    id,
    userId: "user-1",
    transcriptId: `transcript-${id}`,
    status: "completed",
    mimeType: "audio/webm",
    sizeBytes: 1,
    durationMs: 1000,
    source: "desktop",
    upload: {
      strategy: "binary-local",
      storage: "local-file",
      localPath: "/tmp/audio.webm",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
  },
});

// A backlog is worked through in one tick, not one job per poll interval.
const backlog = ["job-a", "job-b", "job-c"];
let sleeps = 0;
const drained = await runLocalAudioWorkerDaemon({
  config,
  maxTicks: 1,
  log: () => undefined,
  sleep: async () => {
    sleeps += 1;
  },
  processNextQueuedAudioJob: async () => {
    const next = backlog.shift();
    return next ? completedJob(next) : undefined;
  },
});
assert.equal(drained.ticks, 1);
assert.equal(drained.processed, 3);
assert.equal(sleeps, 0);

// A job that goes back to the queue is not taken again in the same tick.
let requeuedCalls = 0;
const requeued = await runLocalAudioWorkerDaemon({
  config,
  maxTicks: 1,
  log: () => undefined,
  sleep: async () => undefined,
  processNextQueuedAudioJob: async () => {
    requeuedCalls += 1;
    const result = completedJob("job-requeued");
    return { ...result, job: { ...result.job, status: "queued" } };
  },
});
assert.equal(requeuedCalls, 1);
assert.equal(requeued.processed, 1);

// A store error is logged and the daemon keeps polling instead of exiting.
const errorLogs: LocalAudioWorkerDaemonLogEntry[] = [];
let failingCalls = 0;
const survived = await runLocalAudioWorkerDaemon({
  config,
  maxTicks: 2,
  log: (entry) => errorLogs.push(entry),
  sleep: async () => undefined,
  processNextQueuedAudioJob: async () => {
    failingCalls += 1;
    if (failingCalls === 1) throw new Error("Unexpected end of JSON input");
    return undefined;
  },
});
assert.equal(survived.ticks, 2);
assert.equal(failingCalls, 2);
assert.deepEqual(
  errorLogs.find((entry) => entry.event === "local-audio-worker-daemon.error"),
  {
    event: "local-audio-worker-daemon.error",
    message: "Unexpected end of JSON input",
  },
);
assert.equal(errorLogs.at(-1)?.event, "local-audio-worker-daemon.stop");

// The default sleep leaves no abort listener behind on the daemon's signal.
const longLived = new AbortController();
const polled = await runLocalAudioWorkerDaemon({
  config: { ...config, pollIntervalMs: 1 },
  maxTicks: 15,
  signal: longLived.signal,
  log: () => undefined,
  processNextQueuedAudioJob: async () => undefined,
});
assert.equal(polled.ticks, 15);
assert.equal(getEventListeners(longLived.signal, "abort").length, 0);

console.log("Local audio worker daemon smoke test passed");
