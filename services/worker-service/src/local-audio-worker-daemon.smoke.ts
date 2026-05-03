import { strict as assert } from "node:assert";
import {
  parseLocalAudioWorkerDaemonConfig,
  runLocalAudioWorkerDaemon,
} from "./local-audio-worker-daemon.js";

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
assert.deepEqual(tickCounts, [1, 2]);
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

console.log("Local audio worker daemon smoke test passed");
