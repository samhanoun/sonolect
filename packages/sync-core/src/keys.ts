import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { base64urlEncode, utf8Encode } from "./encoding";

/** Domain separation for every key, AAD and HKDF salt of protocol v1. */
export const PROTOCOL = "sonolect-sync/v1";
export const ROOT_KEY_BYTES = 32;

/** Returns `length` cryptographically secure random bytes. */
export type RandomBytes = (length: number) => Uint8Array;

/**
 * Everything derived from the 32-byte root key (HKDF-SHA256, salt PROTOCOL).
 * Only vaultId, authToken and authVerifier ever reach the server.
 */
export interface VaultKeys {
  /** Public, opaque: names the vault on the server. 16 bytes, 22 characters. */
  readonly vaultId: string;
  /** Bearer secret for the vault routes. The server stores only its SHA-256. */
  readonly authToken: string;
  /** base64url(SHA-256(authToken bytes)): sent once, when the vault is created. */
  readonly authVerifier: string;
  /** XChaCha20-Poly1305 key. Never leaves the device. */
  readonly encKey: Uint8Array;
  /** HMAC key that turns note ids (which embed timestamps) into record ids. */
  readonly idKey: Uint8Array;
}

/** Note ids that can sync: the shared id alphabet of both apps. */
export const NOTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const isSyncableNoteId = (id: unknown): id is string =>
  typeof id === "string" && NOTE_ID_PATTERN.test(id);

/**
 * A new root key. Refuses an all-zero result, which is what a missing or
 * stubbed random source tends to return.
 */
export function generateRootKey(randomBytes: RandomBytes): Uint8Array {
  const root = randomBytes(ROOT_KEY_BYTES);
  if (!(root instanceof Uint8Array) || root.length !== ROOT_KEY_BYTES)
    throw new Error("randomBytes must return 32 bytes");
  if (root.every((byte) => byte === 0))
    throw new Error("randomBytes returned only zeros");
  return root.slice();
}

export function assertRootKey(root: Uint8Array): void {
  if (!(root instanceof Uint8Array) || root.length !== ROOT_KEY_BYTES)
    throw new Error("the sync key must be 32 bytes");
}

export function deriveVaultKeys(root: Uint8Array): VaultKeys {
  assertRootKey(root);
  const salt = utf8Encode(PROTOCOL);
  const derive = (info: string, length: number) =>
    hkdf(sha256, root, salt, utf8Encode(info), length);
  const auth = derive("auth", 32);
  return {
    vaultId: base64urlEncode(derive("vault-id", 16)),
    authToken: base64urlEncode(auth),
    authVerifier: base64urlEncode(sha256(auth)),
    encKey: derive("enc", 32),
    idKey: derive("record-id", 32),
  };
}

/** The server-side name of a note: base64url(HMAC-SHA256(idKey, "note\n" + id)[0..18]). */
export function recordId(
  keys: Pick<VaultKeys, "idKey">,
  noteId: string,
): string {
  return base64urlEncode(
    hmac(sha256, keys.idKey, utf8Encode(`note\n${noteId}`)).subarray(0, 18),
  );
}
