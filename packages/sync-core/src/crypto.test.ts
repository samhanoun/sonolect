import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

import {
  base64urlDecode,
  base64urlEncode,
  concatBytes,
  equalBytes,
  isBase64url,
  utf8Decode,
  utf8Encode,
} from "./encoding";
import {
  MAX_PLAINTEXT_BYTES,
  NoteTooLargeError,
  PAD_BLOCK,
  RecordUnreadableError,
  openRecord,
  sealRecord,
} from "./envelope";
import {
  ROOT_KEY_BYTES,
  deriveVaultKeys,
  generateRootKey,
  isSyncableNoteId,
  recordId,
} from "./keys";
import type { NotePayload } from "./payload";
import { VECTOR_ROOT, newKeys, note, randomBytes } from "./test-helpers";

const NONCE = Uint8Array.from({ length: 24 }, (_, i) => 0xa0 + i);

const vectorPayload: NotePayload = {
  schema: "note/1",
  id: "turn_1732100000000_abc123",
  hlc: { t: 1732100000000, c: 0, d: "devA" },
  deleted: false,
  note: {
    createdAt: "2024-11-20T10:53:20.000Z",
    rawText: "Bonjour, hello",
    durationMs: 1500,
    origin: "mobile",
    language: "fr",
  },
};

const SEALED_VECTOR =
  "AQGgoaKjpKWmp6ipqqusra6vsLGys7S1trdNaN5TgFPRPZqRgylxXa93aE-LKd7z0YZfkyyOd9lpjyLD2lB4O0lzzx6z52Zqw83jqrAPJ_yzEpSVERWLunDHXWzebnE_TK-xWj3Q7odnS-qyhCMN9glOyMEUrYAp6H1l2_Fq3miOVPVqi0ZKloELkhZjGIG6MFmU3jf_GvR4zisH_imi0N9nRRhSI2xsrEDeQtsYut43CvcDA1iAXiId7QrQ5j__Ftgebsz_1IU7ncszVxtCWbaa5XOwKrJjLgr0HrNSEUrkxRfw9DBUcagVt3liBdcFPs6su4cbALbqYUEHTuUnAMjio-r9L6DX9zihNAtdjCnGbdIHwUlFpHSRMA35wwpCM_SBcu3BBFmyOA";

describe("keys", () => {
  it("matches the known-answer vectors checked against an independent Rust implementation", () => {
    const keys = deriveVaultKeys(VECTOR_ROOT);
    assert.equal(keys.vaultId, "epZ1mszKnlFaWC6pFcVmKg");
    assert.equal(keys.authToken, "w0BN5QTQPSVhhHrhH7Mb2bmC7Y6jLTUlQMEkkUZVU7I");
    assert.equal(
      keys.authVerifier,
      "DhRFJSK668FXxtV1MmO4C7XZBb-63hbN0YGGR59NjVQ",
    );
    assert.equal(
      recordId(keys, "1732100000000000000-4242"),
      "LLqxIWmETArnReqgN3pUAdLk",
    );
    const raw = xchacha20poly1305(
      keys.encKey,
      NONCE,
      utf8Encode("aad-v1"),
    ).encrypt(utf8Encode("hello from rust"));
    assert.equal(
      base64urlEncode(raw),
      "JQ2yj-9zt6GgcmJVhh7XZzCTURIFxUGAltdX1X4erA",
    );
  });

  it("seals a record exactly as the format says (fixed nonce)", () => {
    const keys = deriveVaultKeys(VECTOR_ROOT);
    const sealed = sealRecord(keys, vectorPayload, () => NONCE.slice());
    assert.equal(sealed.rid, recordId(keys, vectorPayload.id));
    assert.equal(base64urlEncode(sealed.ct), SEALED_VECTOR);
    assert.equal(sealed.ct.length, 2 + 24 + PAD_BLOCK + 16);
    assert.deepEqual(
      openRecord(keys, sealed.rid, base64urlDecode(SEALED_VECTOR)),
      vectorPayload,
    );
  });

  it("generates random root keys and refuses a broken random source", () => {
    const a = generateRootKey(randomBytes);
    const b = generateRootKey(randomBytes);
    assert.equal(a.length, ROOT_KEY_BYTES);
    assert.ok(!equalBytes(a, b));
    assert.throws(() => generateRootKey((n) => new Uint8Array(n)), /zeros/);
    assert.throws(() => generateRootKey(() => new Uint8Array(16)), /32 bytes/);
    assert.throws(() => deriveVaultKeys(new Uint8Array(31)), /32 bytes/);
  });

  it("gives each vault its own ids and record ids", () => {
    const one = newKeys();
    const two = newKeys();
    assert.notEqual(one.vaultId, two.vaultId);
    assert.match(one.vaultId, /^[A-Za-z0-9_-]{22}$/);
    assert.notEqual(recordId(one, "note-1"), recordId(two, "note-1"));
    assert.match(recordId(one, "note-1"), /^[A-Za-z0-9_-]{24}$/);
  });

  it("accepts the note ids of both apps", () => {
    for (const id of [
      "1732100000000000000-4242",
      "turn_1732100000000_a1b2c3",
      "x",
    ])
      assert.ok(isSyncableNoteId(id));
    for (const id of ["", "a/b", "../x", "a".repeat(65), "note 1", 42])
      assert.ok(!isSyncableNoteId(id));
  });
});

