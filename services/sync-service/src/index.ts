import { randomBytes as nodeRandomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import {
  registerServiceSecurity,
  resolveListenOptions,
  type ServiceEnv,
} from "@sonolect/service-kit";
import { SYNC_ERROR_CODES } from "@sonolect/sync-core/wire";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";

import {
  ConfigError,
  DEFAULT_LIMITS,
  type ServiceLimits,
  readConfig,
} from "./config.js";
import { openStore } from "./open-store.js";
import { FixedWindowLimiter, retryAfterSeconds } from "./rate-limit.js";
import { VAULT_ROUTES, vaultRoutes } from "./routes.js";
import type { VaultStore } from "./store.js";

export const SERVICE_NAME = "sonolect-sync-service";

/**
 * Fastify's trustProxy for a hop count. Fastify ignores a bare number (it
 * cannot check the peer), so the hops are trusted by position: on Cloud Run
 * only its front end reaches the container.
 */
const trustHops = (hops: false | number) =>
  hops === false ? false : (_address: string, hop: number) => hop < hops;

export interface CreateAppOptions {
  /** Defaults to process.env. */
  env?: ServiceEnv | undefined;
  /** A store to use instead of SONOLECT_SYNC_STORE; the caller closes it. */
  store?: VaultStore | undefined;
  /** false: no logs; a stream: JSON lines to it (tests read them). */
  logger?: boolean | { write(line: string): void } | undefined;
  /** Server clock (ms); tests move it. */
  now?: (() => number) | undefined;
  randomBytes?: ((size: number) => Uint8Array) | undefined;
  /** Smaller limits for tests. */
  limits?: Partial<ServiceLimits> | undefined;
}

/**
 * The sync service: the vault routes of @sonolect/sync-core/wire, open to
 * the apps (each vault authenticates its own bearer token), and the admin
 * routes behind the service token.
 *
 * What it sees: vault ids, the SHA-256 of each bearer token, record ids,
 * revisions, sequence numbers, sizes, timestamps, IP addresses and
 * ciphertext. It never logs request bodies or tokens.
 */
export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const env = options.env ?? process.env;
  const config = readConfig(env);
  if (config.production && options.store?.kind === "memory")
    throw new ConfigError("the memory store is refused in production");
  const limits: ServiceLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const now = options.now ?? (() => Date.now());
  const randomBytes =
    options.randomBytes ??
    ((size: number) => new Uint8Array(nodeRandomBytes(size)));

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: env.LOG_LEVEL?.trim() || "info",
            // The default serializers log no headers; this keeps it so.
            redact: ["req.headers.authorization"],
            ...(typeof options.logger === "object"
              ? { stream: options.logger }
              : {}),
          },
    trustProxy: trustHops(config.trustProxy),
    bodyLimit: limits.maxRequestBytes,
    // A path Fastify cannot route: an overlong vault id is no vault (404),
    // a malformed escape is a bad request. Neither echoes the path back.
    frameworkErrors: (error, _request, genericReply) => {
      const reply = genericReply as unknown as FastifyReply;
      void (error.code === "FST_ERR_MAX_PARAM_LENGTH"
        ? reply.code(404).send({
            error: SYNC_ERROR_CODES.notFound,
            message: "no such route",
          })
        : reply.code(400).send({
            error: SYNC_ERROR_CODES.badRequest,
            message: "malformed request",
          }));
    },
  });

  const store = options.store ?? (await openStore(config.store));
  if (!options.store) app.addHook("onClose", async () => store.close());

  await app.register(helmet, {
    crossOriginResourcePolicy: {
      policy: config.allowedOrigins ? "cross-origin" : "same-origin",
    },
  });
  if (config.allowedOrigins)
    await app.register(cors, {
      origin: config.allowedOrigins,
      methods: ["GET", "POST", "DELETE"],
      allowedHeaders: ["authorization", "content-type"],
      exposedHeaders: ["retry-after"],
      maxAge: 600,
    });

  // Every route but the health check counts against the caller's IP.
  const perIp = new FixedWindowLimiter(limits.ipRequestsPerMinute, 60_000);
  app.addHook("onRequest", async (request, reply) => {
    if (request.routeOptions.url === "/health") return;
    const wait = perIp.hit(request.ip, now());
    if (wait > 0)
      return reply
        .status(429)
        .header("retry-after", String(retryAfterSeconds(wait)))
        .send({
          error: SYNC_ERROR_CODES.rateLimited,
          message: "too many requests",
        });
  });

  registerServiceSecurity(app, {
    serviceName: SERVICE_NAME,
    env,
    publicRoutes: [...VAULT_ROUTES, "OPTIONS *"],
  });

  app.setNotFoundHandler((_request, reply) =>
    reply
      .status(404)
      .send({ error: SYNC_ERROR_CODES.notFound, message: "no such route" }),
  );

  app.get("/health", async () => ({ status: "ok", service: SERVICE_NAME }));

  // Admin: behind the service token (SONOLECT_SERVICE_TOKENS).
  app.get("/v1/admin/status", async () => ({
    service: SERVICE_NAME,
    store: store.kind,
    limits,
  }));

  await app.register(vaultRoutes, { store, limits, now, randomBytes });
  return app;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    const app = await createApp();
    const close = async (signal: string) => {
      app.log.info({ signal }, "shutting down");
      try {
        await app.close();
      } finally {
        process.exit(0);
      }
    };
    process.once("SIGTERM", (signal) => void close(signal));
    process.once("SIGINT", (signal) => void close(signal));
    await app.listen(resolveListenOptions());
  } catch (error) {
    // Configuration errors are the operator's to fix: print them plainly.
    console.error(error instanceof ConfigError ? error.message : error);
    process.exit(1);
  }
}
