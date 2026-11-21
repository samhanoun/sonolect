# Sonolect API Design

TODO: Expand this document from the approved Sonolect architecture specification.

## What production serves

In production the API and the agent, audio and worker services never answer with made-up results and never take data they would lose. Routes and endpoints that cannot meet that rule are off or fail with an error in production. Outside production they behave as before, for local development and tests.

### API (`services/api`)

The API runs in production when `NODE_ENV` is `production`, unset or empty. The container image and the Cloud Run services in `infra/terraform` set `NODE_ENV=production`, and a plain `node dist/index.js` starts in production too. Every route except `GET /health` needs a Firebase ID token.

| Route                                                                            | In production | Why                                                                                                                |
| -------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /health`                                                                    | On            |                                                                                                                    |
| `POST /v1/transcribe`                                                            | On            | Google Speech-to-Text. Answers 503 `not_configured` without `GCP_PROJECT_ID`.                                      |
| `POST /v1/polish`                                                                | On            | Vertex AI. Answers 503 `not_configured` without `GCP_PROJECT_ID`.                                                  |
| `GET /users/profile`                                                             | Off           | Keeps a record per user in memory. The plan and the creation date are made up.                                     |
| `POST /audio/jobs`, `GET /audio/jobs/:id`, `POST /audio/jobs/:id/audio`          | Off           | Job metadata stays in memory and the audio in a temp dir. Only the local audio worker transcribes it.              |
| `GET /transcripts`, `POST /transcripts`, `GET`/`PATCH`/`DELETE /transcripts/:id` | Off           | Kept in memory, or in a local JSON file with `SONOLECT_API_STORE_PATH`. A restart or a second instance loses them. |
| `POST /commands/execute`                                                         | Off           | Answers "Command accepted" and runs nothing.                                                                       |
| `GET /usage/quota`                                                               | Off           | Fixed limits, and minutes used is always 0.                                                                        |
| `GET /sync/manifest`                                                             | Off           | Lists the in-memory transcripts and commands.                                                                      |

An off route is not registered. A signed-in caller gets 404. A caller without a token gets 401, as on every route but `GET /health`. The API logs the off routes once at start.

`SONOLECT_API_PREVIEW_ROUTES=1` (or `true`) registers the off routes in production too, for example for a single self-hosted instance. The API then logs a warning at start. Leave it unset on Cloud Run: instances restart and scale out, so the data would be lost.

No shipped app calls an off route. Desktop release builds set no `VITE_SONOLECT_API_URL`, and the mobile API switch (`API_FEATURES_ENABLED` in `apps/mobile/src/features.ts`) is off.

#### `POST /v1/polish` input

| Field         | Rule                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `transcript`  | Required, non-empty, at most 20,000 characters (413 above).                                                                               |
| `stylePreset` | Optional text of at most 256 characters, sent to the model as an instruction. A longer or non-text value gets 422 `invalid_style_preset`. |
| `dictionary`  | At most 200 entries (413 above). Entries with a `spoken` or `written` longer than 100 characters are skipped.                             |
| `locale`      | Optional, at most 64 characters.                                                                                                          |

A model answer with no text gets 502 `polish_empty`; the API never returns the raw transcript as if it were polished.

The mobile app sends one preset per mode (`stylePresetForMode` in `apps/mobile/src/refine.ts`, 57 to 87 characters). The desktop app sends no preset. A test in `services/api` reads the mobile presets and fails if one ever exceeds the cap.

### Internal services

The agent, audio and worker services run in production only when `NODE_ENV=production`. For them an unset `NODE_ENV` means development; their images set `NODE_ENV=production`. The service token is checked first, so a caller without one gets 401. Each service logs its unavailable endpoints once at start.

| Service | Endpoint                                                                                                                    | In production                                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| agent   | `POST /llm/rewrite`, `POST /llm/summarize`                                                                                  | Calls the provider when its key is set. 503 `not_configured` when neither `OPENAI_API_KEY` nor `ANTHROPIC_API_KEY` is set, or when the requested provider has no key. Outside production they fall back to a local clean-up. |
| agent   | `POST /commands/execute`, `GET /commands/:id`                                                                               | 501 `not_implemented`: no command executor is connected.                                                                                                                                                                     |
| agent   | `POST /agents`                                                                                                              | 501 `not_implemented`: custom agents are kept only in memory.                                                                                                                                                                |
| agent   | `GET /agents`                                                                                                               | On. Lists the built-in agents.                                                                                                                                                                                               |
| audio   | `POST /transcriptions`, `GET /transcriptions/:id`, `POST /transcriptions/:id/cancel`                                        | 501 `not_implemented`: the mock provider is off and Google Speech-to-Text runs in the API (`POST /v1/transcribe`).                                                                                                           |
| audio   | `POST /refinements`                                                                                                         | `rewrite` and `translate` answer 501 `refinement_unavailable`. `clean` and `summarize` stay on, labelled `provider: "template"`.                                                                                             |
| worker  | `GET /tasks`, `POST /tasks`, `POST /events/audio`, `POST /events/agent`, `POST /events/billing`, `POST /tasks/:id/dispatch` | 501 `not_implemented`: the task handlers are placeholders and the queue lives in memory.                                                                                                                                     |

This page does not cover the billing service. The sync service's protocol is in the next section.

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
