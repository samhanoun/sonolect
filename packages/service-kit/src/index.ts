import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest, HTTPMethods } from "fastify";

/**
 * Shared guards for the internal Sonolect services (agent, audio, billing,
 * sync, worker). These services sit behind the public API gateway, so callers
 * authenticate with a shared service token and assert the end user through the
 * `x-user-id` header. The public gateway (`services/api`) verifies end-user
 * Firebase tokens itself and does not use this module.
 */

export const LOCAL_USER_ID = "local-user";

const SERVICE_TOKENS_ENV = "SONOLECT_SERVICE_TOKENS";
const MIN_PRODUCTION_TOKEN_LENGTH = 32;
const USER_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,128}$/;

export type ServiceEnv = Record<string, string | undefined>;

export class ServiceHttpError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;

  constructor(statusCode: number, errorCode: string, message: string) {
    super(message);
    this.name = "ServiceHttpError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

export const isValidUserId = (value: unknown): value is string =>
  typeof value === "string" && USER_ID_PATTERN.test(value);

/** Throws a 400 unless `value` is a well-formed user ID. */
export const assertUserId = (value: unknown, field = "userId"): string => {
  if (!isValidUserId(value))
    throw new ServiceHttpError(
      400,
      "invalid_user_id",
      `${field} must be 1 to 128 characters of letters, digits, ".", "_", ":", "@" or "-"`,
    );
  return value;
};

export const parseServiceTokens = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

const digest = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

const matchesAnyToken = (candidate: string, tokens: Buffer[]): boolean => {
  const candidateDigest = digest(candidate);
  let matched = false;
  // Compare against every token so timing does not reveal which one matched.
  for (const token of tokens) {
    if (timingSafeEqual(candidateDigest, token)) matched = true;
  }
  return matched;
};

const firstHeader = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * Reads the token from "Bearer <token>". Parsed by hand, in linear time: the
 * header is caller-controlled, so it never goes through a backtracking regex.
 */
const parseBearerToken = (
  authorization: string | undefined,
): string | undefined => {
  if (!authorization) return undefined;
  const value = authorization.trim();
  const scheme = "bearer";
  if (value.slice(0, scheme.length).toLowerCase() !== scheme) return undefined;
  const rest = value.slice(scheme.length);
  // At least one space or tab must separate the scheme from the token.
  if (rest[0] !== " " && rest[0] !== "\t") return undefined;
  const token = rest.trimStart();
  return token || undefined;
};

export interface ServiceSecurityOptions {
  serviceName: string;
  env?: ServiceEnv | undefined;
  /**
   * Routes that skip the service token, as "METHOD /route/pattern". The health
   * check is always public. A public route must authenticate callers itself,
   * the way the Stripe webhook verifies its signature.
   */
  publicRoutes?: readonly string[] | undefined;
}

export interface ServiceSecurity {
  /** True when callers must present a service token. */
  enforced: boolean;
}

declare module "fastify" {
  interface FastifyInstance {
    sonolectServiceAuthEnforced: boolean;
  }
}

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  issues?: unknown;
  statusCode?: unknown;
  code?: unknown;
}

const isZodError = (error: ErrorLike): boolean =>
  error.name === "ZodError" && Array.isArray(error.issues);

/**
 * Adds service-token authentication and a safe error handler to a service.
 *
 * - Production (`NODE_ENV=production`) refuses to start without
 *   `SONOLECT_SERVICE_TOKENS` (comma-separated, 32+ characters each).
 * - Outside production the service stays open when no token is configured, so
 *   local development keeps working, and enforces tokens when one is set.
 * - Server errors never leak internal or upstream provider messages.
 */
export const registerServiceSecurity = (
  app: FastifyInstance,
  options: ServiceSecurityOptions,
): ServiceSecurity => {
  const env = options.env ?? process.env;
  const production = env.NODE_ENV === "production";
  const tokens = parseServiceTokens(env[SERVICE_TOKENS_ENV]);

  if (production && tokens.length === 0)
    throw new Error(
      `${options.serviceName}: ${SERVICE_TOKENS_ENV} must be set in production`,
    );
  if (
    production &&
    tokens.some((token) => token.length < MIN_PRODUCTION_TOKEN_LENGTH)
  )
    throw new Error(
      `${options.serviceName}: every ${SERVICE_TOKENS_ENV} entry must be at least ${MIN_PRODUCTION_TOKEN_LENGTH} characters in production`,
    );

  const enforced = tokens.length > 0;
  const tokenDigests = tokens.map(digest);
  const publicRoutes = new Set([
    "GET /health",
    ...(options.publicRoutes ?? []),
  ]);

  app.decorate("sonolectServiceAuthEnforced", enforced);

  app.addHook("onRequest", async (request, reply) => {
    if (!enforced) return;
    const routePattern = request.routeOptions.url;
    if (routePattern && publicRoutes.has(`${request.method} ${routePattern}`))
      return;
    const token = parseBearerToken(firstHeader(request.headers.authorization));
    if (!token || !matchesAnyToken(token, tokenDigests)) {
      return reply
        .status(401)
        .header("www-authenticate", "Bearer")
        .send({ error: "unauthorized", message: "Service token required" });
    }
  });

  app.setErrorHandler((rawError, request, reply) => {
    const error = (rawError ?? {}) as ErrorLike;
    if (isZodError(error)) {
      return reply.status(400).send({
        error: "validation_error",
        message: "Request validation failed",
        issues: error.issues,
      });
    }
    if (rawError instanceof ServiceHttpError) {
      if (rawError.statusCode >= 500)
        request.log.error({ err: rawError }, "service request failed");
      return reply
        .status(rawError.statusCode)
        .send({ error: rawError.errorCode, message: rawError.message });
    }
    const statusCode =
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : 500;
    if (statusCode >= 500) {
      request.log.error({ err: rawError }, "service request failed");
      return reply
        .status(500)
        .send({ error: "internal_error", message: "Internal server error" });
    }
    // Fastify's own 4xx errors (malformed JSON, body too large, ...) describe
    // the client's request and are safe to return.
    return reply.status(statusCode).send({
      error: typeof error.code === "string" ? error.code : "bad_request",
      message:
        typeof error.message === "string" ? error.message : "Bad request",
    });
  });

  return { enforced };
};

