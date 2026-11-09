import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AudioUploadJob, Transcript } from "@sonolect/types";

interface LocalAudioStorePayload {
  audioJobs?: AudioUploadJob[];
  transcripts?: Transcript[];
  [key: string]: unknown;
}

export interface LocalAudioWorkerOptions {
  storePath: string;
  now?: () => Date;
  localSttCommand?: string;
  localSttCommandArgs?: string[];
  sttTimeoutMs?: number;
  allowMockTranscription?: boolean;
  signal?: AbortSignal;
}

export interface LocalAudioWorkerResult {
  job: AudioUploadJob;
  transcript?: Transcript;
}

const createNow = (options: LocalAudioWorkerOptions): string =>
  (options.now ?? (() => new Date()))().toISOString();

const readStore = async (
  storePath: string,
): Promise<LocalAudioStorePayload> => {
  try {
    const raw = await readFile(storePath, "utf8");
    return JSON.parse(raw) as LocalAudioStorePayload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { audioJobs: [], transcripts: [] };
    }
    throw error;
  }
};

const writeStore = async (
  storePath: string,
  payload: LocalAudioStorePayload,
): Promise<void> => {
  await mkdir(dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, storePath);
};

const mockTranscriptText = (job: AudioUploadJob): string => {
  const label = job.fileName?.trim() || job.id;
  const seconds = Number.isInteger(job.durationMs / 1000)
    ? `${job.durationMs / 1000}`
    : (job.durationMs / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `Mock transcript for ${label} (${seconds} seconds).`;
};

const isEnabled = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true";

const commandReplacements = (job: AudioUploadJob, transcript: Transcript) =>
  new Map<string, string>([
    ["audioPath", job.upload.localPath ?? ""],
    ["mimeType", job.upload.mimeType ?? job.mimeType],
    ["language", transcript.language],
  ]);

const resolveLocalSttCommandArgs = (
  commandArgsTemplate: string[],
  job: AudioUploadJob,
  transcript: Transcript,
): string[] => {
  const replacements = commandReplacements(job, transcript);
  return commandArgsTemplate.map((arg) =>
    arg.replace(
      /\{(audioPath|mimeType|language)\}/g,
      (_match, key: string) => replacements.get(key) ?? "",
    ),
  );
};

const textFromCommandOutput = (stdout: string): string => {
  const text = stdout.trim();
  if (!text) {
    throw new Error("Local STT command produced no transcript text");
  }
  return text;
};

class LocalSttCommandAbortedError extends Error {
  constructor() {
    super("Local STT command aborted");
    this.name = "LocalSttCommandAbortedError";
  }
}

const isAbortError = (error: unknown): boolean =>
  error instanceof LocalSttCommandAbortedError;

const runLocalSttCommandArgs = async (
  commandArgs: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const [file, ...args] = commandArgs;
    if (!file?.trim()) {
      reject(new Error("Local STT command args must include an executable"));
      return;
    }
    if (signal?.aborted) {
      reject(new LocalSttCommandAbortedError());
      return;
    }

    let settled = false;
    const child = execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (settled) return;
        settled = true;
        if (error) {
          const detail = stderr.trim() || stdout.trim() || error.message;
          reject(new Error(`Local STT command failed: ${detail}`));
          return;
        }
        try {
          resolve(textFromCommandOutput(stdout));
        } catch (outputError) {
          reject(outputError);
        }
      },
    );

    signal?.addEventListener(
      "abort",
      () => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        reject(new LocalSttCommandAbortedError());
      },
      { once: true },
    );
  });

const parseLocalSttCommandArgs = (
  value: string | undefined,
): string[] | undefined => {
  if (!value?.trim()) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new Error(
      "SONOLECT_LOCAL_STT_COMMAND_ARGS must be a JSON array of strings",
    );
  }
  return parsed;
};

