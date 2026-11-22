import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import {
  registerAiRoutes,
  type AiProviders,
  type AiRouteLimits,
} from "./ai.js";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  FileTranscriptRepository,
  InMemoryTranscriptRepository,
  InvalidCursorError,
  readFileStore,
  type TranscriptRepository,
  updateFileStore,
} from "./repositories.js";
import {
  registerAuthMiddleware,
  createAuthConfig,
  type AuthOptions,
  type AuthenticatedActor,
} from "./auth.js";
export {
  FileTranscriptRepository,
  InMemoryTranscriptRepository,
  InvalidCursorError,
  readFileStore,
  type TranscriptRepository,
  updateFileStore,
  writeFileStore,
} from "./repositories.js";
export {
  resolveAuthenticatedActor,
  type AuthenticatedActor,
  type VerifyToken,
} from "./auth.js";
import type {
  AudioUploadJob,
  CommandExecutionResult,
  ListResponse,
  SyncManifest,
  SyncManifestItem,
  Transcript,
  UsageQuotaSummary,
  User,
} from "@sonolect/types";
import {
  commandExecutionRequestSchema,
  createAudioUploadJobSchema,
  createTranscriptSchema,
  listTranscriptsQuerySchema,
  syncManifestQuerySchema,
  updateTranscriptSchema,
  type CommandExecutionInput,
  type CreateAudioUploadJobInput,
  type CreateTranscriptInput,
  type ListTranscriptsQuery,
  type SyncManifestQuery,
  type UpdateTranscriptInput,
} from "@sonolect/validation";

const serviceName = "sonolect-api";
const defaultLocalUserId = "local-user";
const localNow = new Date().toISOString();
const defaultAudioMaxBytes = 100 * 1024 * 1024;

/**
 * Routes that keep their data only in this process (memory, a temp dir or a
 * local JSON file) or answer with made-up values: audio jobs that nothing
 * transcribes, a command "executor" that runs nothing, a fixed quota, and a
 * profile, transcripts and a sync manifest that a restart or a second instance
 * loses. They serve local development and the local audio worker. Production
 * does not register them unless SONOLECT_API_PREVIEW_ROUTES=1 is set.
 */
export const PREVIEW_ROUTES = [
  "GET /users/profile",
  "POST /audio/jobs",
  "GET /audio/jobs/:id",
  "POST /audio/jobs/:id/audio",
  "GET /transcripts",
  "POST /transcripts",
  "GET /transcripts/:id",
  "PATCH /transcripts/:id",
  "DELETE /transcripts/:id",
  "POST /commands/execute",
  "GET /usage/quota",
  "GET /sync/manifest",
] as const;

const previewRoutesFlag = (value: string | undefined): boolean =>
  value === "1" || value === "true";

type RouteContext = { userId: string; actor: AuthenticatedActor };

export interface InMemoryStores {
  users: Map<string, User>;
  transcripts: Map<string, Transcript>;
  commands: Map<string, CommandExecutionResult>;
  audioJobs: Map<string, AudioUploadJob>;
}

const sanitizeLocalUserId = (value: string | undefined): string => {
  const trimmed = value?.trim();
  return trimmed && /^[a-zA-Z0-9._-]+$/.test(trimmed)
    ? trimmed
    : defaultLocalUserId;
};

const getLocalUserId = (options: Pick<CreateAppOptions, "localUserId">) =>
  sanitizeLocalUserId(
    options.localUserId ?? process.env.SONOLECT_LOCAL_USER_ID,
  );

const createStores = (localUserId = defaultLocalUserId): InMemoryStores => ({
  users: new Map<string, User>([
    [
      localUserId,
      {
        id: localUserId,
        email:
          localUserId === defaultLocalUserId
            ? "local@sonolect.dev"
            : `${localUserId}@local.sonolect.dev`,
        name:
          localUserId === defaultLocalUserId
            ? "Local Sonolect User"
            : `Local Sonolect User (${localUserId})`,
        plan: "pro",
        createdAt: localNow,
        updatedAt: localNow,
      },
    ],
  ]),
  transcripts: new Map<string, Transcript>(),
  commands: new Map<string, CommandExecutionResult>(),
  audioJobs: new Map<string, AudioUploadJob>(),
});

const getRouteContext = (request: FastifyRequest): RouteContext => {
  const actor = request.actor ?? {
    userId: defaultLocalUserId,
    provider: "anonymous",
  };
  return {
    userId: actor.userId,
    actor,
  };
};

