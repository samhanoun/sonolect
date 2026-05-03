export type DesktopAuthEnv = {
  MODE?: string;
  VITE_SONOLECT_API_TOKEN?: string;
  VITE_SONOLECT_DEV_AUTH_TOKEN?: string;
  VITE_SONOLECT_LOCAL_DEV_AUTH?: string;
  VITE_SONOLECT_LOCAL_USER_ID?: string;
};

export type DesktopAuthConfig = {
  token?: string;
  localUserId: string;
  localDevAuth: boolean;
  source: "api-token" | "dev-token" | "generated-dev-token" | "none";
};

type LocalAuthStorage = Pick<Storage, "getItem" | "setItem">;

type ResolveDesktopAuthOptions = {
  storage?: LocalAuthStorage;
};

const defaultLocalUserId = "local-user";
const localUserStorageKey = "sonolect.localUserId";

export function resolveDesktopAuthConfig(
  env: DesktopAuthEnv = import.meta.env ?? {},
  options: ResolveDesktopAuthOptions = {},
): DesktopAuthConfig {
  const mode = env.MODE?.trim();
  const production = mode === "production";
  const apiToken = trimToUndefined(env.VITE_SONOLECT_API_TOKEN);
  const devToken = trimToUndefined(env.VITE_SONOLECT_DEV_AUTH_TOKEN);
  const localDevAuth =
    env.VITE_SONOLECT_LOCAL_DEV_AUTH === "true" && !production;
  const storedLocalUserId = readStoredLocalUserId(options.storage);
  const localUserId = sanitizeLocalUserId(
    env.VITE_SONOLECT_LOCAL_USER_ID ?? storedLocalUserId,
  );

  if (localDevAuth) {
    persistLocalUserId(options.storage, localUserId);
  }

  if (apiToken) {
    return { token: apiToken, localUserId, localDevAuth, source: "api-token" };
  }

  if (devToken && !production) {
    const userId = userIdFromDevToken(devToken) ?? localUserId;
    if (localDevAuth) {
      persistLocalUserId(options.storage, userId);
    }
    return {
      token: devToken,
      localUserId: userId,
      localDevAuth,
      source: "dev-token",
    };
  }

  if (localDevAuth) {
    return {
      token: `dev:${localUserId}`,
      localUserId,
      localDevAuth,
      source: "generated-dev-token",
    };
  }

  return { localUserId, localDevAuth: false, source: "none" };
}

export function createAuthHeaders(
  config = resolveDesktopAuthConfig(),
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  if (config.localDevAuth)
    headers["x-sonolect-local-user-id"] = config.localUserId;
  return headers;
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeLocalUserId(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && /^[a-zA-Z0-9._-]+$/.test(trimmed)
    ? trimmed
    : defaultLocalUserId;
}

function userIdFromDevToken(token: string): string | undefined {
  const match = /^(?:dev|test):([^\s:]+)$/.exec(token);
  return match?.[1];
}

function readStoredLocalUserId(storage: LocalAuthStorage | undefined) {
  try {
    return storage?.getItem(localUserStorageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

function persistLocalUserId(
  storage: LocalAuthStorage | undefined,
  localUserId: string,
) {
  try {
    storage?.setItem(localUserStorageKey, localUserId);
  } catch {
    // Local dev auth should still work if browser storage is unavailable.
  }
}