const transcribeLocalAudio = async (
  job: AudioUploadJob,
  transcript: Transcript,
  options: LocalAudioWorkerOptions,
): Promise<{ text: string; tags: string[] }> => {
  const commandArgsTemplate =
    options.localSttCommandArgs ??
    parseLocalSttCommandArgs(process.env.SONOLECT_LOCAL_STT_COMMAND_ARGS);
  if (commandArgsTemplate?.length) {
    return {
      text: await runLocalSttCommandArgs(
        resolveLocalSttCommandArgs(commandArgsTemplate, job, transcript),
        options.sttTimeoutMs ?? 120_000,
        options.signal,
      ),
      tags: ["audio", "local-stt", "offline-transcribed"],
    };
  }

  const commandTemplate =
    options.localSttCommand ?? process.env.SONOLECT_LOCAL_STT_COMMAND;
  if (commandTemplate?.trim()) {
    throw new Error(
      "SONOLECT_LOCAL_STT_COMMAND is no longer supported due to command injection risks. Please use SONOLECT_LOCAL_STT_COMMAND_ARGS instead.",
    );
  }

  if (
    options.allowMockTranscription ||
    isEnabled(process.env.SONOLECT_ALLOW_MOCK_TRANSCRIPTION)
  ) {
    return {
      text: mockTranscriptText(job),
      tags: ["audio", "mock-transcribed"],
    };
  }

  throw new Error(
    "Set SONOLECT_LOCAL_STT_COMMAND or SONOLECT_LOCAL_STT_COMMAND_ARGS to an offline STT command, or explicitly enable mock transcription for tests/dev.",
  );
};

const byCreatedAtThenId = (a: AudioUploadJob, b: AudioUploadJob): number => {
  const created = a.createdAt.localeCompare(b.createdAt);
  return created === 0 ? a.id.localeCompare(b.id) : created;
};

const hasUploadedLocalAudio = (job: AudioUploadJob): boolean =>
  job.upload.storage === "local-file" &&
  job.upload.strategy === "binary-local" &&
  Boolean(job.upload.localPath?.trim());

const replaceById = <T extends { id: string }>(items: T[], item: T): T[] => {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
};

const mergeAudioJob = (
  latest: LocalAudioStorePayload,
  original: AudioUploadJob,
  update: AudioUploadJob,
): AudioUploadJob[] => {
  const audioJobs = [...(latest.audioJobs ?? [])];
  const current = audioJobs.find((job) => job.id === original.id) ?? original;
  return replaceById(audioJobs, { ...current, ...update });
};

const mergeTranscript = (
  latest: LocalAudioStorePayload,
  original: Transcript,
  update: Transcript,
): Transcript[] => {
  const transcripts = [...(latest.transcripts ?? [])];
  const current =
    transcripts.find((item) => item.id === original.id) ?? original;
  return replaceById(transcripts, { ...current, ...update });
};

