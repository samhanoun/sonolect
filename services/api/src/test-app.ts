import { createApp, type CreateAppOptions } from "./index.js";

/** In-process test verifier; never used by production startup. */
export function createAuthenticatedTestApp(options: CreateAppOptions = {}) {
  return createApp({
    ...options,
    nodeEnv: "test",
    authRequired: true,
    verifyToken: async (token) => ({ uid: token }),
  });
}
