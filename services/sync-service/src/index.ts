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
  userIdSchema,
  type SyncPullInput,
  type SyncPushInput,
} from "@sonolect/validation";
import {
  BoundedMap,
  registerServiceSecurity,
  resolveListenOptions,
  resolveRequestUserId,
  type ServiceEnv,
} from "@sonolect/service-kit";

const serviceName = "sonolect-sync-service";
const MAX_RECORDS = 200_000;
// A client clock this far ahead is treated as "now", so one device with a
// wrong clock cannot pin a record in the future and block every later edit.
const MAX_CLIENT_CLOCK_SKEW_MS = 5 * 60_000;

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

const createStores = (): SyncStores => ({
  records: new BoundedMap(MAX_RECORDS),
});

const parseBody = <T>(
  schema: { parse: (value: unknown) => T },
  request: FastifyRequest,
): T => schema.parse(request.body ?? {});

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

// IDs may themselves contain ":", so a joined string could make two different
// users' records share a key. A JSON tuple cannot collide.
const recordKey = (userId: string, entity: string, id: string) =>
  JSON.stringify([userId, entity, id]);

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
  // Pages are cut on `updatedAt` and the next pull asks for anything newer
  // than the cursor. Records written in the same millisecond therefore have
  // to travel together, or the ones past the cut would never be pulled.
  let pageEnd = Math.min(input.limit, records.length);
  while (
    pageEnd > 0 &&
    pageEnd < records.length &&
    records[pageEnd]?.updatedAt === records[pageEnd - 1]?.updatedAt
  )
    pageEnd += 1;
  const limited = records.slice(0, pageEnd);
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
    const now = Date.now();
    const claimedTime = Date.parse(change.updatedAt);
    const clientTime =
      claimedTime > now + MAX_CLIENT_CLOCK_SKEW_MS ? now : claimedTime;
    if (existing && Date.parse(existing.updatedAt) > clientTime) {
      conflicts.push({
        clientChangeId: change.clientChangeId,
        serverVersion: existing,
        reason: "server_version_is_newer",
      });
      continue;
    }
    const updatedAt = new Date(Math.max(clientTime, now)).toISOString();
    // Delete first so a rewritten record becomes the newest entry.
    stores.records.delete(key);
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
  env?: ServiceEnv;
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const stores = options.stores ?? createStores();
  const app = Fastify({ logger: options.logger ?? true });

  await app.register(helmet);
  await app.register(cors, { origin: false });
  registerServiceSecurity(app, { serviceName, env: options.env });

  app.get("/health", async () => ({ status: "ok", service: serviceName }));

  app.get(
    "/sync/manifest",
    async (request, reply): Promise<SyncManifest | FastifyReply> => {
      try {
        const query = z
          .object({
            userId: userIdSchema.optional(),
            since: z.string().datetime().optional(),
          })
          .parse(request.query ?? {});
        const userId = resolveRequestUserId(request, query.userId);
        const records = [...stores.records.values()].filter(
          (record) => record.userId === userId,
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
        const input = parseBody<SyncPullInput>(syncPullSchema, request);
        return pullFor(stores, {
          ...input,
          userId: resolveRequestUserId(request, input.userId),
        });
      } catch (error) {
        return sendValidationError(reply, error);
      }
    },
  );

  app.post(
    "/sync/push",
    async (request, reply): Promise<SyncPushResponse | FastifyReply> => {
      try {
        const input = parseBody<SyncPushInput>(syncPushSchema, request);
        return reply.status(202).send(
          pushFor(stores, {
            ...input,
            userId: resolveRequestUserId(request, input.userId),
          }),
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
  await app.listen(resolveListenOptions());
}
