import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  audioMimeType,
  CapturePlayback,
  playbackFormat,
  type CaptureAudioFormat,
  type PlaybackMedia,
} from "./capturePlayback";

const bytes = (text: string) =>
  Uint8Array.from(text, (char) => char.charCodeAt(0)).buffer;
const OGG = bytes("OggS\0\x02\0\0\0\0\0\0\0\0");
const WAV = bytes("RIFF\x24\0\0\0WAVEfmt ");
const noop = () => {};
/** Lets every pending promise move on. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** An audio element that plays at once, or fails as a browser does. */
class FakeMedia implements PlaybackMedia {
  currentTime = 0;
  error: { code: number } | null = null;
  pauses = 0;
  /** play() is refused for a reason other than the audio, as autoplay rules do. */
  refuse = false;
  readonly played: { type: string; atMs: number }[] = [];
  private source = "";

  constructor(
    private readonly blobs: Map<string, Blob>,
    private readonly opus: string,
    private readonly unplayable: string[],
  ) {}

  get src() {
    return this.source;
  }
  /** A new source starts again from the beginning, without an error. */
  set src(url: string) {
    this.source = url;
    this.error = null;
    this.currentTime = 0;
  }
  canPlayType(type: string) {
    return type === 'audio/ogg; codecs="opus"' ? this.opus : "";
  }
  async play() {
    if (this.refuse)
      throw new DOMException("The user has not interacted.", "NotAllowedError");
    const type = this.blobs.get(this.source)?.type ?? "";
    if (this.unplayable.includes(type)) {
      this.error = { code: 4 };
      throw new DOMException(
        "Failed to load because no supported source was found.",
        "NotSupportedError",
      );
    }
    this.played.push({ type, atMs: Math.round(this.currentTime * 1000) });
  }
  pause() {
    this.pauses += 1;
  }
}

/**
 * A player whose recordings are kept as `kept` says. With `held`, each read
 * waits until the test answers it.
 */
function harness({
  kept = {},
  opus = "probably",
  unplayable = [],
  held = false,
}: {
  kept?: Record<string, "opus" | "wav">;
  opus?: string;
  unplayable?: string[];
  held?: boolean;
} = {}) {
  const blobs = new Map<string, Blob>();
  const revoked: string[] = [];
  const reads: { id: string; format: CaptureAudioFormat }[] = [];
  const waiting: { answer: () => void; fail: (error: Error) => void }[] = [];
  let failure: Error | undefined;
  const media = new FakeMedia(blobs, opus, unplayable);
  const playback = new CapturePlayback(media, {
    read: (id, format) => {
      reads.push({ id, format });
      const audio = kept[id] === "opus" && format === "ogg" ? OGG : WAV;
      if (failure) {
        const error = failure;
        failure = undefined;
        return Promise.reject(error);
      }
      if (!held) return Promise.resolve(audio);
      return new Promise((resolve, reject) =>
        waiting.push({ answer: () => resolve(audio), fail: reject }),
      );
    },
    createUrl: (blob) => {
      const url = `blob:${blobs.size + 1}`;
      blobs.set(url, blob);
      return url;
    },
    revokeUrl: (url) => revoked.push(url),
  });
  return {
    media,
    playback,
    reads,
    revoked,
    blobs,
    /** Answers the read made in this order, counted from 0. */
    answer: (read: number) => waiting[read]!.answer(),
    fail: (read: number, error: Error) => waiting[read]!.fail(error),
    failNextRead: (error: Error) => (failure = error),
    playing: () => blobs.get(media.src)?.type,
  };
}

describe("capture playback format", () => {
  it("asks for Ogg Opus when the webview may play it, and WAV otherwise", () => {
    const asked: string[] = [];
    const media = (answer: string) => ({
      canPlayType: (type: string) => {
        asked.push(type);
        return answer;
      },
    });
    assert.equal(playbackFormat(media("probably")), "ogg");
    assert.equal(playbackFormat(media("maybe")), "ogg");
    assert.equal(playbackFormat(media("")), "wav");
    assert.deepEqual(new Set(asked), new Set(['audio/ogg; codecs="opus"']));
  });

  it("takes the audio type from the first bytes", () => {
    assert.equal(audioMimeType(OGG), "audio/ogg");
    assert.equal(audioMimeType(WAV), "audio/wav");
    assert.equal(audioMimeType(bytes("OggS")), "audio/ogg");
    assert.equal(audioMimeType(bytes("ID3\x04\0")), "");
    assert.equal(audioMimeType(bytes("Ogg")), "");
    assert.equal(audioMimeType(bytes(" OggS")), "");
    assert.equal(audioMimeType(new ArrayBuffer(0)), "");
  });
});

