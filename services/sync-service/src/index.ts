import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
  SyncManifest,
  SyncManifestItem,
  SyncPullResponse,
  SyncPushChange,
  SyncPushResponse,
} from "@sonolect/types";
import {
  syncPullSchema,
  syncPushSchema,
  type SyncPullInput,
  type SyncPushInput,
} from "@sonolect/validation";

const serviceName = "sonolect-sync-service";

type StoredSyncRecord = {
  entity: SyncPushChange["entity"];
  id: string;
  userId: string;
  data: unknown;
  updatedAt: string;
  deleted: boolean;
};

interface SyncStores {
  records: Map<string, StoredSyncRecord>;
}

const createStores = (): SyncStores => ({ records: new Map() });

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

const recordKey = (userId: string, entity: string, id: string) =>
  `${userId}:${entity}:${id}`;

const toManifestItems = (
  records: StoredSyncRecord[],
  since?: string,
): SyncManifestItem[] => {
  const changedAfter = since ? Date.parse(since) : 0;
  return records
    .filter((record) => Date.parse(record.updatedAt) > changedAfter)
    .map((record) => ({
      id: record.id,
      entity: record.entity,
      updatedAt: record.updatedAt,
      deleted: record.deleted,
    }))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
};

const pullFor = (
  stores: SyncStores,
  input: SyncPullInput,
): SyncPullResponse => {
  const records = [...stores.records.values()]
    .filter((record) => record.userId === input.userId)
    .filter(
      (record) =>
        !input.since || Date.parse(record.updatedAt) > Date.parse(input.since),
    )
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const limited = records.slice(0, input.limit);
  const last = limited.at(-1);
  return {
    cursor: last?.updatedAt ?? new Date().toISOString(),
    hasMore: records.length > limited.length,
    manifest: {
      generatedAt: new Date().toISOString(),
      ...optionalProps({ since: input.since }),
      items: toManifestItems(limited, undefined),
    } as SyncManifest,
    records: limited.map((record) => ({
      entity: record.entity,
      id: record.id,
      data: record.data,
      updatedAt: record.updatedAt,
      deleted: record.deleted,
    })),
  };
};

const pushFor = (
  stores: SyncStores,
  input: SyncPushInput,
): SyncPushResponse => {
  const accepted: SyncPushResponse["accepted"] = [];
  const conflicts: SyncPushResponse["conflicts"] = [];
  for (const change of input.changes) {
    const key = recordKey(input.userId, change.entity, change.id);
    const existing = stores.records.get(key);
    if (
      existing &&
      Date.parse(existing.updatedAt) > Date.parse(change.updatedAt)
    ) {
      conflicts.push({
        clientChangeId: change.clientChangeId,
        serverVersion: existing,
        reason: "server_version_is_newer",
      });
      continue;
    }
    const updatedAt = new Date(
      Math.max(Date.parse(change.updatedAt), Date.now()),
    ).toISOString();
    stores.records.set(key, {
      entity: change.entity,
      id: change.id,
      userId: input.userId,
      data: change.data ?? null,
      updatedAt,
      deleted: change.deleted ?? false,
    });
    accepted.push({
      clientChangeId: change.clientChangeId,
      serverId: change.id,
      updatedAt,
    });
  }
  return { accepted, conflicts };
};

export interface CreateAppOptions {
  stores?: SyncStores;
  logger?: boolean;
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const stores = options.stores ?? createStores();
  const app = Fastify({ logger: options.logger ?? true });

  await app.register(helmet);
  await app.register(cors, { origin: false });

  app.get("/health", async () => ({ status: "ok", service: serviceName }));

  app.get(
    "/sync/manifest",
    async (request, reply): Promise<SyncManifest | FastifyReply> => {
      try {
        const query = z
          .object({
            userId: z.string().min(1).default("local-user"),
            since: z.string().datetime().optional(),
          })
          .parse(request.query ?? {});
        const records = [...stores.records.values()].filter(
          (record) => record.userId === query.userId,
        );
        return {
          generatedAt: new Date().toISOString(),
          ...optionalProps({ since: query.since }),
          items: toManifestItems(records, query.since),
        } as SyncManifest;
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  app.post(
    "/sync/pull",
    async (request, reply): Promise<SyncPullResponse | FastifyReply> => {
      try {
        return pullFor(
          stores,
          parseBody<SyncPullInput>(syncPullSchema, request),
        );
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  app.post(
    "/sync/push",
    async (request, reply): Promise<SyncPushResponse | FastifyReply> => {
      try {
        return reply
          .status(202)
          .send(
            pushFor(stores, parseBody<SyncPushInput>(syncPushSchema, request)),
          );
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