const parseBody = <T>(
  schema: { parse: (value: unknown) => T },
  request: FastifyRequest,
): T => schema.parse(request.body ?? {});
const parseQuery = <T>(
  schema: { parse: (value: unknown) => T },
  request: FastifyRequest,
): T => schema.parse(request.query ?? {});

const sendValidationError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof z.ZodError) {
    return reply.status(400).send({
      error: "validation_error",
      message: "Request validation failed",
      issues: error.issues,
    });
  }
  throw error;
};

const optionalProps = (
  value: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).filter(([, prop]) => prop !== undefined),
  );

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const getAudioDir = (optionValue: string | undefined): string => {
  const rawValue =
    optionValue ??
    process.env.SONOLECT_API_AUDIO_DIR ??
    join(tmpdir(), "sonolect-api-audio");
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw Object.assign(new Error("Invalid audio storage root"), {
      statusCode: 500,
      errorCode: "storage_path_error",
    });
  }
  return resolve(trimmed);
};

const getAudioMaxBytes = (optionValue: number | undefined): number =>
  optionValue && Number.isSafeInteger(optionValue) && optionValue > 0
    ? optionValue
    : parsePositiveInteger(
        process.env.SONOLECT_API_AUDIO_MAX_BYTES,
        defaultAudioMaxBytes,
      );

const getSingleHeader = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

const getAudioMimeType = (request: FastifyRequest): string | undefined =>
  getSingleHeader(request.headers["content-type"])
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();

const isAudioMimeType = (value: string | undefined): value is string =>
  Boolean(value && /^audio\/[a-z0-9.+-]+$/i.test(value));

export const safePathSegment = (value: string): string => {
  let safe = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  while (safe.includes("..")) {
    safe = safe.replace(/\.\./g, "__");
  }
  return safe && safe !== "." && safe !== ".." ? safe : "_";
};

const extensionForAudioMimeType = (mimeType: string): string => {
  const subtype = mimeType.split("/")[1]?.split("+")[0] ?? "bin";
  return safePathSegment(subtype) || "bin";
};

/**
 * The longest part of the client's file name kept on disk. With the job id
 * and the temp-file suffix, the name stays under the usual 255-byte limit.
 * The end is kept, so the extension survives.
 */
const MAX_STORED_FILE_NAME_CHARS = 100;

const storageFileNameForAudioJob = (
  job: AudioUploadJob,
  mimeType: string,
): string => {
  const configuredFileName = job.fileName?.trim();
  const safeJobId = safePathSegment(job.id);
  if (configuredFileName) {
    const safeFileName = safePathSegment(configuredFileName).slice(
      -MAX_STORED_FILE_NAME_CHARS,
    );
    return `${safeJobId}-${safeFileName}`;
  }
  const extension = extensionForAudioMimeType(mimeType);
  return `${safeJobId}.${extension}`;
};

export const assertPathInside = (root: string, target: string): string => {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)
  ) {
    throw Object.assign(new Error("Unsafe audio storage path"), {
      statusCode: 500,
      errorCode: "storage_path_error",
    });
  }
  return resolvedTarget;
};