export async function processNextQueuedAudioJob(
  options: LocalAudioWorkerOptions,
): Promise<LocalAudioWorkerResult | undefined> {
  const payload = await readStore(options.storePath);
  const audioJobs = [...(payload.audioJobs ?? [])];
  const transcripts = [...(payload.transcripts ?? [])];
  const queuedJob = audioJobs
    .filter((job) => job.status === "queued" && hasUploadedLocalAudio(job))
    .sort(byCreatedAtThenId)[0];

  if (!queuedJob) {
    return undefined;
  }

  const jobIndex = audioJobs.findIndex((job) => job.id === queuedJob.id);
  const startedAt = createNow(options);
  const {
    error: _queuedError,
    completedAt: _queuedCompletedAt,
    ...queuedJobInput
  } = queuedJob;
  const processingJob: AudioUploadJob = {
    ...queuedJobInput,
    status: "processing",
    updatedAt: startedAt,
  };
  audioJobs[jobIndex] = processingJob;
  await writeStore(options.storePath, { ...payload, audioJobs, transcripts });

  try {
    const transcriptIndex = transcripts.findIndex(
      (transcript) => transcript.id === processingJob.transcriptId,
    );
    if (transcriptIndex === -1) {
      throw new Error(`Transcript ${processingJob.transcriptId} not found`);
    }

    const completedAt = createNow(options);
    const originalTranscript = transcripts[transcriptIndex]!;
    const { text, tags } = await transcribeLocalAudio(
      processingJob,
      originalTranscript,
      options,
    );
    const transcript: Transcript = {
      ...originalTranscript,
      status: "completed",
      rawText: text,
      finalText: text,
      tags: Array.from(
        new Set([
          ...originalTranscript.tags.filter(
            (tag) => tag !== "queued" && tag !== "mock-transcribed",
          ),
          ...tags,
        ]),
      ),
      updatedAt: completedAt,
    };
    const { error: _processingError, ...processingJobInput } = processingJob;
    const job: AudioUploadJob = {
      ...processingJobInput,
      status: "completed",
      updatedAt: completedAt,
      completedAt,
    };

    const latestPayload = await readStore(options.storePath);
    await writeStore(options.storePath, {
      ...latestPayload,
      audioJobs: mergeAudioJob(latestPayload, processingJob, job),
      transcripts: mergeTranscript(
        latestPayload,
        originalTranscript,
        transcript,
      ),
    });
    return { job, transcript };
  } catch (error) {
    const failedAt = createNow(options);
    const transcriptIndex = transcripts.findIndex(
      (transcript) => transcript.id === processingJob.transcriptId,
    );
    const originalTranscript = transcripts[transcriptIndex];

    if (isAbortError(error)) {
      const restoredJob: AudioUploadJob = {
        ...processingJob,
        status: "queued",
        updatedAt: failedAt,
      };
      const restoredTranscript: Transcript | undefined = originalTranscript
        ? {
            ...originalTranscript,
            status: "processing",
            tags: Array.from(new Set([...originalTranscript.tags, "queued"])),
            updatedAt: failedAt,
          }
        : undefined;
      const latestPayload = await readStore(options.storePath);
      await writeStore(options.storePath, {
        ...latestPayload,
        audioJobs: mergeAudioJob(latestPayload, processingJob, restoredJob),
        transcripts: restoredTranscript
          ? mergeTranscript(
              latestPayload,
              originalTranscript!,
              restoredTranscript,
            )
          : [...(latestPayload.transcripts ?? [])],
      });
      return {
        job: restoredJob,
        ...(restoredTranscript ? { transcript: restoredTranscript } : {}),
      };
    }

    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown local audio worker error";
    const job: AudioUploadJob = {
      ...processingJob,
      status: "failed",
      updatedAt: failedAt,
      error: errorMessage,
    };
    const failedTranscript: Transcript | undefined = originalTranscript
      ? {
          ...originalTranscript,
          status: "failed",
          tags: Array.from(
            new Set([
              ...originalTranscript.tags.filter((tag) => tag !== "queued"),
              "local-stt",
              "transcription-failed",
            ]),
          ),
          updatedAt: failedAt,
        }
      : undefined;

    const latestPayload = await readStore(options.storePath);
    await writeStore(options.storePath, {
      ...latestPayload,
      audioJobs: mergeAudioJob(latestPayload, processingJob, job),
      transcripts: failedTranscript
        ? mergeTranscript(latestPayload, originalTranscript!, failedTranscript)
        : [...(latestPayload.transcripts ?? [])],
    });
    return {
      job,
      ...(failedTranscript ? { transcript: failedTranscript } : {}),
    };
  }
}

export async function processQueuedAudioJobs(
  options: LocalAudioWorkerOptions,
): Promise<LocalAudioWorkerResult[]> {
  const results: LocalAudioWorkerResult[] = [];
  for (;;) {
    const result = await processNextQueuedAudioJob(options);
    if (!result) {
      return results;
    }
    results.push(result);
  }
}

const resolveStorePath = (): string => {
  const storePath =
    process.env.SONOLECT_LOCAL_STORE_PATH ??
    process.env.SONOLECT_API_STORE_PATH;
  if (!storePath) {
    throw new Error(
      "Set SONOLECT_LOCAL_STORE_PATH or SONOLECT_API_STORE_PATH to process local audio jobs.",
    );
  }
  return storePath;
};

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const storePath = resolveStorePath();
  const once = process.argv.includes("--once");
  const results = once
    ? [await processNextQueuedAudioJob({ storePath })].filter(
        (result): result is LocalAudioWorkerResult => Boolean(result),
      )
    : await processQueuedAudioJobs({ storePath });

  console.log(
    JSON.stringify(
      {
        processed: results.length,
        completed: results.filter((result) => result.job.status === "completed")
          .length,
        failed: results.filter((result) => result.job.status === "failed")
          .length,
      },
      null,
      2,
    ),
  );
}
