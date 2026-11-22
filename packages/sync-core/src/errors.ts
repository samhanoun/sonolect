/**
 * Why a sync run (or a transport call) failed.
 *
 * - unauthorized: the server does not accept this key: the vault is unknown
 *   to it (401) or its id is taken by another key (409). Not retryable.
 * - gone: 410. With code "vault_deleted" the vault was deleted, usually by
 *   "Turn off sync and delete the server copy" on another device. Not
 *   retryable. (The engine handles the cursor codes itself.)
 * - rateLimited: 429; retry after `retryAfterMs`.
 * - tooLarge: 413, the request was over the server's limit.
 * - server: a 5xx, or an answer this version does not understand.
 * - network: no answer at all: offline, DNS, TLS, timeout.
 */
export type SyncErrorKind =
  "unauthorized" | "gone" | "rateLimited" | "tooLarge" | "server" | "network";

export interface SyncErrorOptions {
  /** HTTP status, when there was an answer. */
  status?: number | undefined;
  /** The server's error code (`ErrorResponse.error`). */
  code?: string | undefined;
  /** rateLimited: how long to wait. */
  retryAfterMs?: number | undefined;
  cause?: unknown;
}

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly retryAfterMs: number | undefined;
  override readonly cause: unknown;

  constructor(
    kind: SyncErrorKind,
    message: string,
    options: SyncErrorOptions = {},
  ) {
    super(message);
    this.name = "SyncError";
    this.kind = kind;
    this.status = options.status;
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
    this.cause = options.cause;
  }

  /** Worth trying again later (with backoff): network, server and rate limits. */
  get retryable(): boolean {
    return (
      this.kind === "network" ||
      this.kind === "server" ||
      this.kind === "rateLimited"
    );
  }

  /** The vault no longer exists for this key: turn sync off and keep the local notes. */
  get vaultGone(): boolean {
    return this.kind === "unauthorized" || this.kind === "gone";
  }
}

export const isSyncError = (error: unknown): error is SyncError =>
  error instanceof SyncError;

/** Thrown by an engine after close(), forget() or deleteVault(). */
export class SyncClosedError extends Error {
  constructor() {
    super("sync is turned off on this device");
    this.name = "SyncClosedError";
  }
}