describe("capture playback", () => {
  it("plays a compressed recording from its Opus file", async () => {
    const player = harness({ kept: { "1-1": "opus" } });
    const started: number[] = [];
    assert.equal(
      await player.playback.play("1-1", 1500, () =>
        started.push(player.media.currentTime),
      ),
      true,
    );
    assert.deepEqual(player.reads, [{ id: "1-1", format: "ogg" }]);
    assert.deepEqual(player.media.played, [{ type: "audio/ogg", atMs: 1500 }]);
    // Once the position is set, before playing.
    assert.deepEqual(started, [1.5]);
  });

  it("plays a recording kept as WAV as WAV, whatever was asked", async () => {
    const player = harness({ kept: { "1-1": "wav" } });
    assert.equal(await player.playback.play("1-1", 0, noop), true);
    assert.deepEqual(player.reads, [{ id: "1-1", format: "ogg" }]);
    assert.deepEqual(player.media.played, [{ type: "audio/wav", atMs: 0 }]);
  });

  it("asks for WAV when the webview cannot play Opus", async () => {
    const player = harness({ kept: { "1-1": "opus" }, opus: "" });
    assert.equal(await player.playback.play("1-1", 0, noop), true);
    assert.deepEqual(player.reads, [{ id: "1-1", format: "wav" }]);
    assert.equal(player.playing(), "audio/wav");
  });

  it("reads a recording again as WAV, once, when its Opus file cannot be played", async () => {
    const player = harness({
      kept: { "1-1": "opus" },
      unplayable: ["audio/ogg"],
    });
    let started = 0;
    assert.equal(
      await player.playback.play("1-1", 2000, () => (started += 1)),
      true,
    );
    assert.deepEqual(player.reads, [
      { id: "1-1", format: "ogg" },
      { id: "1-1", format: "wav" },
    ]);
    assert.deepEqual(player.media.played, [{ type: "audio/wav", atMs: 2000 }]);
    assert.equal(started, 1);
    // The Opus copy is let go; the WAV is kept for the next play.
    assert.deepEqual(player.revoked, ["blob:1"]);
    assert.equal(await player.playback.play("1-1", 0, noop), true);
    assert.equal(player.reads.length, 2);
    assert.deepEqual(
      player.media.played.map((play) => play.type),
      ["audio/wav", "audio/wav"],
    );
  });

  it("reports the error when the WAV cannot be played either", async () => {
    const player = harness({
      kept: { "1-1": "opus" },
      unplayable: ["audio/ogg", "audio/wav"],
    });
    await assert.rejects(player.playback.play("1-1", 0, noop), {
      name: "NotSupportedError",
    });
    assert.deepEqual(
      player.reads.map((read) => read.format),
      ["ogg", "wav"],
    );
    assert.deepEqual(player.media.played, []);
  });

  it("does not ask again for a recording that came as WAV", async () => {
    const player = harness({
      kept: { "1-1": "wav" },
      unplayable: ["audio/wav"],
    });
    await assert.rejects(player.playback.play("1-1", 0, noop), {
      name: "NotSupportedError",
    });
    assert.deepEqual(player.reads, [{ id: "1-1", format: "ogg" }]);
  });

  it("does not read again when playing is refused for another reason", async () => {
    const player = harness({ kept: { "1-1": "opus" } });
    player.media.refuse = true;
    await assert.rejects(player.playback.play("1-1", 0, noop), {
      name: "NotAllowedError",
    });
    assert.deepEqual(player.reads, [{ id: "1-1", format: "ogg" }]);
    assert.equal(player.playing(), "audio/ogg");
  });

  it("reads each recording once and lets go of the one before", async () => {
    const player = harness({ kept: { "1-1": "opus", "1-2": "wav" } });
    await player.playback.play("1-1", 0, noop);
    await player.playback.play("1-1", 500, noop);
    assert.equal(player.reads.length, 1);
    assert.equal(player.media.pauses, 1);
    await player.playback.play("1-2", 0, noop);
    assert.deepEqual(
      player.reads.map((read) => read.id),
      ["1-1", "1-2"],
    );
    // What was playing stops before the next recording is read.
    assert.equal(player.media.pauses, 2);
    assert.deepEqual(player.revoked, ["blob:1"]);
    assert.deepEqual(player.media.played, [
      { type: "audio/ogg", atMs: 0 },
      { type: "audio/ogg", atMs: 500 },
      { type: "audio/wav", atMs: 0 },
    ]);
  });

  it("lets a newer click on the same recording win", async () => {
    const player = harness({ kept: { "1-1": "opus" } });
    await player.playback.play("1-1", 0, noop);
    const first = player.playback.play("1-1", 300, noop);
    const second = player.playback.play("1-1", 600, noop);
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.equal(player.reads.length, 1);
    assert.equal(player.media.currentTime, 0.6);
  });

  it("lets a newer call win over one still reading", async () => {
    const player = harness({
      kept: { "1-1": "opus", "1-2": "opus" },
      held: true,
    });
    const started: string[] = [];
    const first = player.playback.play("1-1", 0, () => started.push("1-1"));
    const second = player.playback.play("1-2", 0, () => started.push("1-2"));
    await settle();
    player.answer(1);
    assert.equal(await second, true);
    player.answer(0);
    assert.equal(await first, false);
    assert.deepEqual(started, ["1-2"]);
    // Only the newer recording was handed to the element.
    assert.equal(player.blobs.size, 1);
    assert.equal(player.media.played.length, 1);

    // A late failure of a call that lost is not reported either.
    const third = player.playback.play("1-1", 0, noop);
    const fourth = player.playback.play("1-2", 0, noop);
    await settle();
    player.fail(2, new Error("This recording is no longer in your library."));
    assert.equal(await third, false);
    assert.equal(await fourth, true);
  });

  it("lets a newer call win while the WAV is read", async () => {
    const player = harness({
      kept: { "1-1": "opus", "1-2": "wav" },
      unplayable: ["audio/ogg"],
      held: true,
    });
    const first = player.playback.play("1-1", 0, noop);
    await settle();
    player.answer(0);
    await settle();
    assert.deepEqual(
      player.reads.map((read) => read.format),
      ["ogg", "wav"],
    );
    const second = player.playback.play("1-2", 0, noop);
    await settle();
    player.answer(2);
    assert.equal(await second, true);
    // The first recording's WAV comes too late.
    player.answer(1);
    assert.equal(await first, false);
    assert.deepEqual(player.media.played, [{ type: "audio/wav", atMs: 0 }]);
    assert.equal(player.blobs.size, 2);
    assert.equal(player.media.src, "blob:2");
  });

  it("reports a read error and reads again next time", async () => {
    const player = harness({ kept: { "1-1": "opus" } });
    player.failNextRead(
      new Error("This recording is no longer in your library."),
    );
    await assert.rejects(
      player.playback.play("1-1", 0, noop),
      /no longer in your library/,
    );
    assert.equal(player.media.src, "");
    assert.equal(await player.playback.play("1-1", 0, noop), true);
    assert.equal(player.reads.length, 2);
  });

  it("closing stops playback, lets go of the audio and drops a call still reading", async () => {
    const player = harness({
      kept: { "1-1": "opus", "1-2": "opus" },
      held: true,
    });
    const first = player.playback.play("1-1", 0, noop);
    await settle();
    player.answer(0);
    assert.equal(await first, true);
    const second = player.playback.play("1-2", 0, noop);
    await settle();
    const pauses = player.media.pauses;
    player.playback.close();
    assert.equal(player.media.pauses, pauses + 1);
    assert.deepEqual(player.revoked, ["blob:1"]);
    player.answer(1);
    assert.equal(await second, false);
    assert.equal(player.blobs.size, 1);
    assert.equal(player.media.played.length, 1);
  });
});