/**
 * The end user a request acts for, taken from the `x-user-id` header that the
 * gateway sets. Only trust it after `registerServiceSecurity` has run: with
 * tokens enforced the header is required, otherwise it defaults to the local
 * development user.
 */
export const getServiceUserId = (request: FastifyRequest): string => {
  const header = firstHeader(request.headers["x-user-id"]);
  if (header === undefined || header === "") {
    if (request.server.sonolectServiceAuthEnforced)
      throw new ServiceHttpError(
        400,
        "user_id_required",
        "x-user-id header is required",
      );
    return LOCAL_USER_ID;
  }
  return assertUserId(header, "x-user-id");
};

/**
 * Checks a user ID carried in a body, query or path against the caller's
 * `x-user-id` header. Returns the user ID to act on, or throws 403 when the two
 * disagree, so one user's request can never touch another user's data.
 */
export const resolveRequestUserId = (
  request: FastifyRequest,
  claimed: string | undefined,
): string => {
  const header = firstHeader(request.headers["x-user-id"]);
  const hasHeader = header !== undefined && header !== "";
  if (claimed === undefined) return getServiceUserId(request);
  const claimedUserId = assertUserId(claimed);
  if (!hasHeader) {
    if (request.server.sonolectServiceAuthEnforced)
      throw new ServiceHttpError(
        400,
        "user_id_required",
        "x-user-id header is required",
      );
    return claimedUserId;
  }
  if (assertUserId(header, "x-user-id") !== claimedUserId)
    throw new ServiceHttpError(
      403,
      "user_mismatch",
      "userId does not match the authenticated user",
    );
  return claimedUserId;
};

/** True when `env` asks for production (`NODE_ENV=production`). */
export const isProduction = (env: ServiceEnv = process.env): boolean =>
  env.NODE_ENV === "production";

export interface UnavailableEndpoint {
  /** "METHOD /route/pattern", exactly as the route is registered. */
  route: string;
  /** 501 when the service has no implementation, 503 when it lacks config. */
  statusCode: 501 | 503;
  error: "not_implemented" | "not_configured";
  message: string;
}

/**
 * Makes each listed endpoint answer its error instead of running its handler,
 * after the service token check, and logs the list once. Use it for endpoints
 * that would otherwise answer with a placeholder or keep data only in memory.
 * `notes` adds partial limits to the same log line. The app fails to start if
 * a listed route is not registered, so the list cannot drift from the code.
 */
export const disableEndpoints = (
  app: FastifyInstance,
  endpoints: readonly UnavailableEndpoint[],
  notes: readonly string[] = [],
): void => {
  if (endpoints.length === 0 && notes.length === 0) return;
  const byRoute = new Map(
    endpoints.map((endpoint) => [endpoint.route, endpoint]),
  );
  app.addHook("onRequest", async (request, reply) => {
    // A HEAD request runs the GET handler, so it is refused the same way.
    const method = request.method === "HEAD" ? "GET" : request.method;
    const endpoint = byRoute.get(`${method} ${request.routeOptions.url}`);
    if (!endpoint) return;
    return reply
      .status(endpoint.statusCode)
      .send({ error: endpoint.error, message: endpoint.message });
  });
  app.addHook("onReady", async () => {
    const missing = endpoints.filter((endpoint) => {
      const [method, url] = endpoint.route.split(" ");
      return !(
        method &&
        url &&
        app.hasRoute({ method: method as HTTPMethods, url })
      );
    });
    if (missing.length > 0)
      throw new Error(
        `disableEndpoints: no such route: ${missing.map((endpoint) => endpoint.route).join(", ")}`,
      );
  });
  app.log.warn(
    {
      unavailable: endpoints.map(
        (endpoint) =>
          `${endpoint.route} -> ${endpoint.statusCode} ${endpoint.error}`,
      ),
      ...(notes.length > 0 ? { notes } : {}),
    },
    "Some endpoints are not available in production",
  );
};

export interface ListenOptions {
  host: string;
  port: number;
}

/**
 * Binds to loopback outside production so a developer machine never exposes a
 * service on the network; containers run with NODE_ENV=production.
 */
export const resolveListenOptions = (
  env: ServiceEnv = process.env,
): ListenOptions => {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`Invalid PORT: ${env.PORT}`);
  const host =
    env.HOST?.trim() ||
    (env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  return { host, port };
};

/**
 * A Map that evicts its oldest entry once `maxSize` is reached, so in-memory
 * stores cannot grow until the process runs out of memory.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  readonly #maxSize: number;

  constructor(maxSize: number, entries?: Iterable<readonly [K, V]>) {
    super();
    if (!Number.isInteger(maxSize) || maxSize < 1)
      throw new Error("BoundedMap maxSize must be a positive integer");
    this.#maxSize = maxSize;
    if (entries) for (const [key, value] of entries) this.set(key, value);
  }

  override set(key: K, value: V): this {
    if (!this.has(key) && this.size >= this.#maxSize) {
      const oldest = this.keys().next();
      if (!oldest.done) this.delete(oldest.value);
    }
    return super.set(key, value);
  }
}
