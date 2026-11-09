import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createFirebaseVerifier } from "./firebase-verifier.js";

export interface AuthenticatedActor {
  userId: string;
  email?: string;
  provider: "anonymous" | "dev" | "firebase";
}

export interface VerifiedToken {
  uid: string;
  email?: string;
}

export type VerifyToken = (token: string) => Promise<VerifiedToken>;

export interface AuthOptions {
  authRequired?: boolean;
  firebaseProjectId?: string | undefined;
  verifyToken?: VerifyToken | undefined;
  allowDevTokens?: boolean | undefined;
  localDevAuth?: boolean | undefined;
  localUserId?: string | undefined;
  nodeEnv?: string;
}

interface AuthConfig {
  authRequired: boolean;
  firebaseProjectId: string | undefined;
  verifyToken: VerifyToken | undefined;
  allowDevTokens: boolean;
  localDevAuth: boolean;
  localUserId: string;
  nodeEnv: string;
}

declare module "fastify" {
  interface FastifyRequest {
    actor?: AuthenticatedActor;
  }
}

const localUserId = "local-user";

const envFlagEnabled = (value: string | undefined): boolean => value === "true";

const sanitizeLocalUserId = (value: string | undefined): string => {
  const trimmed = value?.trim();
  return trimmed && /^[a-zA-Z0-9._-]+$/.test(trimmed) ? trimmed : localUserId;
};

const getAuthorizationValue = (request: FastifyRequest): string | undefined => {
  const header = request.headers.authorization;
  return Array.isArray(header) ? header[0] : header;
};

const parseBearerToken = (
  authorization: string | undefined,
): string | undefined => {
  if (!authorization) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1];
};

const isNonProduction = (nodeEnv: string): boolean => nodeEnv !== "production";

export const createAuthConfig = (options: AuthOptions = {}): AuthConfig => {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const production = nodeEnv === "production";
  const firebaseProjectId = (
    options.firebaseProjectId ?? process.env.FIREBASE_PROJECT_ID
  )?.trim();
  const verifyToken =
    options.verifyToken ??
    (firebaseProjectId ? createFirebaseVerifier(firebaseProjectId) : undefined);
  if (production && !verifyToken)
    throw new Error(
      "Production authentication requires FIREBASE_PROJECT_ID or a configured token verifier",
    );
  return {
    authRequired:
      production ||
      (options.authRequired ??
        envFlagEnabled(process.env.SONOLECT_AUTH_REQUIRED)),
    firebaseProjectId,
    verifyToken,
    localDevAuth:
      !production &&
      (options.localDevAuth ??
        envFlagEnabled(process.env.SONOLECT_LOCAL_DEV_AUTH)),
    localUserId: sanitizeLocalUserId(
      options.localUserId ?? process.env.SONOLECT_LOCAL_USER_ID,
    ),
    allowDevTokens:
      !production &&
      Boolean(
        options.allowDevTokens ??
        (envFlagEnabled(process.env.SONOLECT_ALLOW_DEV_TOKENS) ||
          (options.localDevAuth ??
            envFlagEnabled(process.env.SONOLECT_LOCAL_DEV_AUTH))),
      ),
    nodeEnv,
  };
};

export async function resolveAuthenticatedActor(
  request: FastifyRequest,
  options: AuthOptions = {},
): Promise<AuthenticatedActor> {
  const config = createAuthConfig(options);
  const token = parseBearerToken(getAuthorizationValue(request));

  if (!token) {
    if (config.authRequired) {
      throw Object.assign(new Error("Bearer token required"), {
        statusCode: 401,
        errorCode: "unauthorized",
      });
    }
    return {
      userId: config.localUserId,
      provider: "anonymous",
    };
  }

  const devTokenMatch = /^(dev|test):([^\s:]+)$/.exec(token);
  if (
    devTokenMatch &&
    config.allowDevTokens &&
    isNonProduction(config.nodeEnv)
  ) {
    return { userId: devTokenMatch[2]!, provider: "dev" };
  }

  if (config.verifyToken) {
    try {
      const verified = await config.verifyToken(token);
      if (!verified.uid || verified.uid.length > 128)
        throw new Error("Invalid verified user ID");
      return {
        userId: verified.uid,
        provider: "firebase",
        ...(verified.email ? { email: verified.email } : {}),
      };
    } catch {
      throw Object.assign(new Error("Invalid Firebase token"), {
        statusCode: 401,
        errorCode: "invalid_token",
      });
    }
  }

  if (config.firebaseProjectId) {
    throw Object.assign(new Error("Firebase auth is not configured"), {
      statusCode: 501,
      errorCode: "firebase_auth_not_configured",
    });
  }

  throw Object.assign(new Error("Invalid Bearer token"), {
    statusCode: 401,
    errorCode: "invalid_token",
  });
}

const isPublicRoute = (request: FastifyRequest): boolean =>
  request.method === "GET" && request.url.split("?")[0] === "/health";

export function registerAuthMiddleware(
  app: FastifyInstance,
  options: AuthOptions = {},
): void {
  const config = createAuthConfig(options);
  app.decorateRequest("actor");
  app.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (isPublicRoute(request)) {
        request.actor = { userId: config.localUserId, provider: "anonymous" };
        return;
      }

      try {
        request.actor = await resolveAuthenticatedActor(request, config);
      } catch (error) {
        const statusCode =
          typeof (error as { statusCode?: unknown }).statusCode === "number"
            ? (error as { statusCode: number }).statusCode
            : 401;
        const errorCode =
          typeof (error as { errorCode?: unknown }).errorCode === "string"
            ? (error as { errorCode: string }).errorCode
            : "unauthorized";
        return reply.status(statusCode).send({
          error: errorCode,
          message:
            error instanceof Error ? error.message : "Authentication failed",
        });
      }
    },
  );
}
