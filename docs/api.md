# Sonolect API Design

TODO: Expand this document from the approved Sonolect architecture specification.

## What production serves

In production the API and the agent, audio, billing and worker services never answer with made-up results and never take data they would lose. Routes and endpoints that cannot meet that rule are off or fail with an error in production. Outside production they behave as before, for local development and tests.

### API (`services/api`)

The API runs in production unless `NODE_ENV` is `development` or `test`, in any case. Every other value is production: unset, empty, `production`, and also `Production`, `prod` or `staging`. The container image and the Cloud Run services in `infra/terraform` set `NODE_ENV=production`, and a plain `node dist/index.js` starts in production too. Every route except `GET /health` needs a Firebase ID token.

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

#### `/v1` limits and errors

Each signed-in account gets 30 requests per minute on each `/v1` route, counted per API instance (429 `rate_limited`, with `Retry-After`). The budget is checked before the body is read, so an account over budget never makes the API buffer its upload.

The errors the API sends on these routes, the codes in the table below included, are `{error: {code, message, retryable}}`. Provider errors are logged, never returned. `retryable: false` means the same request will fail the same way. Fastify's own request errors keep Fastify's `{statusCode, code, error, message}` body, where `error` is a string: for example 400 `FST_ERR_CTP_INVALID_JSON_BODY` for malformed JSON, or 415 `FST_ERR_CTP_INVALID_MEDIA_TYPE` for a Content-Type that is not `audio/*`.

| Status | `code`                               | Retryable | Meaning                                                                                                                                          |
| ------ | ------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 413    | `audio_too_large`                    | No        | The audio is over 10 MiB (10,485,760 bytes), Google's limit for synchronous recognition. The API stops reading the body at the limit.            |
| 422    | `audio_rejected`                     | No        | Google refused the audio (`INVALID_ARGUMENT`), most often because it is longer than one minute.                                                  |
| 422    | `polish_rejected`                    | No        | Vertex AI refused the text (`INVALID_ARGUMENT`).                                                                                                 |
| 502    | `model_not_found`                    | No        | The configured model or recognizer does not exist (`NOT_FOUND`), for example a retired Gemini model. It stays this way until the config changes. |
| 503    | `transcribe_failed`, `polish_failed` | Yes       | Any other provider error, such as quota or a timeout.                                                                                            |

#### `POST /v1/transcribe` input

The body is the audio itself, with an `audio/*` Content-Type. Parameters are allowed, so `audio/webm;codecs=opus` from a Chromium recorder works. The `language` query parameter is the language tag (default `en-US`). Synchronous recognition takes at most one minute of audio. Longer dictations are not supported yet.

#### `POST /v1/polish` model

The model is `SONOLECT_GEMINI_MODEL`, `gemini-2.5-flash` when it is unset or blank. Vertex AI retired `gemini-2.5-flash` on October 16, 2026, after `gemini-2.0-flash`, so with the default model `/v1/polish` is expected to answer 502 `model_not_found`. A deploy that sets `GCP_PROJECT_ID` must also set a current model. Keep `infra/terraform` on the same model id.

Choosing that model is an owner decision, because it is tied to the location:

- The Gemini 3.x Flash models may not be served in a single region such as `europe-west1`, the Terraform default for `SONOLECT_VERTEX_LOCATION`. Check the model's page for its locations. The `eu` and `us` multi-regions keep data in one area; `global` does not.
- The installed `@google-cloud/vertexai` SDK, which Google has deprecated, builds the host as `<location>-aiplatform.googleapis.com`. That is not the host of the global endpoint (`aiplatform.googleapis.com`), so a location that is not a single region needs the SDK's `apiEndpoint` option, set to the host Google documents for it, or a move to `@google/genai`.

#### `POST /v1/polish` input

