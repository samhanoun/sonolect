import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { VerifyToken } from "./auth.js";

const firebaseKeys = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
  { timeoutDuration: 5000 },
);

/** Verifies Firebase client ID tokens, not admin custom tokens or caller identities. */
export function createFirebaseVerifier(
  projectId: string,
  keys: JWTVerifyGetKey = firebaseKeys,
): VerifyToken {
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(projectId))
    throw new Error("Invalid Firebase project ID");
  return async (token) => {
    if (token.length > 16384) throw new Error("Invalid token length");
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ["RS256"],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      requiredClaims: ["sub", "exp", "iat", "auth_time"],
    });
    const now = Math.floor(Date.now() / 1000);
    if (
      !payload.sub ||
      payload.sub.length > 128 ||
      !Number.isInteger(payload.iat) ||
      payload.iat! > now ||
      !Number.isInteger(payload.auth_time) ||
      (payload.auth_time as number) > now ||
      (payload.auth_time as number) < 0
    )
      throw new Error("Invalid Firebase identity claims");
    return {
      uid: payload.sub,
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
    };
  };
}