const ensureAudioStorageRoot = async (root: string): Promise<string> => {
  const resolvedRoot = assertPathInside(root, root);
  try {
    const existingStats = await stat(resolvedRoot);
    if (!existingStats.isDirectory()) {
      throw Object.assign(new Error("Audio storage root is not a directory"), {
        statusCode: 500,
        errorCode: "storage_path_error",
      });
    }
    return resolvedRoot;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
  await mkdir(resolvedRoot, { recursive: true });
  const rootStats = await stat(resolvedRoot);
  if (!rootStats.isDirectory()) {
    throw Object.assign(new Error("Audio storage root is not a directory"), {
      statusCode: 500,
      errorCode: "storage_path_error",
    });
  }
  return resolvedRoot;
};

const writeFileAtomic = async (
  root: string,
  targetPath: string,
  body: Buffer,
): Promise<void> => {
  const resolvedTarget = assertPathInside(root, targetPath);
  const tempPath = assertPathInside(
    root,
    `${resolvedTarget}.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(tempPath, body, { flag: "wx" });
  try {
    await rename(tempPath, resolvedTarget);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
};

const createTranscript = (
  userId: string,
  input: CreateTranscriptInput,
): Transcript => {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    language: input.language,
    mode: input.mode,
    privacyMode: input.privacyMode,
    status: input.status,
    tags: input.tags,
    createdAt: now,
    updatedAt: now,
    ...optionalProps({
      title: input.title,
      rawText: input.rawText,
      finalText: input.finalText,
      workspaceId: input.workspaceId,
      agentUsed: input.agentUsed,
      durationMs: input.durationMs,
    }),
  } as Transcript;
};

const toManifestItems = async (
  transcriptRepository: TranscriptRepository,
  stores: InMemoryStores,
  userId: string,
  since?: string,
): Promise<SyncManifestItem[]> => {
  const changedAfter = since ? Date.parse(since) : 0;
  const visibleTranscripts = await transcriptRepository.listChangedForUser(
    userId,
    since,
  );
  const visibleCommands = [...stores.commands.values()].filter(
    (command) =>
      command.userId === userId && Date.parse(command.createdAt) > changedAfter,
  );

  return [
    ...visibleTranscripts.map((transcript) => ({
      id: transcript.id,
      entity: "transcript" as const,
      updatedAt: transcript.updatedAt,
      deleted: Boolean(transcript.deletedAt),
    })),
    ...visibleCommands.map((command) => ({
      id: command.id,
      entity: "command" as const,
      updatedAt: command.completedAt ?? command.createdAt,
      deleted: false,
    })),
  ].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
};

export interface CreateAppOptions extends AuthOptions {
  allowedOrigins?: string[];
  stores?: InMemoryStores;
  transcriptRepository?: TranscriptRepository;
  storePath?: string;
  audioDir?: string;
  audioMaxBytes?: number;
  logger?: FastifyServerOptions["logger"];
  /**
   * Registers PREVIEW_ROUTES in production too. Defaults to
   * SONOLECT_API_PREVIEW_ROUTES=1 (or "true"). Outside production they are
   * always registered.
   */
  previewRoutes?: boolean;
  /** Per-account request budget for the paid /v1 AI routes. */
  aiRouteLimits?: AiRouteLimits;
  /** Replaces the Google calls behind the /v1 routes (tests only). */
  aiProviders?: Partial<AiProviders>;
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const resolvedLocalUserId = getLocalUserId(options);
  const stores = options.stores ?? createStores(resolvedLocalUserId);
  const authOptions = { ...options, localUserId: resolvedLocalUserId };
  const authConfig = createAuthConfig(authOptions);
  const origins =
    options.allowedOrigins ??
    process.env.SONOLECT_ALLOWED_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ??
    (authConfig.nodeEnv === "production"
      ? []
      : [
          "http://localhost:5173",
          "http://127.0.0.1:5173",
          "http://tauri.localhost",
          "https://tauri.localhost",
          "tauri://localhost",
        ]);
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (
      !["http:", "https:", "tauri:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname && parsed.pathname !== "/") ||
      origin.includes("*")
    )
      throw new Error(
        "Allowed origins must be exact origins without paths, credentials, or wildcards",
      );
  }
  const production = authConfig.nodeEnv === "production";
  const previewRoutesOn =
    !production ||
    (options.previewRoutes ??
      previewRoutesFlag(process.env.SONOLECT_API_PREVIEW_ROUTES));
  const storePath = options.storePath ?? process.env.SONOLECT_API_STORE_PATH;
  const audioDir = getAudioDir(options.audioDir);
  if (previewRoutesOn) await ensureAudioStorageRoot(audioDir);
  const audioMaxBytes = getAudioMaxBytes(options.audioMaxBytes);
  const transcriptRepository =
    options.transcriptRepository ??
    (storePath
      ? new FileTranscriptRepository(storePath)
      : new InMemoryTranscriptRepository(stores.transcripts));
  // With a store file, the file is the record: the local audio worker
  // completes jobs in it. A read takes every job from the file. It never
  // clears the map, so it cannot drop a job that another request is writing.
  const syncAudioJobsFromFileStore = async (): Promise<void> => {
    if (!storePath) return;
    const payload = await readFileStore(storePath);
    for (const job of payload.audioJobs ?? []) {
      if (job?.id) {
        stores.audioJobs.set(job.id, job);
      }
    }
  };
  // Writes only this job, into the file as it is now. Other jobs in the file,
  // and the transcripts, stay as they are.
  const saveAudioJob = async (job: AudioUploadJob): Promise<void> => {
    stores.audioJobs.set(job.id, job);
    if (!storePath) return;
    await updateFileStore(storePath, (payload) => ({
      ...payload,
      audioJobs: [
        ...(payload.audioJobs ?? []).filter((item) => item?.id !== job.id),
        job,
      ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }));
  };
  const app = Fastify({ logger: options.logger ?? true });
  // Set before any route, so every route uses it. A 5xx error can carry server
  // details, such as a storage path in a file system error: it is logged and
  // answered with a generic message. A 4xx error describes the request and
  // keeps Fastify's answer. The rate limiter throws a plain object, not an
  // Error, which is sent as it is with its status.
  app.setErrorHandler((error, request, reply) => {
    const { statusCode } = error as { statusCode?: unknown };
    if (
      typeof statusCode === "number" &&
      statusCode >= 400 &&
      statusCode < 500
    ) {
      reply.status(statusCode);
      return reply.send(error);
    }
    request.log.error({ err: error }, "request failed");
    return reply
      .status(500)
      .send({ error: "internal_error", message: "Internal server error" });
  });
  if (production) {
    if (previewRoutesOn)
      app.log.warn(
        { routes: PREVIEW_ROUTES },
        "SONOLECT_API_PREVIEW_ROUTES is on in production. These routes keep data only in this process and lose it on restart.",
      );
    else
      app.log.info(
        { routes: PREVIEW_ROUTES },
        "Preview routes are off in production and answer 404. Set SONOLECT_API_PREVIEW_ROUTES=1 to turn them on.",
      );
  }
  // Routes registered on `preview` exist only when preview routes are on.
  const preview = previewRoutesOn ? app : undefined;

  // Fastify tests the pattern against the whole header, parameters included,
  // and recorders send types such as `audio/webm;codecs=opus`.
  app.addContentTypeParser(
    /^audio\/[a-z0-9.+-]+(?:\s*;.*)?$/i,
    { parseAs: "buffer", bodyLimit: audioMaxBytes },
    (_request, body, done) => done(null, body),
  );

  await app.register(helmet);
  await app.register(cors, {
    origin: origins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization"],
    maxAge: 600,
  });
  registerAuthMiddleware(app, authConfig);

  app.get("/health", async () => ({ status: "ok", service: serviceName }));

  preview?.get("/users/profile", async (request) => {
    const { userId, actor } = getRouteContext(request);
    const now = new Date().toISOString();
    const user = stores.users.get(userId) ?? {
      id: userId,
      email: actor.email ?? `${userId}@local.sonolect.dev`,
      plan: "free" as const,
      createdAt: now,
      updatedAt: now,
    };
    stores.users.set(userId, user);
    return user;
  });

  preview?.post(
    "/audio/jobs",
    async (request, reply): Promise<AudioUploadJob | FastifyReply> => {
      try {
        const { userId } = getRouteContext(request);
        const input = parseBody<CreateAudioUploadJobInput>(
          createAudioUploadJobSchema,
          request,
        );
        const now = new Date().toISOString();
        const transcript: Transcript = {
          id: randomUUID(),
          userId,
          language: input.language ?? "en",
          mode: "dictate",
          privacyMode: false,
          status: "processing",
          tags: ["audio", "queued"],
          createdAt: now,
          updatedAt: now,
          durationMs: input.durationMs,
          ...optionalProps({ title: input.transcriptTitle }),
        } as Transcript;
        await transcriptRepository.save(transcript);

        const job: AudioUploadJob = {
          id: randomUUID(),
          userId,
          transcriptId: transcript.id,
          status: "queued",
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          durationMs: input.durationMs,
          source: input.source,
          upload: {
            strategy: "inline-metadata",
            storage: "local-placeholder",
          },
          createdAt: now,
          updatedAt: now,
          ...optionalProps({ fileName: input.fileName }),
        } as AudioUploadJob;
        await saveAudioJob(job);
        return reply.status(201).send(job);
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  preview?.get<{ Params: { id: string } }>(
    "/audio/jobs/:id",
    async (request, reply): Promise<AudioUploadJob | FastifyReply> => {
      const { userId } = getRouteContext(request);
      await syncAudioJobsFromFileStore();
      const job = stores.audioJobs.get(request.params.id);
      if (!job || job.userId !== userId) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Audio job not found" });
      }
      return job;
    },
  );

  preview?.post<{ Params: { id: string } }>(
    "/audio/jobs/:id/audio",
    async (request, reply): Promise<AudioUploadJob | FastifyReply> => {
      const { userId } = getRouteContext(request);
      await syncAudioJobsFromFileStore();
      const job = stores.audioJobs.get(request.params.id);
      if (!job || job.userId !== userId) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Audio job not found" });
      }

      const mimeType = getAudioMimeType(request);
      if (!isAudioMimeType(mimeType)) {
        return reply.status(415).send({
          error: "unsupported_media_type",
          message: "Audio upload requires an audio/* Content-Type",
        });
      }

      if (!Buffer.isBuffer(request.body)) {
        return reply.status(400).send({
          error: "invalid_audio_body",
          message: "Audio upload requires a binary request body",
        });
      }

      const audioBody = request.body;
      if (audioBody.length === 0) {
        return reply.status(400).send({
          error: "invalid_audio_body",
          message: "Audio upload body cannot be empty",
        });
      }

      if (audioBody.length > audioMaxBytes) {
        return reply.status(413).send({
          error: "payload_too_large",
          message: `Audio upload exceeds the ${audioMaxBytes} byte limit`,
        });
      }

      const userDir = assertPathInside(
        audioDir,
        join(audioDir, safePathSegment(userId)),
      );
      const audioPath = assertPathInside(
        audioDir,
        join(userDir, storageFileNameForAudioJob(job, mimeType)),
      );
      await mkdir(userDir, { recursive: true });
      await writeFileAtomic(audioDir, audioPath, audioBody);

      const now = new Date().toISOString();
      const updatedJob: AudioUploadJob = {
        ...job,
        mimeType,
        sizeBytes: audioBody.length,
        upload: {
          strategy: "binary-local",
          storage: "local-file",
          localPath: audioPath,
          mimeType,
          sizeBytes: audioBody.length,
          uploadedAt: now,
        },
        updatedAt: now,
      };
      await saveAudioJob(updatedJob);
      return updatedJob;
    },
  );

  preview?.get(
    "/transcripts",
    async (
      request,
      reply,
    ): Promise<ListResponse<Transcript> | FastifyReply> => {
      try {
        const { userId } = getRouteContext(request);
        const query = parseQuery<ListTranscriptsQuery>(
          listTranscriptsQuerySchema,
          request,
        );
        const result = await transcriptRepository.listForUser(userId, {
          includeDeleted: query.includeDeleted,
          cursor: query.cursor,
          limit: query.limit,
        });
        return {
          items: result.items,
          ...optionalProps({ nextCursor: result.nextCursor }),
        } as ListResponse<Transcript>;
      } catch (error) {
        if (error instanceof InvalidCursorError)
          return reply
            .status(400)
            .send({ error: "invalid_cursor", message: error.message });
        return sendValidationError(reply, error);
      }
    },
  );

  preview?.post(
    "/transcripts",
    async (request, reply): Promise<Transcript | FastifyReply> => {
      try {
        const { userId } = getRouteContext(request);
        const input = parseBody<CreateTranscriptInput>(
          createTranscriptSchema,
          request,
        );
        const transcript = createTranscript(userId, input);
        await transcriptRepository.save(transcript);
        return reply.status(201).send(transcript);
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  preview?.get<{ Params: { id: string } }>(
    "/transcripts/:id",
    async (request, reply) => {
      const { userId } = getRouteContext(request);
      const transcript = await transcriptRepository.getById(request.params.id);
      if (!transcript || transcript.userId !== userId || transcript.deletedAt) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Transcript not found" });
      }
      return transcript;
    },
  );

  preview?.patch<{ Params: { id: string } }>(
    "/transcripts/:id",
    async (request, reply): Promise<Transcript | FastifyReply> => {
      try {
        const { userId } = getRouteContext(request);
        const existing = await transcriptRepository.getById(request.params.id);
        if (!existing || existing.userId !== userId || existing.deletedAt) {
          return reply
            .status(404)
            .send({ error: "not_found", message: "Transcript not found" });
        }
        const input = parseBody<UpdateTranscriptInput>(
          updateTranscriptSchema,
          request,
        );
        const updated = {
          ...existing,
          ...optionalProps(input),
          updatedAt: new Date().toISOString(),
        } as Transcript;
        await transcriptRepository.save(updated);
        return updated;
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  preview?.delete<{ Params: { id: string } }>(
    "/transcripts/:id",
    async (request, reply) => {
      const { userId } = getRouteContext(request);
      const existing = await transcriptRepository.getById(request.params.id);
      if (!existing || existing.userId !== userId || existing.deletedAt) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Transcript not found" });
      }
      const now = new Date().toISOString();
      await transcriptRepository.save({
        ...existing,
        updatedAt: now,
        deletedAt: now,
      });
      return reply.status(204).send();
    },
  );

  preview?.post(
    "/commands/execute",
    async (request, reply): Promise<CommandExecutionResult | FastifyReply> => {
      try {
        const { userId } = getRouteContext(request);
        const input = parseBody<CommandExecutionInput>(
          commandExecutionRequestSchema,
          request,
        );
        if (input.transcriptId) {
          const transcript = await transcriptRepository.getById(
            input.transcriptId,
          );
          if (
            !transcript ||
            transcript.userId !== userId ||
            transcript.deletedAt
          ) {
            return reply
              .status(404)
              .send({ error: "not_found", message: "Transcript not found" });
          }
        }
        const now = new Date().toISOString();
        const result = {
          id: randomUUID(),
          userId,
          command: input.command,
          status: input.dryRun ? "queued" : "completed",
          dryRun: input.dryRun,
          createdAt: now,
          ...optionalProps({ transcriptId: input.transcriptId }),
          ...(input.dryRun
            ? {}
            : {
                completedAt: now,
                output: `Command accepted: ${input.command}`,
              }),
        } as CommandExecutionResult;
        stores.commands.set(result.id, result);
        return reply.status(202).send(result);
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  preview?.get("/usage/quota", async (request): Promise<UsageQuotaSummary> => {
    const { userId } = getRouteContext(request);
    const user =
      stores.users.get(userId) ?? stores.users.get(resolvedLocalUserId)!;
    const transcriptCount =
      await transcriptRepository.countActiveForUser(userId);
    const commandCount = [...stores.commands.values()].filter(
      (item) => item.userId === userId,
    ).length;
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    ).toISOString();
    const limits =
      user.plan === "free"
        ? { transcripts: 100, commands: 25, minutes: 120 }
        : { transcripts: 5000, commands: 2000, minutes: 10000 };
    return {
      userId,
      plan: user.plan,
      periodStart,
      periodEnd,
      transcripts: { used: transcriptCount, limit: limits.transcripts },
      commands: { used: commandCount, limit: limits.commands },
      minutes: { used: 0, limit: limits.minutes },
    };
  });

  preview?.get(
    "/sync/manifest",
    async (request, reply): Promise<SyncManifest | FastifyReply> => {
      try {
        const { userId } = getRouteContext(request);
        const query = parseQuery<SyncManifestQuery>(
          syncManifestQuerySchema,
          request,
        );
        return {
          generatedAt: new Date().toISOString(),
          ...optionalProps({ since: query.since }),
          items: await toManifestItems(
            transcriptRepository,
            stores,
            userId,
            query.since,
          ),
        } as SyncManifest;
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  // Only routes that opt in (the paid /v1 AI routes) are limited. Runs after
  // authentication (onRequest), so limits are keyed by the verified account,
  // and before the body is read, so an account over budget cannot make the
  // API buffer more audio.
  await app.register(rateLimit, { global: false, hook: "preParsing" });
  registerAiRoutes(app, options.aiRouteLimits, options.aiProviders, {
    maxAudioBytes: audioMaxBytes,
  });

  return app;
}

/**
 * The mode a direct run (`node dist/index.js`) starts in. Only `development`
 * and `test` start outside production, in any case and with spaces trimmed.
 * Every other value is production, unset and empty included, so a deployment
 * that forgets NODE_ENV or spells it `Production` or `prod` still requires
 * sign-in and keeps the preview routes off.
 */
export const directRunNodeEnv = (
  env: Record<string, string | undefined> = process.env,
): "development" | "test" | "production" => {
  const mode = env.NODE_ENV?.trim().toLowerCase();
  return mode === "development" || mode === "test" ? mode : "production";
};

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const nodeEnv = directRunNodeEnv();
  const app = await createApp({ nodeEnv });
  const port = Number(process.env.PORT ?? 8080);
  await app.listen({
    host: nodeEnv === "production" ? "0.0.0.0" : "127.0.0.1",
    port,
  });
}
