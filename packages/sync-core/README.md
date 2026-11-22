# @sonolect/sync-core

End-to-end encrypted note sync, shared by the desktop app, the mobile app and
`services/sync-service`.

The package uses no platform API. Randomness, time, HTTP and storage come
from the app. The same code therefore runs in the Tauri webview, in Hermes on
the phone and under Node in the tests. `scripts/check-portable.mjs` enforces
this as part of `pnpm lint`. The dependencies are pinned exactly:
`@noble/ciphers` 2.4.0, `@noble/hashes` 2.4.0, `fflate` 0.8.3 and `uqr` 0.1.3.

| Entry point                   | Contents                                                                    |
| ----------------------------- | --------------------------------------------------------------------------- |
| `@sonolect/sync-core`         | Everything below                                                            |
| `@sonolect/sync-core/wire`    | The HTTP protocol, with no dependencies (the service imports only this)     |
| `@sonolect/sync-core/testing` | An in-memory sync server and note store, for app tests (not for production) |

## How it works

- **A vault is a random 32-byte root key.** HKDF-SHA256 (salt
  `sonolect-sync/v1`) derives four values from it:
  - `vaultId`: 16 bytes, which name the vault on the server;
  - `authToken`: 32 bytes, sent as the bearer token (the server keeps only
    its SHA-256, the `authVerifier`);
  - `encKey`, which encrypts the records;
  - `idKey`, which names them.

  There is no account. Whoever holds the root key can read and change every
  synced note.

- **One record per note.** A record's id (`rid`) is
  `base64url(HMAC-SHA256(idKey, "note\n" + noteId))`, cut to 18 bytes, so
  the server never learns note ids.
- **Each record is sealed.** The record is XChaCha20-Poly1305 over the
  deflated JSON payload `{schema: "note/1", id, hlc, deleted, note?}`,
  padded to 256-byte buckets. The authenticated data binds the record to its
  vault and its rid, so a record moved to another id or vault does not open.
  Limits: 4 MiB of JSON, 768 KiB sealed.
- **The server stores opaque records** and orders them with a per-vault
  sequence number (`seq`). Each write is a compare-and-swap on the record's
  revision (`baseRev`).
- **A pull reads the change feed** (`changes?since=seq`) in pages of at most
  200 records and 4 MiB.
- **A push sends the local changes** in batches of at most 100 writes and
  about 4.75 MiB.
- **A hybrid logical clock (HLC) orders the versions of a note.** An HLC is
  `{t, c, d}`: milliseconds, a counter and the device id. The later HLC wins.
  - When both sides changed the content, the losing version is kept as a
    conflict copy, a new note whose `conflictOf` names the original.
  - A newer edit beats a delete.
  - A remote HLC more than an hour ahead of this device's clock is clamped,
    so a device with a wrong clock cannot pin a note.

### What the engine refuses

- **Rollbacks.**
  - A record with an older HLC than the one already applied for that note
    is not applied. It is counted in `report.refused`.
  - If the server's `head` is below the highest seq this device has seen,
    the engine runs a full resync instead of trusting the server.
  - If the vault's epoch changes (the server created the vault again), the
    engine also runs a full resync.
- **Re-reading every note.** `NoteStore.list()` returns summaries only. The
  engine reads a note body only when the note's HLC changed since the last
  upload, or when the note has to be uploaded again.

## Wiring

The app supplies the following.

| What          | Desktop (Tauri webview)                                                                         | Mobile (Expo)                                        |
| ------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `randomBytes` | `(n) => crypto.getRandomValues(new Uint8Array(n))`                                              | `expo-crypto` `getRandomBytes(n)`                    |
| `now`         | `Date.now`                                                                                      | `Date.now`                                           |
| Server URL    | `SONOLECT_SYNC_URL`, fixed at build time                                                        | `EXPO_PUBLIC_SONOLECT_SYNC_URL`, fixed at build time |
| HTTP          | `HttpRequester` over the Rust HTTP client, or over `fetch` if the deployment allows CORS        | `HttpRequester` over `fetch`                         |
| Root key      | OS keychain (Rust side)                                                                         | `expo-secure-store`                                  |
| Sync state    | `createKeyValueStateStore` over a small file-backed store, or `createMemoryStateStore` in tests | `createKeyValueStateStore(AsyncStorage)`             |
| Notes         | `NoteStore` over the capture files                                                              | `NoteStore` over the turn store                      |

The wiring, in pseudo-code:

