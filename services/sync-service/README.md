# @sonolect/sync-service

The server for end-to-end encrypted note sync. The desktop and mobile apps
call it directly over HTTPS through `@sonolect/sync-core`. It keeps sealed
records per vault, orders them in a change feed, and holds no key.

The server only ever sees: vaultId, the bearer authToken (it stores only its
SHA-256), record ids (rids), revisions, sizes, timestamps, IP addresses and
ciphertext. It never logs request bodies or tokens. The protocol types and
limits live in `@sonolect/sync-core/wire`, which the service imports without
the client crypto.

## Routes

| Route                                         | Auth          | Answers                                                                                        |
| --------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------- |
| `GET /health`                                 | none          | 200 `{status: "ok", service: "sonolect-sync-service"}`                                         |
| `POST /v1/vaults`                             | none          | 201 created, 200 already there with the same verifier, 409 `vault_exists`, 410 `vault_deleted` |
| `GET /v1/vaults/:vaultId/changes?since&limit` | vault token   | 200 a page of the change feed, 410 `cursor_reset`, `cursor_expired` or `vault_deleted`         |
| `POST /v1/vaults/:vaultId/records`            | vault token   | 200 one result per write, 410 `vault_deleted`                                                  |
| `DELETE /v1/vaults/:vaultId`                  | vault token   | 204, also when the vault is already deleted                                                    |
| `GET /v1/admin/status`                        | service token | 200 `{service, store, limits}`                                                                 |

- **Creating a vault.** The body is `{vaultId, authVerifier}`, where the
  verifier is `base64url(SHA-256(token))`. The server picks the vault's
  `epoch` (8 random bytes) and answers `{vaultId, created, epoch}`. A
  deleted vault's id stays taken, so the same key cannot bring it back.
- **The change feed.** `since` is the last seq a device applied (default 0)
  and `limit` is 1 to 200 (default 200). A page holds at most 200 records
  and 4 MiB of ciphertext, except that a page always takes its first
  record, however large. The answer is
  `{records: [{rid, rev, seq, deleted, ct}], next, hasMore, head, epoch}`.
  - `since` above the vault's head answers 410 `cursor_reset`: the server
    lost data, so the device starts again from 0.
  - `since` above 0 but below the seq of a purged tombstone answers 410
    `cursor_expired`: the device starts again from 0 and treats records
    it no longer finds as deleted.
- **Writes.** The body is `{writes: [{rid, baseRev, deleted, ct}]}` with 1
  to 100 writes and distinct rids. Each write is a compare-and-swap:
  `baseRev` must be the record's current revision, or 0 for a record the
  server does not have. The results come back in request order:
  - `{status: "ok", rev, seq}`: stored as revision `baseRev + 1`, at the
    vault's next seq;
  - `{status: "conflict", current}`: the record the server holds, or null;
  - `{status: "rejected", reason}`: `quota_records` (20,000 notes, or
    40,000 records with the tombstones) or `quota_bytes` (200 MiB).
    Turning a stored record into a tombstone is never refused, so a full
    vault can always be cleaned up, and it frees the note's slot at once.
    Tombstones count in the bytes until they are purged, 90 days later.

  One batch is one transaction, and the seqs it assigns have no gaps. A
  sealed record is 42 bytes to 768 KiB; a larger one answers 413. A write
  with `deleted: true` carries a tombstone (298 bytes): one over 1 KiB
  answers 400, so a delete cannot carry data past the quota.

- **Deleting a vault** erases every record. From then on its routes answer
  410 `vault_deleted`, which tells the other devices that "this sync was
  deleted".

Every error is `{error, message}`, with a code from `SYNC_ERROR_CODES`:

| Status | Code                                              | When                                                                                      |
| ------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 400    | `bad_request`                                     | Malformed body, query or path (the message never quotes the request)                      |
| 401    | `unauthorized`                                    | Unknown vault, wrong token or no token: one answer for all three, with `WWW-Authenticate` |
| 404    | `not_found`                                       | A malformed vault id, or no such route                                                    |
| 409    | `vault_exists`                                    | `POST /v1/vaults` for an id that another verifier holds                                   |
| 410    | `vault_deleted`, `cursor_reset`, `cursor_expired` | See above                                                                                 |
| 413    | `record_too_large`                                | A record over 768 KiB, or a body over 5 MiB                                               |
| 429    | `rate_limited`                                    | With `Retry-After` in seconds                                                             |
| 500    | `internal_error`                                  | Logged with the error, never with the request body                                        |

## Authentication and limits

- **Vault routes** are public to the service-token check (service-kit's
  `publicRoutes`). Each one checks the vault's bearer token itself: it
  hashes the presented token and compares it with the stored verifier using
  `timingSafeEqual`. An unknown vault is compared against a random verifier,
  so it costs the same as a wrong token.
- **Admin routes** need a service token from `SONOLECT_SERVICE_TOKENS`.
  Production refuses to start without one.
- **Rate limits**, in fixed windows per instance:
  - 600 requests per minute per IP address, on every route but `/health`;
  - 120 requests per minute per vault, counted after authentication;
  - 10 new vaults per hour per IP address. Confirming an existing vault does
    not count. A creation takes its slot before the store is asked, so
    concurrent requests cannot pass the limit together.
  - An IPv6 client counts by its /64 prefix (it can use any address in it),
    an IPv4 client by its address, and an IPv4 address mapped into IPv6
    (`::ffff:192.0.2.1`) as that IPv4 address.
- **Client IP.** `request.ip` comes from `X-Forwarded-For` only behind a
  trusted proxy: one hop on Cloud Run (`K_SERVICE` is set there), otherwise
  none unless `SONOLECT_SYNC_TRUST_PROXY` says how many. A direct caller
  therefore cannot pick its own address.
- **CORS** is off unless `SONOLECT_SYNC_ALLOWED_ORIGINS` lists origins. The
  apps do not need it when they call through a native HTTP client.
- **Logs** are Fastify's JSON request lines: method, URL (vault id, `since`
  and `limit`), host, remote address, status and timing. The
  `authorization` header is redacted, and no body is logged.

## Configuration

