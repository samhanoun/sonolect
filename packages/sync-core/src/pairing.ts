import { sha256 } from "@noble/hashes/sha2.js";

import { concatBytes } from "./encoding";
import { ROOT_KEY_BYTES, assertRootKey } from "./keys";

/**
 * Pairing hands the 32-byte root key to another device, and nothing else:
 * the server URL is fixed at build time. Whoever holds the code can read and
 * change every synced note.
 *
 * - Typed code: Crockford base32 of the root and a 3-byte SHA-256 checksum,
 *   56 characters shown in 14 groups of 4. Spaces, dashes and lower case
 *   are accepted; I and L read as 1, O as 0.
 * - QR code: "SONOLECT SYNC 1 " and the typed code, such as
 *   "SONOLECT SYNC 1 000G-40R4-…-63ED". It is plain text, not a link: no
 *   app can register to open it, so the phone never hands the key to
 *   another app. Sonolect's own scanner reads it (Settings, Sync, Scan
 *   code). Its letters, digits, spaces and dashes fit the QR alphanumeric
 *   mode.
 */
export const PAIRING_PAYLOAD_PREFIX = "SONOLECT SYNC";
export const PAIRING_VERSION = "1";
export const PAIRING_CODE_LENGTH = 56;

export type PairingErrorCode =
  /** Not a sync code: a link, or other text. */
  | "invalid"
  /** A QR code from a newer app version. */
  | "version"
  /** A code with the wrong number of characters. */
  | "length"
  /** A code with a character outside the code alphabet. */
  | "character"
  /** A code whose checksum does not match: a typo. */
  | "typo";

export class PairingError extends Error {
  readonly code: PairingErrorCode;
  constructor(code: PairingErrorCode, message: string) {
    super(message);
    this.name = "PairingError";
    this.code = code;
  }
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function checksum(root: Uint8Array): Uint8Array {
  return sha256(root).subarray(0, 3);
}

/** The typed code as 14 groups of 4 characters. */
export function pairingCodeGroups(root: Uint8Array): string[] {
  assertRootKey(root);
  const data = concatBytes(root, checksum(root));
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = ((value << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(value >> bits) & 31]!;
    }
  }
  const groups: string[] = [];
  for (let i = 0; i < out.length; i += 4) groups.push(out.slice(i, i + 4));
  return groups;
}

/** The typed code: 56 characters in groups of 4, joined by dashes. */
export function pairingCode(root: Uint8Array): string {
  return pairingCodeGroups(root).join("-");
}

/** The root key in a typed code. Throws PairingError ("length", "character", "typo"). */
export function parsePairingCode(text: string): Uint8Array {
  const clean = text
    .replace(/[\s\-‐‑‒–—_.]/g, "")
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (clean.length !== PAIRING_CODE_LENGTH)
    throw new PairingError(
      "length",
      `A sync code has ${PAIRING_CODE_LENGTH} characters; this one has ${clean.length}.`,
    );
  const data = new Uint8Array(ROOT_KEY_BYTES + 3);
  let bits = 0;
  let value = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const index = CROCKFORD.indexOf(clean[i]!);
    if (index < 0)
      throw new PairingError(
        "character",
        `"${clean[i]}" is not a character of a sync code.`,
      );
    value = ((value << 5) | index) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      data[o++] = (value >> bits) & 255;
    }
  }
  const root = data.slice(0, ROOT_KEY_BYTES);
  const expected = checksum(root);
  if (expected.some((byte, i) => byte !== data[ROOT_KEY_BYTES + i]))
    throw new PairingError(
      "typo",
      "This sync code has a typo. Check it and try again.",
    );
  return root;
}

/** The text of the QR code: the prefix, the version and the typed code. */
export function pairingPayload(root: Uint8Array): string {
  return `${PAIRING_PAYLOAD_PREFIX} ${PAIRING_VERSION} ${pairingCode(root)}`;
}

/** "SONOLECT SYNC <version> <code>", in any letter case and spacing. */
const PAYLOAD = /^SONOLECT\s+SYNC(?:\s+(\S+)\s+(\S[\s\S]*))?$/i;
/** A link or a URI ("scheme:"), which is never a code. */
const LINK = /^[a-z][a-z0-9+.-]*:|:\/\//i;

/**
 * The root key in a scanned QR code or in a typed or pasted code. The only
 * parser the apps use. Throws PairingError: "invalid" for a link or URI
 * (such as sonolect://…) and for "SONOLECT SYNC" without a code, "version"
 * for a QR code from a newer app, and the codes of parsePairingCode for the
 * code itself.
 */
export function parsePairing(text: string): Uint8Array {
  const value = text.trim();
  if (/^SONOLECT\s*SYNC\b/i.test(value)) {
    const match = PAYLOAD.exec(value);
    if (!match?.[1] || !match[2])
      throw new PairingError("invalid", "This is not a Sonolect sync code.");
    if (match[1] !== PAIRING_VERSION)
      throw /^\d+$/.test(match[1])
        ? new PairingError(
            "version",
            "This sync code is from a newer version of Sonolect.",
          )
        : new PairingError("invalid", "This is not a Sonolect sync code.");
    return parsePairingCode(match[2]);
  }
  if (LINK.test(value))
    throw new PairingError("invalid", "This is not a Sonolect sync code.");
  return parsePairingCode(value);
}
