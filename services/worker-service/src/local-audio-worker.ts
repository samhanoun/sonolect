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

const byCreatedAtThenId = (a: AudioUploadJob, b: AudioUploadJob): number => {
  const created = a.createdAt.localeCompare(b.createdAt);
  return created === 0 ? a.id.localeCompare(b.id) : created;
};

const hasUploadedLocalAudio = (job: AudioUploadJob): boolean =>
  job.upload.storage === "local-file" &&
  job.upload.strategy === "binary-local" &&
  Boolean(job.upload.localPath?.trim());

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
    const text = mockTranscriptText(processingJob);
    const transcript: Transcript = {
      ...transcripts[transcriptIndex]!,
      status: "completed",
      rawText: text,
      finalText: text,
      tags: Array.from(
        new Set([
          ...transcripts[transcriptIndex]!.tags.filter(
            (tag) => tag !== "queued",
          ),
          "audio",
          "mock-transcribed",
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

    transcripts[transcriptIndex] = transcript;
    audioJobs[jobIndex] = job;
    await writeStore(options.storePath, { ...payload, audioJobs, transcripts });
    return { job, transcript };
  } catch (error) {
    const failedAt = createNow(options);
    const job: AudioUploadJob = {
      ...processingJob,
      status: "failed",
      updatedAt: failedAt,
      error:
        error instanceof Error
          ? error.message
          : "Unknown local audio worker error",
    };
    audioJobs[jobIndex] = job;
    await writeStore(options.storePath, { ...payload, audioJobs, transcripts });
    return { job };
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
