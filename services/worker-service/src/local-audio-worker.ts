import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
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

const DEFAULT_STT_TIMEOUT_MS = 120_000;

const isEnabled = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true";

const languageTagPattern = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;
const audioMimeTypePattern = /^audio\/[a-z0-9.+-]+$/i;

// execFile passes each value as its own argument, so no shell ever sees them.
// A value can still be read as an option by the speech engine ("--model=..."),
// and language and MIME type come from user-editable records. Each placeholder
// is checked before it is substituted so it can only ever be plain data.
const placeholderValidators: Record<
  string,
  { valid: (value: string) => boolean; reason: string }
> = {
  audioPath: {
    valid: (value) => isAbsolute(value),
    reason: "the audio path must be an absolute file path",
  },
  mimeType: {
    valid: (value) => value.length <= 100 && audioMimeTypePattern.test(value),
    reason: "the MIME type must be an audio MIME type",
  },
  language: {
    valid: (value) => value.length <= 35 && languageTagPattern.test(value),
    reason: "the language must be a language tag such as en or fr-CA",
  },
};

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
    arg.replace(/\{(audioPath|mimeType|language)\}/g, (_match, key: string) => {
      const value = replacements.get(key) ?? "";
      const validator = placeholderValidators[key];
      if (validator && !validator.valid(value))
        throw new Error(`Local STT command refused: ${validator.reason}`);
      return value;
    }),
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
    // A daemon passes the same signal to every job, so the listener is
    // removed when the command ends instead of piling up on the signal.
    const onAbort = () => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new LocalSttCommandAbortedError());
    };
    const child = execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        signal?.removeEventListener("abort", onAbort);
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

    signal?.addEventListener("abort", onAbort, { once: true });
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
        options.sttTimeoutMs ?? DEFAULT_STT_TIMEOUT_MS,
        options.signal,
      ),
      tags: ["audio", "local-stt", "offline-transcribed"],
    };
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
    "Set SONOLECT_LOCAL_STT_COMMAND_ARGS to an offline STT command, or explicitly enable mock transcription for tests/dev.",
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

/**
 * Applies `update` to the latest stored copy of a record, not to the copy
 * read when the job was claimed. The engine can run for minutes, and the user
 * can rename or tag the transcript meanwhile: `update` sets only the fields
 * the worker owns, so those edits survive.
 */
const mergeLatest = <T extends { id: string }>(
  latest: T[] | undefined,
  original: T,
  update: (current: T) => T,
): { items: T[]; item: T } => {
  const items = [...(latest ?? [])];
  const item = update(
    items.find((each) => each.id === original.id) ?? original,
  );
  return { items: replaceById(items, item), item };
};

const uniqueTags = (tags: string[]): string[] => Array.from(new Set(tags));

/**
 * How long past the engine timeout a "processing" claim may stand. A job
 * still "processing" after that was claimed by a worker that stopped before
 * it finished (killed, or the machine slept), so it is taken again.
 */
const STALE_CLAIM_MARGIN_MS = 60_000;

export async function processNextQueuedAudioJob(
  options: LocalAudioWorkerOptions,
): Promise<LocalAudioWorkerResult | undefined> {
  const payload = await readStore(options.storePath);
  const audioJobs = [...(payload.audioJobs ?? [])];
  const transcripts = [...(payload.transcripts ?? [])];
  const staleBefore =
    Date.parse(createNow(options)) -
    (options.sttTimeoutMs ?? DEFAULT_STT_TIMEOUT_MS) -
    STALE_CLAIM_MARGIN_MS;
  const isClaimable = (job: AudioUploadJob): boolean =>
    job.status === "queued" ||
    (job.status === "processing" && Date.parse(job.updatedAt) < staleBefore);
  const queuedJob = audioJobs
    .filter((job) => isClaimable(job) && hasUploadedLocalAudio(job))
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
    const latestPayload = await readStore(options.storePath);
    const jobs = mergeLatest(
      latestPayload.audioJobs,
      processingJob,
      (current): AudioUploadJob => {
        const { error: _error, ...currentJob } = current;
        return {
          ...currentJob,
          status: "completed",
          updatedAt: completedAt,
          completedAt,
        };
      },
    );
    const merged = mergeLatest(
      latestPayload.transcripts,
      originalTranscript,
      (current): Transcript => ({
        ...current,
        status: "completed",
        rawText: text,
        finalText: text,
        tags: uniqueTags([
          ...current.tags.filter(
            (tag) => tag !== "queued" && tag !== "mock-transcribed",
          ),
          ...tags,
        ]),
        updatedAt: completedAt,
      }),
    );
    await writeStore(options.storePath, {
      ...latestPayload,
      audioJobs: jobs.items,
      transcripts: merged.items,
    });
    return { job: jobs.item, transcript: merged.item };
  } catch (error) {
    const failedAt = createNow(options);
    const originalTranscript = transcripts.find(
      (transcript) => transcript.id === processingJob.transcriptId,
    );
    const aborted = isAbortError(error);
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown local audio worker error";

    const latestPayload = await readStore(options.storePath);
    // An aborted job goes back to the queue. Any other error fails it.
    const jobs = mergeLatest(
      latestPayload.audioJobs,
      processingJob,
      (current): AudioUploadJob =>
        aborted
          ? { ...current, status: "queued", updatedAt: failedAt }
          : {
              ...current,
              status: "failed",
              updatedAt: failedAt,
              error: errorMessage,
            },
    );
    const merged = originalTranscript
      ? mergeLatest(
          latestPayload.transcripts,
          originalTranscript,
          (current): Transcript =>
            aborted
              ? {
                  ...current,
                  status: "processing",
                  tags: uniqueTags([...current.tags, "queued"]),
                  updatedAt: failedAt,
                }
              : {
                  ...current,
                  status: "failed",
                  tags: uniqueTags([
                    ...current.tags.filter((tag) => tag !== "queued"),
                    "local-stt",
                    "transcription-failed",
                  ]),
                  updatedAt: failedAt,
                },
        )
      : undefined;
    await writeStore(options.storePath, {
      ...latestPayload,
      audioJobs: jobs.items,
      transcripts: merged?.items ?? [...(latestPayload.transcripts ?? [])],
    });
    return {
      job: jobs.item,
      ...(merged ? { transcript: merged.item } : {}),
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
