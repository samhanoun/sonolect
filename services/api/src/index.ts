import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  FileTranscriptRepository,
  InMemoryTranscriptRepository,
  type TranscriptRepository,
} from "./repositories.js";
export {
  FileTranscriptRepository,
  InMemoryTranscriptRepository,
  type TranscriptRepository,
} from "./repositories.js";
import type {
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
  createTranscriptSchema,
  listTranscriptsQuerySchema,
  syncManifestQuerySchema,
  updateTranscriptSchema,
  type CommandExecutionInput,
  type CreateTranscriptInput,
  type ListTranscriptsQuery,
  type SyncManifestQuery,
  type UpdateTranscriptInput,
} from "@sonolect/validation";

const serviceName = "sonolect-api";
const localUserId = "local-user";
const localNow = new Date().toISOString();

type RouteContext = { userId: string };

export interface InMemoryStores {
  users: Map<string, User>;
  transcripts: Map<string, Transcript>;
  commands: Map<string, CommandExecutionResult>;
}

const createStores = (): InMemoryStores => ({
  users: new Map<string, User>([
    [
      localUserId,
      {
        id: localUserId,
        email: "local@sonolect.dev",
        name: "Local Sonolect User",
        plan: "pro",
        createdAt: localNow,
        updatedAt: localNow,
      },
    ],
  ]),
  transcripts: new Map<string, Transcript>(),
  commands: new Map<string, CommandExecutionResult>(),
});

const getRouteContext = (request: FastifyRequest): RouteContext => {
  const header = request.headers["x-user-id"];
  return {
    userId: Array.isArray(header)
      ? (header[0] ?? localUserId)
      : (header ?? localUserId),
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

export interface CreateAppOptions {
  stores?: InMemoryStores;
  transcriptRepository?: TranscriptRepository;
  storePath?: string;
  logger?: boolean;
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const stores = options.stores ?? createStores();
  const storePath = options.storePath ?? process.env.SONOLECT_API_STORE_PATH;
  const transcriptRepository =
    options.transcriptRepository ??
    (storePath
      ? new FileTranscriptRepository(storePath)
      : new InMemoryTranscriptRepository(stores.transcripts));
  const app = Fastify({ logger: options.logger ?? true });

  await app.register(helmet);
  await app.register(cors, { origin: false });

  app.get("/health", async () => ({ status: "ok", service: serviceName }));

  app.get("/users/profile", async (request) => {
    const { userId } = getRouteContext(request);
    const now = new Date().toISOString();
    const user = stores.users.get(userId) ?? {
      id: userId,
      email: `${userId}@local.sonolect.dev`,
      plan: "free" as const,
      createdAt: now,
      updatedAt: now,
    };
    stores.users.set(userId, user);
    return user;
  });

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
    const user = stores.users.get(userId) ?? stores.users.get(localUserId)!;
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

  return app;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ host: "0.0.0.0", port });
}
