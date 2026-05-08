import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  FileTranscriptRepository,
  InMemoryTranscriptRepository,
  readFileStore,
  type TranscriptRepository,
  writeFileStore,
} from "./repositories.js";
import {
  registerAuthMiddleware,
  type AuthOptions,
  type AuthenticatedActor,
} from "./auth.js";
export {
  FileTranscriptRepository,
  InMemoryTranscriptRepository,
  readFileStore,
  type TranscriptRepository,
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
  Team,
  TeamInvite,
  TeamMember,
  TeamMemberRole,
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

type RouteContext = { userId: string; actor: AuthenticatedActor };

export interface TeamStores {
  teams: Map<string, Team>;
  teamMembers: Map<string, TeamMember[]>;
  teamInvites: Map<string, TeamInvite[]>;
  sharedDictionary: Map<string, unknown[]>;
  sharedSnippets: Map<string, unknown[]>;
}

export interface InMemoryStores {
  users: Map<string, User>;
  transcripts: Map<string, Transcript>;
  commands: Map<string, CommandExecutionResult>;
  audioJobs: Map<string, AudioUploadJob>;
  team: TeamStores;
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

const createTeamStores = (): TeamStores => ({
  teams: new Map<string, Team>(),
  teamMembers: new Map<string, TeamMember[]>(),
  teamInvites: new Map<string, TeamInvite[]>(),
  sharedDictionary: new Map<string, unknown[]>(),
  sharedSnippets: new Map<string, unknown[]>(),
});

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
  team: createTeamStores(),
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

const storageFileNameForAudioJob = (
  job: AudioUploadJob,
  mimeType: string,
): string => {
  const configuredFileName = job.fileName?.trim();
  const safeJobId = safePathSegment(job.id);
  if (configuredFileName) {
    return `${safeJobId}-${safePathSegment(configuredFileName)}`;
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
  stores?: InMemoryStores;
  transcriptRepository?: TranscriptRepository;
  storePath?: string;
  audioDir?: string;
  audioMaxBytes?: number;
  logger?: boolean;
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const resolvedLocalUserId = getLocalUserId(options);
  const stores = options.stores ?? createStores(resolvedLocalUserId);
  const authOptions = { ...options, localUserId: resolvedLocalUserId };
  const storePath = options.storePath ?? process.env.SONOLECT_API_STORE_PATH;
  const audioDir = await ensureAudioStorageRoot(getAudioDir(options.audioDir));
  const audioMaxBytes = getAudioMaxBytes(options.audioMaxBytes);
  const transcriptRepository =
    options.transcriptRepository ??
    (storePath
      ? new FileTranscriptRepository(storePath)
      : new InMemoryTranscriptRepository(stores.transcripts));
  const syncAudioJobsFromFileStore = async (): Promise<void> => {
    if (!storePath) return;
    const payload = await readFileStore(storePath);
    stores.audioJobs.clear();
    for (const job of payload.audioJobs ?? []) {
      if (job?.id) {
        stores.audioJobs.set(job.id, job);
      }
    }
  };
  const persistAudioJobsToFileStore = async (): Promise<void> => {
    if (!storePath) return;
    const payload = await readFileStore(storePath);
    const mergedAudioJobs = new Map<string, AudioUploadJob>();
    for (const job of payload.audioJobs ?? []) {
      mergedAudioJobs.set(job.id, job);
    }
    for (const job of Array.from(stores.audioJobs.values())) {
      const existing = mergedAudioJobs.get(job.id);
      const existingUpdatedAt = existing ? Date.parse(existing.updatedAt) : -1;
      const nextUpdatedAt = Date.parse(job.updatedAt);
      if (!existing || nextUpdatedAt >= existingUpdatedAt) {
        mergedAudioJobs.set(job.id, job);
      }
    }
    await writeFileStore(storePath, {
      ...payload,
      audioJobs: Array.from(mergedAudioJobs.values()).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
    });
  };
  const app = Fastify({ logger: options.logger ?? true });

  app.addContentTypeParser(
    /^audio\/[a-z0-9.+-]+$/i,
    { parseAs: "buffer", bodyLimit: audioMaxBytes },
    (_request, body, done) => done(null, body),
  );

  await app.register(helmet);
  await app.register(cors, { origin: false });
  registerAuthMiddleware(app, authOptions);

  app.get("/health", async () => ({ status: "ok", service: serviceName }));

  app.get("/users/profile", async (request) => {
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

  app.post(
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
          language: "en",
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
        stores.audioJobs.set(job.id, job);
        await persistAudioJobsToFileStore();
        return reply.status(201).send(job);
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
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

  app.post<{ Params: { id: string } }>(
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
      stores.audioJobs.set(updatedJob.id, updatedJob);
      await persistAudioJobsToFileStore();
      return updatedJob;
    },
  );

  app.get(
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
        return sendValidationError(reply, error);
      }
    },
  );

  app.post(
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

  app.get<{ Params: { id: string } }>(
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

  app.patch<{ Params: { id: string } }>(
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

  app.delete<{ Params: { id: string } }>(
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

  app.post(
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

  app.get("/usage/quota", async (request): Promise<UsageQuotaSummary> => {
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

  app.get(
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

  /* ─── Team Collaboration Routes ─── */

  const ROLE_PERMISSIONS: Record<TeamMemberRole, Set<string>> = {
    owner: new Set(["read", "write", "admin", "invite"]),
    admin: new Set(["read", "write", "invite"]),
    member: new Set(["read", "write"]),
  };

  const hasTeamPermission = (
    member: TeamMember | undefined,
    action: string,
  ): boolean => {
    if (!member) return false;
    const allowed = ROLE_PERMISSIONS[member.role];
    return allowed !== undefined && allowed.has(action);
  };

  const findMember = (
    teamId: string,
    userId: string,
  ): TeamMember | undefined => {
    const members = stores.team.teamMembers.get(teamId) ?? [];
    return members.find((m) => m.userId === userId);
  };

  app.post("/teams", async (request, reply) => {
    const { userId } = getRouteContext(request);
    const body = request.body as Record<string, unknown> | undefined;
    const name = typeof body?.name === "string" ? body.name.trim() : undefined;
    if (!name) {
      return reply.status(400).send({
        error: "validation_error",
        message: "Team name is required",
      });
    }
    const now = new Date().toISOString();
    const team: Team = {
      id: randomUUID(),
      name,
      slug: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
      ownerId: userId,
      createdAt: now,
    };
    stores.team.teams.set(team.id, team);
    const ownerMember: TeamMember = {
      userId,
      teamId: team.id,
      role: "owner",
      joinedAt: now,
    };
    stores.team.teamMembers.set(team.id, [ownerMember]);
    stores.team.teamInvites.set(team.id, []);
    stores.team.sharedDictionary.set(team.id, []);
    stores.team.sharedSnippets.set(team.id, []);
    return reply.status(201).send(team);
  });

  app.get("/teams", async (request) => {
    const { userId } = getRouteContext(request);
    const userTeams: Team[] = [];
    for (const [teamId, members] of stores.team.teamMembers.entries()) {
      if (members.some((m) => m.userId === userId)) {
        const team = stores.team.teams.get(teamId);
        if (team) userTeams.push(team);
      }
    }
    return userTeams;
  });

  app.get<{ Params: { id: string } }>("/teams/:id", async (request, reply) => {
    const { userId } = getRouteContext(request);
    const team = stores.team.teams.get(request.params.id);
    if (!team) {
      return reply
        .status(404)
        .send({ error: "not_found", message: "Team not found" });
    }
    const member = findMember(team.id, userId);
    if (!hasTeamPermission(member, "read")) {
      return reply
        .status(403)
        .send({ error: "forbidden", message: "Not a team member" });
    }
    const members = stores.team.teamMembers.get(team.id) ?? [];
    const invites = stores.team.teamInvites.get(team.id) ?? [];
    return { team, members, invites };
  });

  app.post<{ Params: { id: string } }>(
    "/teams/:id/invite",
    async (request, reply) => {
      const { userId } = getRouteContext(request);
      const team = stores.team.teams.get(request.params.id);
      if (!team) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Team not found" });
      }
      const member = findMember(team.id, userId);
      if (!hasTeamPermission(member, "invite")) {
        return reply
          .status(403)
          .send({ error: "forbidden", message: "No invite permission" });
      }
      const body = request.body as Record<string, unknown> | undefined;
      const email =
        typeof body?.email === "string"
          ? body.email.trim().toLowerCase()
          : undefined;
      const role =
        typeof body?.role === "string" &&
        (body.role === "admin" || body.role === "member")
          ? (body.role as "admin" | "member")
          : undefined;
      if (!email || !role) {
        return reply.status(400).send({
          error: "validation_error",
          message: "email and role (admin|member) are required",
        });
      }
      const now = new Date();
      const invite: TeamInvite = {
        id: randomUUID(),
        teamId: team.id,
        email,
        role,
        invitedBy: userId,
        createdAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        status: "pending",
      };
      const invites = stores.team.teamInvites.get(team.id) ?? [];
      invites.push(invite);
      stores.team.teamInvites.set(team.id, invites);
      return reply.status(201).send(invite);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/teams/:id/join",
    async (request, reply) => {
      const { userId } = getRouteContext(request);
      const team = stores.team.teams.get(request.params.id);
      if (!team) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Team not found" });
      }
      const body = request.body as Record<string, unknown> | undefined;
      const inviteId =
        typeof body?.inviteId === "string" ? body.inviteId : undefined;
      if (!inviteId) {
        return reply.status(400).send({
          error: "validation_error",
          message: "inviteId is required",
        });
      }
      const invites = stores.team.teamInvites.get(team.id) ?? [];
      const invite = invites.find(
        (i) => i.id === inviteId && i.status === "pending",
      );
      if (!invite) {
        return reply.status(404).send({
          error: "not_found",
          message: "Invite not found or already used",
        });
      }
      if (Date.now() > Date.parse(invite.expiresAt)) {
        invite.status = "expired";
        return reply
          .status(400)
          .send({ error: "expired", message: "Invite has expired" });
      }
      invite.status = "accepted";
      const members = stores.team.teamMembers.get(team.id) ?? [];
      if (members.some((m) => m.userId === userId)) {
        return reply.status(400).send({
          error: "already_member",
          message: "Already a team member",
        });
      }
      const newMember: TeamMember = {
        userId,
        teamId: team.id,
        role: invite.role,
        joinedAt: new Date().toISOString(),
      };
      members.push(newMember);
      stores.team.teamMembers.set(team.id, members);
      return reply.status(201).send(newMember);
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    "/teams/:id/members/:userId",
    async (request, reply) => {
      const { userId: actorId } = getRouteContext(request);
      const team = stores.team.teams.get(request.params.id);
      if (!team) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Team not found" });
      }
      const actorMember = findMember(team.id, actorId);
      if (!hasTeamPermission(actorMember, "admin")) {
        return reply
          .status(403)
          .send({ error: "forbidden", message: "Admin permission required" });
      }
      const targetUserId = request.params.userId;
      if (targetUserId === team.ownerId) {
        return reply
          .status(400)
          .send({ error: "invalid", message: "Cannot remove team owner" });
      }
      const members = stores.team.teamMembers.get(team.id) ?? [];
      const filtered = members.filter((m) => m.userId !== targetUserId);
      if (filtered.length === members.length) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Member not found" });
      }
      stores.team.teamMembers.set(team.id, filtered);
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    "/teams/:id/shared/dictionary",
    async (request, reply) => {
      const { userId } = getRouteContext(request);
      const team = stores.team.teams.get(request.params.id);
      if (!team) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Team not found" });
      }
      const member = findMember(team.id, userId);
      if (!hasTeamPermission(member, "read")) {
        return reply
          .status(403)
          .send({ error: "forbidden", message: "Not a team member" });
      }
      return stores.team.sharedDictionary.get(team.id) ?? [];
    },
  );

  app.put<{ Params: { id: string } }>(
    "/teams/:id/shared/dictionary",
    async (request, reply) => {
      const { userId } = getRouteContext(request);
      const team = stores.team.teams.get(request.params.id);
      if (!team) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Team not found" });
      }
      const member = findMember(team.id, userId);
      if (!hasTeamPermission(member, "write")) {
        return reply
          .status(403)
          .send({ error: "forbidden", message: "Write permission required" });
      }
      const body = request.body;
      if (!Array.isArray(body)) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Body must be an array of dictionary entries",
        });
      }
      stores.team.sharedDictionary.set(team.id, body);
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    "/teams/:id/shared/snippets",
    async (request, reply) => {
      const { userId } = getRouteContext(request);
      const team = stores.team.teams.get(request.params.id);
      if (!team) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Team not found" });
      }
      const member = findMember(team.id, userId);
      if (!hasTeamPermission(member, "read")) {
        return reply
          .status(403)
          .send({ error: "forbidden", message: "Not a team member" });
      }
      return stores.team.sharedSnippets.get(team.id) ?? [];
    },
  );

  app.put<{ Params: { id: string } }>(
    "/teams/:id/shared/snippets",
    async (request, reply) => {
      const { userId } = getRouteContext(request);
      const team = stores.team.teams.get(request.params.id);
      if (!team) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Team not found" });
      }
      const member = findMember(team.id, userId);
      if (!hasTeamPermission(member, "write")) {
        return reply
          .status(403)
          .send({ error: "forbidden", message: "Write permission required" });
      }
      const body = request.body;
      if (!Array.isArray(body)) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Body must be an array of snippets",
        });
      }
      stores.team.sharedSnippets.set(team.id, body);
      return reply.status(204).send();
    },
  );

  return app;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ host: "0.0.0.0", port });
}