```ts
const check = checkSyncServerUrl(BUILD_SYNC_URL, {
  allowLocalHttp: isDevBuild,
});
if (!check.ok) return; // no URL: sync is invisible and inert

const keys = deriveVaultKeys(root); // root: generateRootKey(randomBytes), or parsePairing(text)
const request: HttpRequester = async ({ method, path, headers, body }) => {
  const response = await fetchWithTimeout(check.url + path, {
    method,
    headers,
    body,
  });
  return {
    status: response.status,
    body: await response.text(),
    retryAfter: response.headers.get("retry-after"),
  };
};
const engine = await openSyncEngine({
  keys,
  transport: createHttpTransport({ request, vault: keys }),
  notes, // the app's NoteStore
  state: createKeyValueStateStore(AsyncStorage),
  randomBytes,
  now: Date.now,
  isExpired: (note) => isPastRetention(note, retentionDays, Date.now()),
});

// On every local create, edit, refine, rename or pin:
note.hlc = engine.stamp(note.hlc);
// On a user delete (not retention), with the stamp taken when it happened:
await engine.recordDeletes([{ id, hlc, deletedAt: engine.stamp(hlc) }]);
// On launch, on resume, after local changes (debounced) and on a timer:
const report = await engine.sync();
```

## Adapter contract

### `NoteStore`

- **`list()`** returns every note that should sync, as
  `{id, hlc?, createdAtMs, updatedAtMs?}`, without its text. A note the app
  does not sync is left out, such as a failed desktop capture with no
  transcript. A note id must match `[A-Za-z0-9_-]{1,64}`; other notes are
  reported in `report.skippedIds`.
- **`read(id)`** returns `{note: SyncNote, hlc?}`, or undefined.
- **`applyRemote({id, note, hlc, expected})`** is a compare-and-set.
  - It writes `note` with `hlc`, or deletes the note when `note` is null,
    only if the local note still matches `expected`. `localMatches` performs
    that test.
  - It returns false and writes nothing if the local note no longer matches.
    The engine then tries again on the next run.
  - The app must store every field of `note`, including fields it does not
    know, and return them unchanged from `read`.
- **`saveConflictCopy(id, note, hlc)`** saves a new note, the losing side of
  a conflict. It may overwrite an existing copy with the same id.
- **The engine changes notes only through `applyRemote` and
  `saveConflictCopy`.** It never infers a delete from a note's absence.

### Stamps and deletes

- **Stamps.** Every local content or metadata change stores
  `engine.stamp(previousHlc)` with the note. A note without an HLC, such as
  one from before sync was on, gets the later of its `createdAtMs` and
  `updatedAtMs`, but no later than the moment sync started. An edit made
  elsewhere since then therefore wins.
- **Deletes.** An explicit delete calls `recordDeletes`, which writes a
  tombstone. An app that hands a delete to the engine later than the user
  made it passes the HLC it stamped at the time as `deletedAt`, so an edit
  made elsewhere in between still wins.
- **Forgetting the state while the server copy stays** (sync turned off
  with the server copy kept, or the notes cleared on this device only):
  the app reads the deletes not uploaded yet with `pendingDeletesOf(state)`
  first, keeps them with the vault id, and passes them to `recordDeletes` of
  the next engine for that vault. A delete therefore still reaches the other
  devices, and a later rejoin does not bring the note back.
  - Local retention never calls it. A note that expires locally is simply
    no longer listed, and the server copy stays.
  - The engine does not import a note that `isExpired` says this device's
    retention would delete.

### `SyncStateStore`

- `load()`, `save(change)` and `clear()` hold the cursor, the device id, the
  clock, and per-note revisions and fingerprints.
- `createKeyValueStateStore(kv, prefix = "sonolect.sync.")` stores the state
  in 64 buckets plus a meta key. `kv` is AsyncStorage or any store with
  `getItem`, `setItem`, `removeItem` and an optional `multiGet`.
- A damaged bucket triggers a full resync ("repair") instead of an error.

### `SyncTransport`

- `createHttpTransport` covers the HTTP protocol. The app provides only the
  `HttpRequester`, including its timeout.
- A thrown error that is not a `SyncError` becomes `SyncError("network")`.

## Engine behavior

- **Pages and byte caps.** The engine follows `hasMore` and `next`. It saves
  the cursor after each fully applied page, so an interrupted run resumes.
- **Full resync** is a pass from seq 0 that compares every record with the
  local notes. It runs in these cases:

  | Trigger                                                            | Missing remote records                                                              |
  | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
  | No sync for more than 60 days (`stale`)                            | Treated as deleted only after more than 90 days                                     |
  | 410 `cursor_expired` (`expired`)                                   | Deleted locally (their tombstones were purged), unless edited here since; see below |
  | 410 `cursor_reset`, a head below our seq, or a new epoch (`reset`) | Uploaded again                                                                      |
  | 401 (`reset`)                                                      | The engine recreates the vault, then uploads again; the vault id comes from the key |
  | `sync({full: true})` (`requested`)                                 | Uploaded again                                                                      |

