import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AudioUploadJob, Transcript } from "@sonolect/types";

export interface TranscriptListOptions {
  includeDeleted?: boolean | undefined;
  cursor?: string | undefined;
  limit: number;
}

export interface TranscriptRepository {
  listForUser(
    userId: string,
    options: TranscriptListOptions,
  ): Promise<{ items: Transcript[]; nextCursor?: string }>;
  listChangedForUser(userId: string, since?: string): Promise<Transcript[]>;
  countActiveForUser(userId: string): Promise<number>;
  getById(id: string): Promise<Transcript | undefined>;
  save(transcript: Transcript): Promise<void>;
}

/** The list cursor names no transcript of this user. */
export class InvalidCursorError extends Error {
  constructor() {
    super("Unknown cursor");
    this.name = "InvalidCursorError";
  }
}

/** Newest first; the id breaks ties, so the order never changes between pages. */
const newestFirst = (a: Transcript, b: Transcript): number =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

export class InMemoryTranscriptRepository implements TranscriptRepository {
  constructor(private readonly transcripts = new Map<string, Transcript>()) {}

  get store(): Map<string, Transcript> {
    return this.transcripts;
  }

  /**
   * The cursor is the id of the last item of the previous page. The next page
   * starts after that item's place in the order, so it still works when that
   * item was deleted in between. A cursor that names no transcript of this
   * user throws InvalidCursorError instead of starting over.
   */
  async listForUser(
    userId: string,
    options: TranscriptListOptions,
  ): Promise<{ items: Transcript[]; nextCursor?: string }> {
    const owned = [...this.transcripts.values()].filter(
      (transcript) => transcript.userId === userId,
    );
    const sorted = owned
      .filter((transcript) => options.includeDeleted || !transcript.deletedAt)
      .sort(newestFirst);
    let start = 0;
    if (options.cursor) {
      const anchor = owned.find((item) => item.id === options.cursor);
      if (!anchor) throw new InvalidCursorError();
      const after = sorted.findIndex((item) => newestFirst(anchor, item) < 0);
      start = after === -1 ? sorted.length : after;
    }
    const items = sorted.slice(start, start + options.limit);
    const lastItem = items.at(-1);
    const nextCursor =
      start + options.limit < sorted.length ? lastItem?.id : undefined;
    return {
      items,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  async listChangedForUser(
    userId: string,
    since?: string,
  ): Promise<Transcript[]> {
    const changedAfter = since ? Date.parse(since) : 0;
    return [...this.transcripts.values()]
      .filter(
        (transcript) =>
          transcript.userId === userId &&
          Date.parse(transcript.updatedAt) > changedAfter,
      )
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }

  async countActiveForUser(userId: string): Promise<number> {
    return [...this.transcripts.values()].filter(
      (item) => item.userId === userId && !item.deletedAt,
    ).length;
  }

  async getById(id: string): Promise<Transcript | undefined> {
    return this.transcripts.get(id);
  }

  async save(transcript: Transcript): Promise<void> {
    this.transcripts.set(transcript.id, transcript);
  }
}

export interface FileStorePayload {
  transcripts?: Transcript[];
  audioJobs?: AudioUploadJob[];
  [key: string]: unknown;
}

export const readFileStore = async (
  storePath: string,
): Promise<FileStorePayload> => {
  try {
    const raw = await readFile(storePath, "utf8");
    return JSON.parse(raw) as FileStorePayload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
};

export const writeFileStore = async (
  storePath: string,
  payload: FileStorePayload,
): Promise<void> => {
  await mkdir(dirname(storePath), { recursive: true });
  // A random name, created exclusively: two writes never share a temp file.
  const tempPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    await rename(tempPath, storePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
};

const fileStoreQueues = new Map<string, Promise<unknown>>();

/**
 * Applies `change` to the store file: reads it, writes what `change`
 * returns. Changes to one file run one at a time in this process, so a
 * change never works from a copy that another change is about to replace.
 * Reads need no lock: each write replaces the file in one rename.
 */
export const updateFileStore = async (
  storePath: string,
  change: (payload: FileStorePayload) => FileStorePayload,
): Promise<void> => {
  const key = resolve(storePath);
  const previous = fileStoreQueues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const payload = await readFileStore(storePath);
      await writeFileStore(storePath, change(payload));
    });
  fileStoreQueues.set(key, next);
  try {
    await next;
  } finally {
    if (fileStoreQueues.get(key) === next) fileStoreQueues.delete(key);
  }
};

/**
 * Transcripts in the JSON file at `storePath`. Every call reads the file, so
 * there is no shared copy that a concurrent request could clear or replace.
 */
export class FileTranscriptRepository implements TranscriptRepository {
  constructor(private readonly storePath: string) {}

  async listForUser(
    userId: string,
    options: TranscriptListOptions,
  ): Promise<{ items: Transcript[]; nextCursor?: string }> {
    return (await this.read()).listForUser(userId, options);
  }

  async listChangedForUser(
    userId: string,
    since?: string,
  ): Promise<Transcript[]> {
    return (await this.read()).listChangedForUser(userId, since);
  }

  async countActiveForUser(userId: string): Promise<number> {
    return (await this.read()).countActiveForUser(userId);
  }

  async getById(id: string): Promise<Transcript | undefined> {
    return (await this.read()).getById(id);
  }

  async save(transcript: Transcript): Promise<void> {
    await updateFileStore(this.storePath, (payload) => {
      const transcripts = transcriptMap(payload);
      transcripts.set(transcript.id, transcript);
      return {
        ...payload,
        transcripts: [...transcripts.values()].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        ),
      };
    });
  }

  private async read(): Promise<InMemoryTranscriptRepository> {
    return new InMemoryTranscriptRepository(
      transcriptMap(await readFileStore(this.storePath)),
    );
  }
}

const transcriptMap = (payload: FileStorePayload): Map<string, Transcript> => {
  const transcripts = new Map<string, Transcript>();
  for (const transcript of payload.transcripts ?? []) {
    if (transcript?.id) {
      transcripts.set(transcript.id, transcript);
    }
  }
  return transcripts;
};
