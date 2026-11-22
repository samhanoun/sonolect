# Sonolect API Design

The product API (`services/api`) is not documented here yet. TODO: expand this
section from the approved Sonolect architecture specification.

## Note sync vault API

The HTTP protocol between the apps and `services/sync-service`, version 1.
The apps speak it through `@sonolect/sync-core`; its types, limits and error
codes are in `packages/sync-core/src/wire.ts` (`@sonolect/sync-core/wire`).
[services/sync-service/README.md](../services/sync-service/README.md) has the
service's side in more detail, and [security.md](security.md#note-sync) the
threat model.

- **Base URL**: the sync server fixed in the app build (`SONOLECT_SYNC_URL`,
  `EXPO_PUBLIC_SONOLECT_SYNC_URL`), `https://` in release builds.
- **Encoding**: JSON bodies and answers. Every byte string is unpadded
  base64url.
- **Authentication**: `Authorization: Bearer <authToken>` on every vault
  route except vault creation. There is no account: the token is derived
  from the vault's root key, and the server stores only
  `authVerifier = base64url(SHA-256(token bytes))`.
- **Identifiers**: `vaultId` is 16 bytes (22 characters); `authToken` and
  `authVerifier` are 32 bytes (43 characters); a record id (`rid`) is 18
  bytes of HMAC of the note id (24 characters), so the server never sees
  note ids. `ct` is a sealed record (42 bytes to 768 KiB).

### Routes

| Method and path                               | Auth          | Body or query                                    | Success                                              |
| --------------------------------------------- | ------------- | ------------------------------------------------ | ---------------------------------------------------- |
| `GET /health`                                 | none          |                                                  | 200 `{status: "ok", service}`                        |
| `POST /v1/vaults`                             | none          | `{vaultId, authVerifier}`                        | 201 created, 200 exists: `{vaultId, created, epoch}` |
| `GET /v1/vaults/:vaultId/changes?since&limit` | vault token   | `since`: last seq applied (0); `limit`: 1 to 200 | 200 `{records, next, hasMore, head, epoch}`          |
| `POST /v1/vaults/:vaultId/records`            | vault token   | `{writes: [{rid, baseRev, deleted, ct}]}`, 1–100 | 200 `{results}`, one per write, in order             |
| `DELETE /v1/vaults/:vaultId`                  | vault token   |                                                  | 204, also when already deleted                       |
| `GET /v1/admin/status`                        | service token |                                                  | 200 `{service, store, limits}`                       |

- **`POST /v1/vaults`** creates the vault, or confirms it when the same
  verifier asks again. The server picks `epoch` (8 random bytes), which
  changes if the vault is ever created again, so devices notice a server
  that lost it. Another verifier for the same id answers 409
  `vault_exists`; a deleted vault answers 410 `vault_deleted`, since its id
  stays taken.
- **`GET …/changes`** returns records with `seq > since` in seq order, each
  `{rid, rev, seq, deleted, ct}`, at most 200 records and 4 MiB of
  ciphertext per page (a page always takes its first record). `next` is the
  cursor for the next page, `head` the vault's latest seq. A `since` above
  `head` answers 410 `cursor_reset`; one older than purged tombstones answers
  410 `cursor_expired`. Both mean: start again from 0.
- **`POST …/records`** is a compare-and-swap per write: `baseRev` is the
  revision the device last saw, 0 for a new record. Results are
  `{rid, status: "ok", rev, seq}`, `{rid, status: "conflict", current}`
  (`current`: the record the server holds, or null) or
  `{rid, status: "rejected", reason: "quota_records" | "quota_bytes"}`. A
  batch is one transaction, and its rids are distinct. Turning a record into
  a tombstone is never refused; a write with `deleted: true` whose `ct` is
  over 1 KiB (a tombstone is 298 bytes) answers 400.
- **`DELETE /v1/vaults/:vaultId`** erases every record. From then on the
  vault's routes answer 410 `vault_deleted`, which the other devices show as
  "This sync was deleted".
- **`GET /v1/admin/status`** is for the operator, with a token from
  `SONOLECT_SERVICE_TOKENS`. The apps never call it.

### Errors

Every error is `{error, message}`. The message never quotes the request.

| Status | `error`                                           | Meaning                                                                      |
| ------ | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| 400    | `bad_request`                                     | Malformed body, query or path                                                |
| 401    | `unauthorized`                                    | Unknown vault, wrong token or no token: one answer for all three             |
| 404    | `not_found`                                       | Malformed vault id, or no such route                                         |
| 409    | `vault_exists`                                    | The vault id belongs to another verifier                                     |
| 410    | `vault_deleted`, `cursor_reset`, `cursor_expired` | The vault was deleted; or the cursor is no longer valid (start again from 0) |
| 413    | `record_too_large`                                | A record over 768 KiB, or a body over 5 MiB                                  |
| 429    | `rate_limited`                                    | Too many requests; `Retry-After` gives the seconds to wait                   |
| 500    | `internal_error`                                  | Logged without the request body                                              |

### Limits

| Limit                        | Value                                                                   |
| ---------------------------- | ----------------------------------------------------------------------- |
| Sealed record                | 42 bytes to 768 KiB (under Firestore's 1 MiB document limit)            |
| Note JSON before compression | 4 MiB                                                                   |
| Request body                 | 5 MiB                                                                   |
| Writes per request           | 100                                                                     |
| Page of changes              | 200 records and 4 MiB                                                   |
| Vault                        | 20,000 notes and 200 MiB; tombstones up to 20,000 more records          |
| Tombstones                   | Purged 90 days after the delete                                         |
| Full resync (client)         | After 60 days without a sync                                            |
| Requests                     | 600 per minute per IP address (not `/health`), 120 per minute per vault |
| New vaults                   | 10 per hour per IP address                                              |

The request limits are kept per service instance. An IPv6 client counts by
its /64 prefix.