- **Tombstones** live 90 days on the server. After that the service purges
  them, and any cursor older than the purge gets 410 `cursor_expired`.
  - An honest server can send `cursor_expired` only to a device that last
    pulled more than 90 days ago. The engine deletes absent notes on it only
    then (with a day of slack for clocks); a device that pulled more
    recently treats it as `reset` and uploads them again, so a server or
    proxy that answers `cursor_expired` and leaves records out cannot delete
    notes on a device.
  - A full pass for any reason but `reset` forgets tombstones the server
    purged instead of uploading them again; `reset` (the server lost data)
    uploads them again, so no device brings a deleted note back.
- **Joining** with `parsePairing(code)` merges the local notes into the
  vault. The first sync uploads them and pulls everything else.
- **Quotas.**
  - A vault holds at most 20,000 notes and 200 MiB. A refused write sets
    `report.quotaExceeded`.
  - Deleting a stored record is never refused, so a full vault can always
    be cleaned up. A delete frees its note's slot and bytes at once. Its
    tombstone (298 bytes) counts in the bytes, and tombstones may take up
    to 20,000 more records, until the service purges them 90 days later.
  - A note too large to seal is listed in `report.tooLarge` and not
    uploaded.

## note/1

`syncNote(fields)` builds a valid note. It leaves out undefined fields and
the optional text fields an app left empty. `extraFields(note)` returns the
fields that note/1 does not define. An app keeps those fields and writes them
back unchanged.

| note/1                   | Desktop (`Capture`, `local_history.rs`)                                  | Mobile (`TranscriptTurn`)                                           |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `id`                     | `id` (today digits and `-`, up to 40; must accept `[A-Za-z0-9_-]{1,64}`) | `id` (`turn_<ms>_<6 base36>`)                                       |
| `createdAt` (ISO 8601)   | `createdAtMs` as ISO                                                     | `createdAt`                                                         |
| `updatedAt?`             | keep (no field yet)                                                      | keep (no field yet)                                                 |
| `rawText`                | `transcript` (a capture without one does not sync)                       | `rawText`                                                           |
| `refinedText?`           | keep                                                                     | `refinedText`; leave out when equal to `rawText`; absent: `rawText` |
| `title?`                 | keep                                                                     | keep                                                                |
| `language?` (BCP 47)     | `language`                                                               | `language`; `"auto"` maps to absent                                 |
| `mode?`                  | keep                                                                     | `mode`; absent means `"dictate"`                                    |
| `durationMs`             | `durationMs`                                                             | `durationMs` (0 when typed)                                         |
| `origin`                 | `"desktop"`                                                              | `"mobile"`                                                          |
| `source?`                | `"microphone"`, `"system"` or `"file"`                                   | `source` (`"microphone"`, `"typed"` or `"remote"`)                  |
| `pinned?`                | keep                                                                     | `pinned`                                                            |
| `segments?`              | `segments` (`startMs`, `endMs`, `text`, `speaker?`, extra keys kept)     | keep                                                                |
| `conflictOf?`            | show as "conflict copy of …"                                             | show as "conflict copy of …"                                        |
| (passthrough)            | everything else, such as `privacyMode`                                   | `privacyMode`, and everything else                                  |
| local only, never synced | `error`, the audio file                                                  | `syncState`                                                         |

- "Keep" means that the app stores the field it received and returns it.
  The app does not have to show it.
- Recordings do not sync in v1, so an app must handle notes that have no
  audio.
- `isPastRetention(note, days, now)` is the shared retention rule. It keeps
  pinned notes and notes whose date cannot be read.

## Errors and what to tell the user

