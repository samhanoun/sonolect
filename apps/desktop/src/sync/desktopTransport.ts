/**
 * The sync engine's transport on desktop: sync-core's HTTP protocol, sent by
 * the native side (`sync_request`), which holds the server URL fixed at build
 * time, the timeout and the size limits. The webview never talks to the
 * network itself, so the sync server needs no CORS.
 */
import {
  type HttpRequester,
  SyncError,
  type SyncTransport,
  type VaultKeys,
  createHttpTransport,
} from "@sonolect/sync-core";

import type { Invoke } from "./platform";

/** The server's answer as `sync_request` returns it, whatever its status. */
interface NativeResponse {
  status: number;
  body: string;
  retryAfter?: string;
}

/** Why `sync_request` got no answer (see `RequestErrorKind` in sync.rs). */
type RequestErrorKind =
  "unavailable" | "invalid" | "tooLarge" | "network" | "responseTooLarge";

const kindOf = (error: unknown): RequestErrorKind | undefined => {
  const kind =
    typeof error === "object" && error !== null
      ? (error as { kind?: unknown }).kind
      : undefined;
  return typeof kind === "string" ? (kind as RequestErrorKind) : undefined;
};

/** The SyncError the engine expects for a request that got no answer. */
export function requestError(error: unknown): SyncError {
  switch (kindOf(error)) {
    case "tooLarge":
      // The engine splits the batch, or sets a single note aside.
      return new SyncError(
        "tooLarge",
        "the request was too large for the sync server",
      );
    case "responseTooLarge":
      return new SyncError("server", "the sync server's answer is too large");
    case "invalid":
    case "unavailable":
      return new SyncError("server", "the sync request could not be sent");
    default:
      return new SyncError("network", "the sync server could not be reached", {
        cause: error,
      });
  }
}

/**
 * Sends the engine's requests through `sync_request`. The bearer token goes
 * as its own argument, never in a header the webview builds; the native side
 * refuses any request that is not one of the vault routes.
 */
export function desktopRequester(invoke: Invoke): HttpRequester {
  return async ({ method, path, headers, body }) => {
    const bearer = /^Bearer (\S+)$/.exec(headers.authorization ?? "")?.[1];
    let response: NativeResponse;
    try {
      response = await invoke<NativeResponse>("sync_request", {
        method,
        path,
        body: body ?? null,
        bearer: bearer ?? null,
      });
    } catch (error) {
      throw requestError(error);
    }
    return {
      status: response.status,
      body: response.body,
      retryAfter: response.retryAfter ?? null,
    };
  };
}

/** The transport for one vault. */
export function createDesktopTransport(
  invoke: Invoke,
  keys: Pick<VaultKeys, "vaultId" | "authVerifier" | "authToken">,
  now: () => number,
): SyncTransport {
  return createHttpTransport(
    {
      request: desktopRequester(invoke),
      vault: {
        vaultId: keys.vaultId,
        authVerifier: keys.authVerifier,
        authToken: keys.authToken,
      },
    },
    now,
  );
}