| Variable                                 | Meaning                                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `SONOLECT_SYNC_STORE`                    | `memory` (the default outside production), `sqlite:<path>` or `firestore`. Required in production, where memory is refused |
| `SONOLECT_SERVICE_TOKENS`                | Service tokens for the admin routes, comma-separated, 32+ characters each. Required in production                          |
| `SONOLECT_SYNC_TRUST_PROXY`              | Proxy hops to trust for `X-Forwarded-For` (0 to 99). Default: 1 on Cloud Run, else 0                                       |
| `SONOLECT_SYNC_ALLOWED_ORIGINS`          | Comma-separated `scheme://host[:port]` origins that may call from a browser. Unset: CORS off                               |
| `GOOGLE_CLOUD_PROJECT`, `GCLOUD_PROJECT` | Firestore project (default: the client library's detection)                                                                |
| `SONOLECT_SYNC_FIRESTORE_DATABASE`       | Firestore database id (default: `(default)`)                                                                               |
| `FIRESTORE_EMULATOR_HOST`                | Use the Firestore emulator (tests)                                                                                         |
| `NODE_ENV`, `PORT`, `HOST`, `LOG_LEVEL`  | Production mode; listen port (8080) and address (`0.0.0.0` in production, `127.0.0.1` otherwise); log level (`info`)       |

A bad value stops the service at start with a message that names the
variable.

## Stores

Every store implements `VaultStore` (`src/store.ts`). The compare-and-swap,
the quotas and the page cut are shared code, so the stores differ only in
how they keep the data. The Firestore client and `node:sqlite` are imported
only when that store is chosen.

- **`memory`**: process memory, for tests and local development.
- **`sqlite:<path>`**: one file through `node:sqlite`, in WAL mode, with
  `STRICT` tables `vaults` and `records`. A unique index on `(vault, seq)`
  serves the feed, and a partial index on tombstones serves the purge.
  Writes run in `BEGIN IMMEDIATE` transactions. The file's `user_version`
  is the schema version; a newer file is refused. The parent directory is
  created if needed. Node 22 and 24 print an ExperimentalWarning for
  `node:sqlite`; the Node 26 image does not.
- **`firestore`**: for Cloud Run, through the Admin SDK
  (`@google-cloud/firestore`, pinned).
  - `syncVaults/{vaultId}` holds the verifier, epoch, head, counters,
    `purgedSeq`, `purgedAt` and `deletedAt`.
  - `syncVaults/{vaultId}/records/{rid}` holds `rev`, `seq`, `deleted`, `ct`
    (bytes), `size`, `updatedAt`, and `tombstoneAt` on tombstones.
  - Firestore reserves document ids that match `__.*__`, which a base64url
    id can (about one record id in 16 million). Such an id is stored as
    `~{id}`; base64url never holds `~`.
  - Each write batch is one transaction. The feed queries `seq` and the
    purge queries `tombstoneAt`, both through Firestore's automatic
    single-field indexes, so there is no composite index to deploy.
  - There is no TTL policy. The service purges tombstones itself, because
    the purge must also update the vault's counters and `purgedSeq`.
  - `infra/firebase/firestore.rules` denies this collection to client SDKs
    (the catch-all rule); the Admin SDK is not subject to rules.

**Tombstones** are purged 90 days after the delete, at most once a day per
vault, when the vault is next read or written. Deleting a vault erases its
records at once and keeps a marker with the verifier, so its id answers 410
from then on. The service never removes a vault on its own, so the markers
and abandoned vaults stay until an operator removes them.

**Backups.** A device notices that the store went back in time only while
the vault's head is still below the highest seq it has seen. After
restoring a backup, give every vault a new `epoch` (11 random base64url
characters) before serving traffic again. Every device then runs a full
resync and uploads what the backup lost.

## Running it

```bash
pnpm --filter @sonolect/sync-service dev     # memory store, 127.0.0.1:8080
SONOLECT_SYNC_STORE=sqlite:./sync.db pnpm --filter @sonolect/sync-service dev

pnpm --filter @sonolect/sync-service test            # memory, SQLite, end to end
pnpm --filter @sonolect/sync-service test:firestore  # needs FIRESTORE_EMULATOR_HOST
pnpm --filter @sonolect/sync-service build
SONOLECT_SYNC_STORE=sqlite:/tmp/sync.db pnpm --filter @sonolect/sync-service smoke
```

- `test` runs the store and route suites on the memory store and on SQLite,
  the configuration tests, and two devices syncing through the real service
  over HTTP. That last test also checks that the SQLite file holds no word
  of a note, no note id and no token.
- `test:firestore` runs the same suites on Firestore. Without
  `FIRESTORE_EMULATOR_HOST` it skips. CI runs it in the "Sync service
  (Firestore emulator)" job.
- `smoke` starts `dist/index.js` in production mode on the store that
  `SONOLECT_SYNC_STORE` names. It creates a vault, writes, reads, deletes
  and expects 410. CI runs it on Firestore.

## Docker

```bash
docker build -f services/sync-service/Dockerfile -t sonolect-sync-service .
docker run --rm -p 8080:8080 \
  -e SONOLECT_SYNC_STORE=sqlite:/tmp/sync.db \
  -e SONOLECT_SERVICE_TOKENS="$(openssl rand -hex 32)" \
  sonolect-sync-service
```

The image runs Node 26 as the `node` user. `pnpm deploy --prod` copies the
production dependencies, including the Firestore client. On Cloud Run, set
`SONOLECT_SYNC_STORE=firestore`; a SQLite file there would live on the
instance's memory-backed disk and be lost.

## Hosting

`infra/terraform/sync` deploys the image to Cloud Run with Firestore, a
generated service token in Secret Manager and public invocation, at most 2
instances. [docs/sync-setup.md](../../docs/sync-setup.md) is the runbook,
with a `gcloud run deploy` fallback, and
[LOCAL-BUILD.md](../../LOCAL-BUILD.md#note-sync-against-a-local-server) points
development builds of the apps at a local service.