| Field         | Rule                                                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transcript`  | Required, non-empty, at most 20,000 characters (413 above).                                                                                                                                                |
| `stylePreset` | Optional, one line of text of at most 256 characters, sent to the model as an instruction. A longer value, a line break or another control character, or a non-text value gets 422 `invalid_style_preset`. |
| `dictionary`  | At most 200 entries (413 above). Entries with a `spoken` or `written` longer than 100 characters, or with a line break or another control character, are skipped.                                          |
| `locale`      | Optional, at most 64 characters.                                                                                                                                                                           |

A model answer with no text gets 502 `polish_empty`, marked retryable. An answer the model did not finish, because it reached the token limit or a safety or other filter stopped it, gets 502 `polish_incomplete`, marked not retryable. The API never returns the raw transcript or a cut-off text as if it were polished.

The mobile app sends one preset per mode (`stylePresetForMode` in `apps/mobile/src/refine.ts`, 57 to 87 characters). The desktop app sends no preset. A test in `services/api` reads the mobile presets and fails if one ever exceeds the cap.

#### Preview route details

- `GET /transcripts` takes `limit` (1 to 100, default 25), `includeDeleted` (`true` or `false`, also `1` or `0`, in any letter case; any other value, such as `yes` or `off`, gets 400) and `cursor`, the `nextCursor` of the previous page. The next page starts after that transcript's place in the list, also when it was deleted in between. A cursor that names none of the caller's transcripts gets 400 `invalid_cursor`.
- `POST /audio/jobs` takes an optional `language` tag for the transcript (default `en`). The local audio worker passes it to its `{language}` placeholder. `mimeType` may carry parameters such as `;codecs=opus`; the job keeps the bare media type.
- With `SONOLECT_API_STORE_PATH`, the requests that change the file run one at a time in the API process. Run one API instance per file.
- A server error (5xx) answers `{error: "internal_error", message: "Internal server error"}`. The details are only logged.

### Internal services

The agent, audio, billing and worker services run in production only when `NODE_ENV=production`. For them an unset `NODE_ENV` means development; their images set `NODE_ENV=production`. The service token is checked first, so a caller without one gets 401. The billing plan list and the Stripe webhook need no service token, so they answer 501 to any caller. Each service logs its unavailable endpoints once at start.

| Service | Endpoint                                                                                                                    | In production                                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| agent   | `POST /llm/rewrite`, `POST /llm/summarize`                                                                                  | Calls the provider when its key is set. 503 `not_configured` when neither `OPENAI_API_KEY` nor `ANTHROPIC_API_KEY` is set, or when the requested provider has no key. Outside production they fall back to a local clean-up. |
| agent   | `POST /commands/execute`, `GET /commands/:id`                                                                               | 501 `not_implemented`: no command executor is connected.                                                                                                                                                                     |
| agent   | `POST /agents`                                                                                                              | 501 `not_implemented`: custom agents are kept only in memory.                                                                                                                                                                |
| agent   | `GET /agents`                                                                                                               | On. Lists the built-in agents.                                                                                                                                                                                               |
| audio   | `POST /transcriptions`, `GET /transcriptions/:id`, `POST /transcriptions/:id/cancel`                                        | 501 `not_implemented`: the mock provider is off and Google Speech-to-Text runs in the API (`POST /v1/transcribe`).                                                                                                           |
| audio   | `POST /refinements`                                                                                                         | `rewrite`, `summarize` and `translate` answer 501 `refinement_unavailable`: their output would be a template. `clean` stays on, labelled `provider: "template"`: it only removes filler words and extra spaces.              |
| billing | `GET /billing/plans`, `GET /billing/users/:userId/quota`, `POST /billing/usage`, `POST /webhooks/stripe`                    | 501 `not_implemented`: usage, plans and Stripe customer links are kept only in memory, and no plan can be bought yet. A 501 tells Stripe the event was not delivered, so Stripe sends it again later.                        |
| worker  | `GET /tasks`, `POST /tasks`, `POST /events/audio`, `POST /events/agent`, `POST /events/billing`, `POST /tasks/:id/dispatch` | 501 `not_implemented`: the task handlers are placeholders and the queue lives in memory.                                                                                                                                     |

The sync service's protocol is in the next section.

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
