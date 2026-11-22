import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { deflateSync, inflateSync } from "fflate";

import { concatBytes, utf8Decode, utf8Encode } from "./encoding";
import {
  NOTE_ID_PATTERN,
  PROTOCOL,
  type RandomBytes,
  type VaultKeys,
  recordId,
} from "./keys";
import { type NotePayload, parseNotePayload } from "./payload";
import { SYNC_LIMITS } from "./wire";

/**
 * Envelope v1, one per record:
 *
 *   [0x01][flags: bit 0 = deflate][24-byte nonce][XChaCha20-Poly1305 ciphertext + 16-byte tag]
 *
 * AAD = the 2 header bytes ‖ "sonolect-sync/v1\n" + vaultId + "\n" + rid,
 * which binds a record to its vault and its id: a record moved to another id
 * or another vault does not open.
 *
 * Plaintext = u32 BE packed length ‖ u32 BE JSON length ‖ packed JSON ‖ zero
 * padding up to a multiple of 256 bytes, so the server learns only an
 * approximate size. The JSON length bounds decompression.
 */
export const ENVELOPE_VERSION = 1;
const FLAG_DEFLATE = 1;
export const NONCE_BYTES = 24;
const TAG_BYTES = 16;
const HEADER_BYTES = 2;
const LENGTHS_BYTES = 8;
export const PAD_BLOCK = 256;
export const MAX_PLAINTEXT_BYTES: number = SYNC_LIMITS.maxPlaintextBytes;
export const MAX_RECORD_BYTES: number = SYNC_LIMITS.maxRecordBytes;

/** A note too large to sync: its JSON or its sealed record is over the limit. */
export class NoteTooLargeError extends Error {
  readonly bytes: number;
  readonly limit: number;
  constructor(bytes: number, limit: number) {
    super(`note too large to sync (${bytes} bytes, limit ${limit})`);
    this.name = "NoteTooLargeError";
    this.bytes = bytes;
    this.limit = limit;
  }
}

/** A record that does not open: tampered, sealed with another key, moved, or malformed. */
export class RecordUnreadableError extends Error {
  /** True when it opened but names a newer note schema. */
  readonly newerSchema: boolean;
  constructor(message: string, newerSchema = false) {
    super(message);
    this.name = "RecordUnreadableError";
    this.newerSchema = newerSchema;
  }
}

export interface SealedRecord {
  rid: string;
  ct: Uint8Array;
}

export interface SealOptions {
  /** Tests only: compress (default true). */
  deflate?: boolean;
}

/**
 * A short name for one sealed record as base64url: 72 bits of its random
 * nonce (bytes 3 to 11, which are characters 4 to 15). Two uploads of the
 * same note never share it, so a device recognizes its own write coming back
 * without decrypting it, even on a server whose revision numbers went back.
 */
export const sealedTag = (ct: string): string => ct.slice(4, 16);

const aadFor = (vaultId: string, rid: string, header: Uint8Array) =>
  concatBytes(header, utf8Encode(`${PROTOCOL}\n${vaultId}\n${rid}`));

/** Encrypts one note version or tombstone for its record id. */
export function sealRecord(
  keys: VaultKeys,
  payload: NotePayload,
  randomBytes: RandomBytes,
  options: SealOptions = {},
): SealedRecord {
  if (!NOTE_ID_PATTERN.test(payload.id)) throw new Error("invalid note id");
  const rid = recordId(keys, payload.id);
  const json = utf8Encode(JSON.stringify(payload));
  if (json.length > MAX_PLAINTEXT_BYTES)
    throw new NoteTooLargeError(json.length, MAX_PLAINTEXT_BYTES);
  const deflate = options.deflate ?? true;
  const packed = deflate ? deflateSync(json, { level: 6 }) : json;
  const body = new Uint8Array(
    Math.ceil((LENGTHS_BYTES + packed.length) / PAD_BLOCK) * PAD_BLOCK,
  );
  const view = new DataView(body.buffer);
  view.setUint32(0, packed.length);
  view.setUint32(4, json.length);
  body.set(packed, LENGTHS_BYTES);
  const header = Uint8Array.of(ENVELOPE_VERSION, deflate ? FLAG_DEFLATE : 0);
  const nonce = randomBytes(NONCE_BYTES);
  if (!(nonce instanceof Uint8Array) || nonce.length !== NONCE_BYTES)
    throw new Error("randomBytes must return 24 bytes");
  const sealed = concatBytes(
    header,
    nonce,
    xchacha20poly1305(
      keys.encKey,
      nonce,
      aadFor(keys.vaultId, rid, header),
    ).encrypt(body),
  );
  if (sealed.length > MAX_RECORD_BYTES)
    throw new NoteTooLargeError(sealed.length, MAX_RECORD_BYTES);
  return { rid, ct: sealed };
}

/**
 * Decrypts and checks one record. Throws RecordUnreadableError on any
 * tampering, a wrong key, a record moved to another id, or a malformed
 * payload: it fails closed.
 */
export function openRecord(
  keys: VaultKeys,
  rid: string,
  sealed: Uint8Array,
): NotePayload {
  if (
    sealed.length < HEADER_BYTES + NONCE_BYTES + TAG_BYTES ||
    sealed.length > MAX_RECORD_BYTES
  )
    throw new RecordUnreadableError("record has an impossible size");
  if (sealed[0] !== ENVELOPE_VERSION)
    throw new RecordUnreadableError("unknown envelope version");
  const header = sealed.subarray(0, HEADER_BYTES);
  if ((header[1]! & ~FLAG_DEFLATE) !== 0)
    throw new RecordUnreadableError("unknown envelope flags");
  const nonce = sealed.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);
  let body: Uint8Array;
  try {
    body = xchacha20poly1305(
      keys.encKey,
      nonce,
      aadFor(keys.vaultId, rid, header),
    ).decrypt(sealed.subarray(HEADER_BYTES + NONCE_BYTES));
  } catch {
    throw new RecordUnreadableError("record does not decrypt");
  }
  if (body.length < LENGTHS_BYTES)
    throw new RecordUnreadableError("record body is too short");
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const packedLength = view.getUint32(0);
  const jsonLength = view.getUint32(4);
  if (
    packedLength > body.length - LENGTHS_BYTES ||
    jsonLength > MAX_PLAINTEXT_BYTES
  )
    throw new RecordUnreadableError("record lengths are out of range");
  for (let i = LENGTHS_BYTES + packedLength; i < body.length; i += 1)
    if (body[i] !== 0)
      throw new RecordUnreadableError("record padding is not zero");
  const packed = body.subarray(LENGTHS_BYTES, LENGTHS_BYTES + packedLength);
  let json: Uint8Array;
  if (header[1]! & FLAG_DEFLATE) {
    try {
      // The buffer is the declared size, so a crafted stream cannot inflate
      // past the 4 MiB limit.
      json = inflateSync(packed, { out: new Uint8Array(jsonLength) });
    } catch {
      throw new RecordUnreadableError("record does not decompress");
    }
  } else {
    json = packed;
  }
  if (json.length !== jsonLength)
    throw new RecordUnreadableError("record length does not match");
  let payload: NotePayload;
  try {
    payload = parseNotePayload(JSON.parse(utf8Decode(json)));
  } catch (error) {
    const newer =
      typeof error === "object" &&
      error !== null &&
      (error as { newerSchema?: unknown }).newerSchema === true;
    throw new RecordUnreadableError(
      "record payload is not a valid note",
      newer,
    );
  }
  if (recordId(keys, payload.id) !== rid)
    throw new RecordUnreadableError("record does not match its id");
  return payload;
}
