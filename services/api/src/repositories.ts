import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

export class InMemoryTranscriptRepository implements TranscriptRepository {
  constructor(private readonly transcripts = new Map<string, Transcript>()) {}

  get store(): Map<string, Transcript> {
    return this.transcripts;
  }

  async listForUser(
    userId: string,
    options: TranscriptListOptions,
  ): Promise<{ items: Transcript[]; nextCursor?: string }> {
    const sorted = [...this.transcripts.values()]
      .filter((transcript) => transcript.userId === userId)
      .filter((transcript) => options.includeDeleted || !transcript.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = options.cursor
      ? Math.max(0, sorted.findIndex((item) => item.id === options.cursor) + 1)
      : 0;
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
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, storePath);
};

export class FileTranscriptRepository implements TranscriptRepository {
  private readonly transcripts = new Map<string, Transcript>();

  constructor(private readonly storePath: string) {}

  async listForUser(
    userId: string,
    options: TranscriptListOptions,
  ): Promise<{ items: Transcript[]; nextCursor?: string }> {
    await this.load();
    return new InMemoryTranscriptRepository(this.transcripts).listForUser(
      userId,
      options,
    );
  }

  async listChangedForUser(
    userId: string,
    since?: string,
  ): Promise<Transcript[]> {
    await this.load();
    return new InMemoryTranscriptRepository(
      this.transcripts,
    ).listChangedForUser(userId, since);
  }

  async countActiveForUser(userId: string): Promise<number> {
    await this.load();
    return new InMemoryTranscriptRepository(
      this.transcripts,
    ).countActiveForUser(userId);
  }

  async getById(id: string): Promise<Transcript | undefined> {
    await this.load();
    return this.transcripts.get(id);
  }

  async save(transcript: Transcript): Promise<void> {
    await this.load();
    this.transcripts.set(transcript.id, transcript);
    await this.flush();
  }

  private async load(): Promise<void> {
    const payload = await readFileStore(this.storePath);
    this.transcripts.clear();
    for (const transcript of payload.transcripts ?? []) {
      if (transcript?.id) {
        this.transcripts.set(transcript.id, transcript);
      }
    }
  }

  private async flush(): Promise<void> {
    const existing = await readFileStore(this.storePath);
    const payload: FileStorePayload = {
      ...existing,
      transcripts: [...this.transcripts.values()].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
    };
    await writeFileStore(this.storePath, payload);
  }
}
