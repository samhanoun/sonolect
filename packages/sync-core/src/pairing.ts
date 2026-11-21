import { sha256 } from "@noble/hashes/sha2.js";

import { base64urlDecode, base64urlEncode, concatBytes } from "./encoding";
import { ROOT_KEY_BYTES, assertRootKey } from "./keys";

/**
 * Pairing hands the 32-byte root key to another device, and nothing else:
 * the server URL is fixed at build time. Whoever holds the link or the code
 * can read and change every synced note.
 *
 * - Link (QR code): sonolect://sync/join?v=1&k=<base64url root>. The key is in
 *   the query string because Expo Router (SDK 58) hands a native deep link's
 *   query parameters to the screen and drops its fragment. Parsers also
 *   accept the fragment form (#v=1&k=), which earlier builds of the link
 *   used, and ignore parameters they do not know.
 * - Typed code: Crockford base32 of the root and a 3-byte SHA-256 checksum,
 *   56 characters shown in 14 groups of 4. Spaces, dashes and lower case
 *   are accepted; I and L read as 1, O as 0.
 */
export const PAIRING_LINK_PREFIX = "sonolect://sync/join";
export const PAIRING_VERSION = "1";
export const PAIRING_CODE_LENGTH = 56;

export type PairingErrorCode =
  /** Neither a pairing link nor a code. */
  | "invalid"
  /** A link from a newer app version. */
  | "version"
  /** A link whose key is not 32 bytes. */
  | "key"
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

/** The link for the QR code. */
export function pairingLink(root: Uint8Array): string {
  assertRootKey(root);
  return `${PAIRING_LINK_PREFIX}?v=${PAIRING_VERSION}&k=${base64urlEncode(root)}`;
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

/** Parses "a=1&b=2" (no URLSearchParams: React Native's is incomplete). First value wins. */
function parseParams(text: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of text.split("&")) {
    if (!part) continue;
    const equals = part.indexOf("=");
    const key = decodeComponent(equals < 0 ? part : part.slice(0, equals));
    const value = decodeComponent(equals < 0 ? "" : part.slice(equals + 1));
    if (!params.has(key)) params.set(key, value);
  }
  return params;
}

function keyFromParams(params: {
  get(name: string): string | undefined;
}): Uint8Array {
  const version = params.get("v");
  if (version !== PAIRING_VERSION)
    throw new PairingError(
      "version",
      "This sync link is from a newer version of Sonolect.",
    );
  let root: Uint8Array;
  try {
    root = base64urlDecode((params.get("k") ?? "").trim());
  } catch {
    throw new PairingError("key", "This sync link is damaged.");
  }
  if (root.length !== ROOT_KEY_BYTES)
    throw new PairingError("key", "This sync link is damaged.");
  return root;
}

/**
 * The root key in a pairing link. Accepts the parameters in the fragment or
 * in the query string, and `sonolect:///sync/join` (three slashes) as some
 * link handlers rewrite it.
 */
export function parsePairingLink(text: string): Uint8Array {
  const value = text.trim();
  const match = /^sonolect:\/\/\/?sync\/join\/?(\?[^#]*)?(#.*)?$/i.exec(value);
  if (!match)
    throw new PairingError("invalid", "This is not a Sonolect sync link.");
  const fragment = parseParams((match[2] ?? "").slice(1));
  const query = parseParams((match[1] ?? "").slice(1));
  const source = fragment.has("k") ? fragment : query;
  return keyFromParams({ get: (name) => source.get(name) });
}

/**
 * The root key from a deep-link screen's parameters, such as Expo Router's
 * `useLocalSearchParams()` for sonolect://sync/join?v=1&k=…
 */
export function parsePairingParams(
  params: Record<string, string | readonly string[] | undefined>,
): Uint8Array {
  return keyFromParams({
    get: (name) => {
      const value = params[name];
      return typeof value === "string" ? value : value?.[0];
    },
  });
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

/** A pairing link or a typed code, whichever was pasted or typed. */
export function parsePairing(text: string): Uint8Array {
  return /^\s*sonolect:/i.test(text)
    ? parsePairingLink(text)
    : parsePairingCode(text);
}
