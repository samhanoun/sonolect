import { fileURLToPath } from "node:url";
import {
  processNextQueuedAudioJob as defaultProcessNextQueuedAudioJob,
  type LocalAudioWorkerOptions,
  type LocalAudioWorkerResult,
} from "./local-audio-worker.js";

export interface LocalAudioWorkerDaemonConfig {
  storePath: string;
  pollIntervalMs: number;
  localSttCommand?: string;
  localSttCommandArgs?: string[];
}

export interface ParseLocalAudioWorkerDaemonConfigInput {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
}

export interface LocalAudioWorkerDaemonSummary {
  ticks: number;
  processed: number;
  completed: number;
  failed: number;
}

export type LocalAudioWorkerDaemonLogEntry =
  | ({
      event: "local-audio-worker-daemon.start";
    } & LocalAudioWorkerDaemonConfig)
  | ({
      event: "local-audio-worker-daemon.tick";
    } & LocalAudioWorkerDaemonSummary)
  | ({
      event: "local-audio-worker-daemon.stop";
      reason: string;
    } & LocalAudioWorkerDaemonSummary);

export interface RunLocalAudioWorkerDaemonOptions {
  config: LocalAudioWorkerDaemonConfig;
  maxTicks?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  log?: (entry: LocalAudioWorkerDaemonLogEntry) => void;
  processNextQueuedAudioJob?: (
    options: LocalAudioWorkerOptions,
  ) => Promise<LocalAudioWorkerResult | undefined>;
}

const defaultPollIntervalMs = 5000;
const intervalEnvName = "SONOLECT_LOCAL_AUDIO_WORKER_INTERVAL_MS";

const takeFlagValue = (argv: string[], flag: string): string | undefined => {
  const prefix = `${flag}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};

const parsePositiveInteger = (value: string, label: string): number => {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
};

export function parseLocalAudioWorkerDaemonConfig(
  input: ParseLocalAudioWorkerDaemonConfigInput = {},
): LocalAudioWorkerDaemonConfig {
  const argv = input.argv ?? process.argv.slice(2);
  const env = input.env ?? process.env;
  const storePath =
    takeFlagValue(argv, "--store") ??
    takeFlagValue(argv, "--store-path") ??
    env.SONOLECT_LOCAL_STORE_PATH ??
    env.SONOLECT_API_STORE_PATH;

  if (!storePath?.trim()) {
    throw new Error(
      "Set SONOLECT_LOCAL_STORE_PATH or SONOLECT_API_STORE_PATH, or pass --store, to run the local audio worker daemon.",
    );
  }

  const intervalValue =
    takeFlagValue(argv, "--interval-ms") ??
    env[intervalEnvName] ??
    `${defaultPollIntervalMs}`;
  const localSttCommand =
    takeFlagValue(argv, "--local-stt-command") ??
    env.SONOLECT_LOCAL_STT_COMMAND;
  const localSttCommandArgsValue =
    takeFlagValue(argv, "--local-stt-command-args") ??
    env.SONOLECT_LOCAL_STT_COMMAND_ARGS;
  const parsedLocalSttCommandArgs = localSttCommandArgsValue?.trim()
    ? (JSON.parse(localSttCommandArgsValue) as unknown)
    : undefined;
  if (
    parsedLocalSttCommandArgs !== undefined &&
    (!Array.isArray(parsedLocalSttCommandArgs) ||
      !parsedLocalSttCommandArgs.every((item) => typeof item === "string"))
  ) {
    throw new Error("local STT command args must be a JSON array of strings");
  }
  const localSttCommandArgs = parsedLocalSttCommandArgs as string[] | undefined;

  return {
    storePath,
    pollIntervalMs: parsePositiveInteger(intervalValue, "poll interval"),
    ...(localSttCommand?.trim() ? { localSttCommand } : {}),
    ...(localSttCommandArgs ? { localSttCommandArgs } : {}),
  };
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });

const summarize = (
  results: LocalAudioWorkerResult[],
): Omit<LocalAudioWorkerDaemonSummary, "ticks"> => ({
  processed: results.length,
  completed: results.filter((result) => result.job.status === "completed")
    .length,
  failed: results.filter((result) => result.job.status === "failed").length,
});

export async function runLocalAudioWorkerDaemon(
  options: RunLocalAudioWorkerDaemonOptions,
): Promise<LocalAudioWorkerDaemonSummary> {
  const processNextQueuedAudioJob =
    options.processNextQueuedAudioJob ?? defaultProcessNextQueuedAudioJob;
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const summary: LocalAudioWorkerDaemonSummary = {
    ticks: 0,
    processed: 0,
    completed: 0,
    failed: 0,
  };

  log({ event: "local-audio-worker-daemon.start", ...options.config });

  let stopReason = "signal";
  while (!options.signal?.aborted) {
    const result = await processNextQueuedAudioJob({
      storePath: options.config.storePath,
      ...(options.config.localSttCommand
        ? { localSttCommand: options.config.localSttCommand }
        : {}),
      ...(options.config.localSttCommandArgs
        ? { localSttCommandArgs: options.config.localSttCommandArgs }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const results = result ? [result] : [];
    const tick = summarize(results);
    summary.ticks += 1;
    summary.processed += tick.processed;
    summary.completed += tick.completed;
    summary.failed += tick.failed;
    log({ event: "local-audio-worker-daemon.tick", ...summary });

    if (options.maxTicks !== undefined && summary.ticks >= options.maxTicks) {
      stopReason = "max-ticks";
      break;
    }

    await sleep(options.config.pollIntervalMs, options.signal);
  }

  log({
    event: "local-audio-worker-daemon.stop",
    reason: stopReason,
    ...summary,
  });
  return summary;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const abortController = new AbortController();
  const shutdown = () => abortController.abort();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  const maxTicksValue = takeFlagValue(process.argv.slice(2), "--max-ticks");
  await runLocalAudioWorkerDaemon({
    config: parseLocalAudioWorkerDaemonConfig(),
    signal: abortController.signal,
    ...(maxTicksValue
      ? { maxTicks: parsePositiveInteger(maxTicksValue, "max ticks") }
      : {}),
  });
}