describe("envelope", () => {
  const keys = newKeys();
  const payload: NotePayload = {
    schema: "note/1",
    id: "turn_1_abcdef",
    hlc: { t: 1, c: 0, d: "dev" },
    deleted: false,
    note: note("A secret thought"),
  };
  /** An uncompressed plaintext body, built by hand. */
  const plainBody = (value: NotePayload) => {
    const json = utf8Encode(JSON.stringify(value));
    const body = new Uint8Array(
      Math.ceil((8 + json.length) / PAD_BLOCK) * PAD_BLOCK,
    );
    const view = new DataView(body.buffer);
    view.setUint32(0, json.length);
    view.setUint32(4, json.length);
    body.set(json, 8);
    return body;
  };
  /** Encrypts a body for `rid` exactly as sealRecord does, without its checks. */
  const sealBody = (body: Uint8Array, flags: number, rid: string) => {
    const header = Uint8Array.of(1, flags);
    const nonce = randomBytes(24);
    const aad = concatBytes(
      header,
      utf8Encode(`sonolect-sync/v1\n${keys.vaultId}\n${rid}`),
    );
    return concatBytes(
      header,
      nonce,
      xchacha20poly1305(keys.encKey, nonce, aad).encrypt(body),
    );
  };

  it("round-trips a note and a tombstone", () => {
    const sealed = sealRecord(keys, payload, randomBytes);
    assert.deepEqual(openRecord(keys, sealed.rid, sealed.ct), payload);
    const tombstone: NotePayload = { ...payload, deleted: true };
    delete tombstone.note;
    const sealedTombstone = sealRecord(keys, tombstone, randomBytes);
    assert.deepEqual(
      openRecord(keys, sealedTombstone.rid, sealedTombstone.ct),
      tombstone,
    );
  });

  it("never shows the text or the note id in the record", () => {
    const sealed = sealRecord(keys, payload, randomBytes, { deflate: false });
    const visible =
      new TextDecoder("latin1").decode(sealed.ct) + base64urlEncode(sealed.ct);
    assert.ok(!visible.includes("secret"));
    assert.ok(!visible.includes("turn_1"));
    assert.ok(!sealed.rid.includes("turn"));
  });

  it("fails closed on any change to the record", () => {
    const sealed = sealRecord(keys, payload, randomBytes);
    for (const index of [
      0,
      1,
      2,
      30,
      sealed.ct.length - 20,
      sealed.ct.length - 1,
    ]) {
      const tampered = sealed.ct.slice();
      tampered[index]! ^= 1;
      assert.throws(
        () => openRecord(keys, sealed.rid, tampered),
        RecordUnreadableError,
      );
    }
    assert.throws(
      () =>
        openRecord(
          keys,
          sealed.rid,
          sealed.ct.subarray(0, sealed.ct.length - 1),
        ),
      RecordUnreadableError,
    );
    assert.throws(
      () =>
        openRecord(keys, sealed.rid, concatBytes(sealed.ct, Uint8Array.of(0))),
      RecordUnreadableError,
    );
    assert.throws(
      () => openRecord(keys, sealed.rid, new Uint8Array(10)),
      RecordUnreadableError,
    );
  });

  it("refuses a record moved to another id or another vault, and a wrong key", () => {
    const sealed = sealRecord(keys, payload, randomBytes);
    const otherRid = recordId(keys, "another-note");
    assert.throws(
      () => openRecord(keys, otherRid, sealed.ct),
      RecordUnreadableError,
    );
    const otherVault = newKeys();
    assert.throws(
      () => openRecord(otherVault, sealed.rid, sealed.ct),
      RecordUnreadableError,
    );
    // Same encryption key, other vault id: the AAD still binds the vault.
    const sameKeyOtherVault = { ...keys, vaultId: otherVault.vaultId };
    assert.throws(
      () => openRecord(sameKeyOtherVault, sealed.rid, sealed.ct),
      RecordUnreadableError,
    );
  });

  it("refuses a valid ciphertext whose payload names another note", () => {
    // Sealed for rid(A), but the payload inside claims to be note B.
    const ridA = recordId(keys, "note-a");
    const forged = sealBody(plainBody({ ...payload, id: "note-b" }), 0, ridA);
    assert.throws(
      () => openRecord(keys, ridA, forged),
      /does not match its id/,
    );
  });

  it("pads to 256-byte buckets", () => {
    const sizes = new Set<number>();
    for (const length of [0, 10, 100, 200]) {
      const sealed = sealRecord(
        keys,
        { ...payload, note: note("x".repeat(length)) },
        randomBytes,
        { deflate: false },
      );
      assert.equal((sealed.ct.length - 2 - 24 - 16) % PAD_BLOCK, 0);
      sizes.add(sealed.ct.length);
    }
    assert.ok(sizes.size <= 2);
  });

  it("compresses long transcripts and enforces both size caps", () => {
    const long = { ...payload, note: note("word ".repeat(150_000)) };
    const sealed = sealRecord(keys, long, randomBytes);
    assert.ok(sealed.ct.length < 100_000);
    assert.deepEqual(openRecord(keys, sealed.rid, sealed.ct), long);
    assert.throws(
      () =>
        sealRecord(
          keys,
          { ...payload, note: note("x".repeat(MAX_PLAINTEXT_BYTES)) },
          randomBytes,
        ),
      NoteTooLargeError,
    );
    // Random text barely compresses: over the sealed cap.
    const noisy = base64urlEncode(randomBytes(900 * 1024));
    assert.throws(
      () => sealRecord(keys, { ...payload, note: note(noisy) }, randomBytes),
      NoteTooLargeError,
    );
  });

  it("flags a payload from a newer schema", () => {
    const newer = { ...payload, schema: "note/2" } as unknown as NotePayload;
    const sealed = sealRecord(keys, newer, randomBytes);
    assert.throws(
      () => openRecord(keys, sealed.rid, sealed.ct),
      (error: unknown) =>
        error instanceof RecordUnreadableError && error.newerSchema,
    );
  });

  it("rejects non-zero padding and a declared length that does not match", () => {
    const rid = recordId(keys, payload.id);
    const body = plainBody(payload);
    assert.deepEqual(openRecord(keys, rid, sealBody(body, 0, rid)), payload);
    const dirty = body.slice();
    dirty[dirty.length - 1] = 7;
    assert.throws(
      () => openRecord(keys, rid, sealBody(dirty, 0, rid)),
      /padding/,
    );
    const lying = body.slice();
    new DataView(lying.buffer).setUint32(4, lying.length);
    assert.throws(
      () => openRecord(keys, rid, sealBody(lying, 0, rid)),
      /length/,
    );
    const huge = body.slice();
    new DataView(huge.buffer).setUint32(4, 64 * 1024 * 1024);
    assert.throws(() => openRecord(keys, rid, sealBody(huge, 1, rid)), /range/);
  });
});

