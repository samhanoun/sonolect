/**
 * UTF-8 and base64url written out by hand. Hermes has no Buffer and no atob,
 * and its TextDecoder support varies by React Native version, so sync-core
 * relies on none of them.
 */

/** Encodes a string as UTF-8. Lone surrogates become U+FFFD, as TextEncoder does. */
export function utf8Encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 3);
  let o = 0;
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) {
      out[o++] = code;
    } else if (code < 0x800) {
      out[o++] = 0xc0 | (code >> 6);
      out[o++] = 0x80 | (code & 63);
    } else if (code < 0x10000) {
      out[o++] = 0xe0 | (code >> 12);
      out[o++] = 0x80 | ((code >> 6) & 63);
      out[o++] = 0x80 | (code & 63);
    } else {
      out[o++] = 0xf0 | (code >> 18);
      out[o++] = 0x80 | ((code >> 12) & 63);
      out[o++] = 0x80 | ((code >> 6) & 63);
      out[o++] = 0x80 | (code & 63);
    }
  }
  return out.slice(0, o);
}

/**
 * Decodes UTF-8 strictly: overlong forms, surrogates, values past U+10FFFF and
 * truncated sequences throw, so malformed input never becomes text.
 */
export function utf8Decode(bytes: Uint8Array): string {
  const parts: string[] = [];
  let units: number[] = [];
  const flush = () => {
    parts.push(String.fromCharCode.apply(null, units));
    units = [];
  };
  let i = 0;
  while (i < bytes.length) {
    const first = bytes[i]!;
    let code: number;
    let extra: number;
    if (first < 0x80) {
      code = first;
      extra = 0;
    } else if (first >= 0xc2 && first <= 0xdf) {
      code = first & 31;
      extra = 1;
    } else if (first >= 0xe0 && first <= 0xef) {
      code = first & 15;
      extra = 2;
    } else if (first >= 0xf0 && first <= 0xf4) {
      code = first & 7;
      extra = 3;
    } else {
      throw new Error("invalid UTF-8");
    }
    for (let j = 1; j <= extra; j += 1) {
      const next = bytes[i + j];
      if (next === undefined || (next & 0xc0) !== 0x80)
        throw new Error("invalid UTF-8");
      code = (code << 6) | (next & 63);
    }
    if (
      (extra === 2 && (code < 0x800 || (code >= 0xd800 && code <= 0xdfff))) ||
      (extra === 3 && (code < 0x10000 || code > 0x10ffff))
    )
      throw new Error("invalid UTF-8");
    i += extra + 1;
    if (code >= 0x10000) {
      code -= 0x10000;
      units.push(0xd800 + (code >> 10), 0xdc00 + (code & 1023));
    } else {
      units.push(code);
    }
    if (units.length >= 8192) flush();
  }
  flush();
  return parts.join("");
}

const B64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64URL_LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < B64URL.length; i += 1)
  B64URL_LOOKUP[B64URL.charCodeAt(i)] = i;

/** base64url without padding (RFC 4648 §5). */
export function base64urlEncode(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    chunk += B64URL[b0 >> 2]!;
    chunk += B64URL[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 !== undefined) chunk += B64URL[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]!;
    if (b2 !== undefined) chunk += B64URL[b2 & 63]!;
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = "";
    }
  }
  parts.push(chunk);
  return parts.join("");
}

/** True when `text` is canonical unpadded base64url. */
export function isBase64url(text: string): boolean {
  try {
    base64urlDecode(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decodes unpadded base64url strictly: any other character, an impossible
 * length or non-zero trailing bits throw.
 */
export function base64urlDecode(text: string): Uint8Array {
  const remainder = text.length % 4;
  if (remainder === 1) throw new Error("invalid base64url length");
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? B64URL_LOOKUP[code]! : -1;
    if (value < 0) throw new Error("invalid base64url character");
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 255;
    }
  }
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0)
    throw new Error("non-canonical base64url");
  return out;
}

/** Concatenates byte arrays. */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const array of arrays) length += array.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const array of arrays) {
    out.set(array, offset);
    offset += array.length;
  }
  return out;
}

/** Compares two byte arrays in time that depends only on their length. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