| Error                                                     | Meaning                                                      | UI text and action                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `SyncError` kind `unauthorized` (401/409)                 | The server does not accept this key                          | "This sync key is not accepted by the server." Offer to turn sync off.                            |
| `SyncError` kind `gone`, code `vault_deleted`             | Another device deleted the server copy                       | "This sync was deleted." Call `engine.forget()` and turn sync off. The notes stay on this device. |
| `SyncError` kind `rateLimited`                            | Too many requests                                            | No message. Retry after `error.retryAfterMs`.                                                     |
| `SyncError` kind `tooLarge`                               | The server refused the request size                          | "A note is too large to sync." Notes too large to seal are listed in `report.tooLarge`.           |
| `SyncError` kind `server`                                 | 5xx, or an answer this version does not understand           | "Sync is unavailable right now." Retry later with backoff.                                        |
| `SyncError` kind `network`                                | No answer: offline, DNS, TLS or timeout                      | "Offline. Notes will sync when you're back online." Retry later.                                  |
| `SyncClosedError`                                         | The engine was closed, forgotten or deleted                  | Ignore it.                                                                                        |
| `report.quotaExceeded`                                    | The vault is full (20,000 notes or 200 MiB)                  | "Sync storage is full. Delete notes to sync new ones."                                            |
| `report.newerSchema` > 0                                  | A newer app wrote notes this version cannot read             | "Update Sonolect to sync every note."                                                             |
| `PairingError` code `invalid`                             | Neither a link nor a code                                    | "This is not a Sonolect sync code."                                                               |
| `PairingError` code `version`                             | A link from a newer app                                      | "Update Sonolect to use this code."                                                               |
| `PairingError` codes `key`, `length`, `character`, `typo` | Malformed, the wrong length, an invalid character, or a typo | "Check the code: it has 56 characters." For `typo`: "A character is wrong."                       |

`error.retryable` is true for `network`, `server` and `rateLimited`.
`error.vaultGone` is true for `unauthorized` and `gone`.

## Pairing

Pairing gives another device only the root key. The server URL comes from the
build.

- **Link (QR code)**: `sonolect://sync/join?v=1&k=<base64url root>`.
  - The key is in the query string: Expo Router (SDK 58) passes a native
    deep link's query parameters to the screen and drops its fragment.
  - The parsers also accept the fragment form `#v=1&k=…`.
  - They also accept `sonolect:///sync/join`, any letter case, and unknown
    parameters, which they ignore.
  - `parsePairingParams(useLocalSearchParams())` reads a deep-link screen's
    parameters.
  - `qrMatrix(pairingLink(root))` returns a 37×37 matrix (version 5, ECC M,
    no border). Draw it with a quiet zone of 4 modules.
- **Code**: `pairingCode(root)` is 56 characters of Crockford base32 (the
  root key plus a 3-byte SHA-256 checksum), shown as 14 groups of 4.
  - `parsePairingCode` ignores spaces, dashes, `_` and `.`, and accepts
    lower case.
  - It reads I and L as 1, and O as 0.
- **`parsePairing(text)`** accepts either form.

Every screen that shows or accepts a code says, in one short line, that
joining shares every note with whoever holds the code.

## Threat model

- **The server sees only:** vault ids, the SHA-256 of the bearer token
  (one token per vault, shared by every device in it), record ids,
  revisions, sequence numbers, the vault's epoch, which records are deletes
  (tombstones) and when they were written, record sizes (rounded up to 256
  bytes), timestamps, the apps' user agent, IP addresses and ciphertext.
- **The server never sees:** a key, a note id or a word of a note. The apps
  never send or log the root key, `encKey` or `idKey`, and never log tokens
  or request bodies.
- **A malicious or compromised server can:**
  - withhold, delay or delete records on the server (a device deletes a
    note only for a sealed tombstone, or for a record missing after more
    than 90 days away);
  - replay old records, which the engine refuses per note by HLC;
  - roll the whole vault back, which the engine detects by head, seq and
    epoch, and answers with a full resync;
  - learn the number and approximate sizes of notes, and when devices sync.
- **A malicious server cannot:** read, forge or move a record between notes
  or vaults.
- **Whoever holds the root key** (link, code or QR) has full read and write
  access to the vault.
  - There is no revocation in v1. "Turn off sync and delete the server copy"
    deletes the vault; the remaining devices see "this sync was deleted",
    turn sync off and keep their notes.
  - Erase-all also forgets the key and the sync state, and first offers to
    delete the server copy.
- **Not covered:** a compromised device, and traffic analysis beyond sizes
  and timing.

## HTTP protocol (v1)

`wire.ts` holds the request and answer types, `SYNC_LIMITS`,
`SYNC_ERROR_CODES` and `SYNC_PATHS`. `services/sync-service/README.md`
describes the routes. Every byte string is unpadded base64url.

## Tests

`pnpm --filter @sonolect/sync-core test` runs:

- known-answer vectors for the keys, the record ids and the envelope;
- the pairing formats and the QR matrix;
- the HLC, the state store and the transport error mapping;
- 29 engine scenarios against the in-memory server: two devices, conflicts,
  deletes beating and losing to edits, deletes dated when they were made,
  retention, paging, batching, rollback refusal, a server restored from a
  backup, a wiped server, purged tombstones, a server that answers
  `cursor_expired` and leaves records out, vault deletion, lost answers,
  restarts, interrupted runs and deletes handed to a fresh state.