describe("encoding", () => {
  it("round-trips UTF-8, including astral characters", () => {
    for (const text of [
      "",
      "plain",
      "é à ü",
      "日本語",
      "emoji 🎙️👩‍💻",
      "\u0000",
    ]) {
      assert.deepEqual(utf8Encode(text), new TextEncoder().encode(text));
      assert.equal(utf8Decode(utf8Encode(text)), text);
    }
    assert.deepEqual(utf8Encode("\ud800"), new TextEncoder().encode("\ud800"));
  });

  it("rejects malformed UTF-8", () => {
    for (const bytes of [
      [0xc0, 0x80],
      [0xe0, 0x80, 0x80],
      [0xed, 0xa0, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
      [0xe2, 0x82],
      [0x80],
    ])
      assert.throws(() => utf8Decode(Uint8Array.from(bytes)), /UTF-8/);
  });

  it("encodes base64url canonically and decodes strictly", () => {
    for (let length = 0; length < 40; length += 1) {
      const bytes = randomBytes(length);
      const text = base64urlEncode(bytes);
      assert.equal(text, Buffer.from(bytes).toString("base64url"));
      assert.deepEqual(base64urlDecode(text), bytes);
    }
    assert.ok(isBase64url("AQID"));
    assert.ok(!isBase64url("AQID="));
    assert.ok(!isBase64url("A"));
    assert.ok(!isBase64url("AQ+/"));
    assert.ok(!isBase64url("AR")); // non-zero trailing bits
  });
});
