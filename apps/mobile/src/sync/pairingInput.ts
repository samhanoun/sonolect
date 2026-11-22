import { PairingError, parsePairing } from "@sonolect/sync-core";

/**
 * Reading a sync code: typed or pasted in Settings, or read from a QR code
 * by Sonolect's own scanner (Settings, Sync, Scan code). Both go through
 * sync-core's parsePairing, which takes only the code and refuses links:
 * no screen reads a key from a URL. The server comes from the build.
 */

/** A code typed or pasted in Settings. */
export type TypedCode =
  /** Ask first, then join. */
  | { kind: "confirm"; root: Uint8Array }
  /** Not a usable code: say why (messages.ts pairingErrorText). */
  | { kind: "invalid"; error: unknown };

/** The 56 characters typed or pasted, or the text of a QR code. */
export function readTypedCode(text: string): TypedCode {
  try {
    return { kind: "confirm", root: parsePairing(text) };
  } catch (error) {
    return { kind: "invalid", error };
  }
}

/** What the scanner does with a QR code it read. */
export type ScannedCode =
  /** A sync code: close the camera, then ask before joining. */
  | { kind: "confirm"; root: Uint8Array }
  /** A Sonolect sync code from a newer app: say so, keep scanning. */
  | { kind: "newer" }
  /** Any other QR code: say it is not a Sonolect code, keep scanning. */
  | { kind: "other" };

/** The scanner's answer for the text of one QR code. */
export function readScannedCode(data: string): ScannedCode {
  try {
    return { kind: "confirm", root: parsePairing(data) };
  } catch (error) {
    return error instanceof PairingError && error.code === "version"
      ? { kind: "newer" }
      : { kind: "other" };
  }
}
