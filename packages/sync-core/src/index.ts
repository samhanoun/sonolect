/**
 * @sonolect/sync-core: end-to-end encrypted note sync for the Sonolect apps.
 * See README.md for the API, the app adapter contract and the threat model.
 */
export {
  base64urlDecode,
  base64urlEncode,
  equalBytes,
  isBase64url,
  utf8Decode,
  utf8Encode,
} from "./encoding";
export {
  ENVELOPE_VERSION,
  MAX_PLAINTEXT_BYTES,
  MAX_RECORD_BYTES,
  NoteTooLargeError,
  RecordUnreadableError,
  type SealedRecord,
  openRecord,
  sealRecord,
} from "./envelope";
export {
  type LocalExpectation,
  type LocalNote,
  type LocalNoteSummary,
  type NoteStore,
  READER_VERSION,
  type RemoteChange,
  type SyncEngine,
  type SyncEngineOptions,
  type SyncReport,
  type SyncStatus,
  localMatches,
  openSyncEngine,
} from "./engine";
export {
  SyncClosedError,
  SyncError,
  type SyncErrorKind,
  type SyncErrorOptions,
  isSyncError,
} from "./errors";
export {
  HLC_MAX_FUTURE_MS,
  type Hlc,
  HlcClock,
  compareHlc,
  hlcEquals,
  isHlc,
  toHlc,
} from "./hlc";
export {
  NOTE_ID_PATTERN,
  PROTOCOL,
  ROOT_KEY_BYTES,
  type RandomBytes,
  type VaultKeys,
  assertRootKey,
  deriveVaultKeys,
  generateRootKey,
  isSyncableNoteId,
  recordId,
} from "./keys";
export {
  PAIRING_CODE_LENGTH,
  PAIRING_LINK_PREFIX,
  PAIRING_VERSION,
  PairingError,
  type PairingErrorCode,
  pairingCode,
  pairingCodeGroups,
  pairingLink,
  parsePairing,
  parsePairingCode,
  parsePairingLink,
  parsePairingParams,
} from "./pairing";
export {
  InvalidPayloadError,
  NOTE_FIELDS,
  NOTE_SCHEMA,
  type NotePayload,
  type SyncNote,
  type SyncNoteInput,
  type SyncSegment,
  conflictCopyId,
  extraFields,
  isPastRetention,
  noteFingerprint,
  parseNotePayload,
  parseSyncNote,
  syncNote,
} from "./payload";
export { type QrMatrix, qrMatrix } from "./qr";
export {
  LOCAL_HTTP_HOSTS,
  type SyncServerUrlResult,
  checkSyncServerUrl,
} from "./server-url";
export {
  type FullResyncReason,
  type KeyValueStorage,
  type PendingFullResync,
  type RecordState,
  type SyncMeta,
  type SyncStateChange,
  type SyncStateSnapshot,
  type SyncStateStore,
  createKeyValueStateStore,
  createMemoryStateStore,
} from "./state";
export {
  type HttpRequest,
  type HttpRequester,
  type HttpResponse,
  type HttpTransportOptions,
  type SyncTransport,
  createHttpTransport,
  errorForResponse,
  parseRetryAfter,
} from "./transport";
export * from "./wire";
