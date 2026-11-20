import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STRINGS } from "./i18n";
import type { TtsDeps, TtsUtteranceCallbacks, TtsVoice } from "./ttsCore";
import {
  MAX_TTS_CHUNK,
  chunkForSpeech,
  createTtsController,
  engineLanguage,
  filterVoices,
  formatRate,
  retryWhileThrowing,
  voiceLabel,
} from "./ttsCore";

const ANDROID_LIMIT = 4000;

/** Sentences of 9 to 60 characters, deterministic. */
function prose(length: number): string {
  const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"];
  let text = "";
  let i = 0;
  while (text.length < length) {
    const word = words[i % words.length] ?? "word";
    text += i % 9 === 8 ? `${word}. ` : `${word} `;
    i += 1;
  }
  return text.slice(0, length).trim();
}

describe("chunkForSpeech", () => {
  it("keeps 12 000 characters under the chunk size, in order", () => {
    const text = prose(12_000);
    const chunks = chunkForSpeech(text, ANDROID_LIMIT);
    assert.ok(chunks.length >= 4);
    for (const chunk of chunks) {
      assert.ok(chunk.length > 0 && chunk.length <= MAX_TTS_CHUNK);
    }
    assert.equal(chunks.join(" "), text);
  });

  it("splits after a sentence end when one fits", () => {
    const chunks = chunkForSpeech(prose(12_000), ANDROID_LIMIT);
    for (const chunk of chunks.slice(0, -1)) assert.match(chunk, /\.$/);
  });

  it("follows a smaller engine limit", () => {
    const text = prose(5_000);
    const chunks = chunkForSpeech(text, 1000);
    for (const chunk of chunks) assert.ok(chunk.length <= 1000);
    assert.equal(chunks.join(" "), text);
  });

  it("uses the chunk size when the engine has no limit (iOS)", () => {
    const chunks = chunkForSpeech(prose(9_000), Number.MAX_VALUE);
    for (const chunk of chunks) assert.ok(chunk.length <= MAX_TTS_CHUNK);
  });

  it("splits at a space when there is no sentence break", () => {
    const text = Array.from({ length: 1500 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkForSpeech(text, 1000);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 1000);
      assert.doesNotMatch(chunk, /^ | $/);
    }
    assert.equal(chunks.join(" "), text);
  });

  it("cuts a single 5000-character word hard", () => {
    const word = "a".repeat(5000);
    const chunks = chunkForSpeech(word, ANDROID_LIMIT);
    assert.deepEqual(
      chunks.map((chunk) => chunk.length),
      [MAX_TTS_CHUNK, 5000 - MAX_TTS_CHUNK],
    );
    assert.equal(chunks.join(""), word);
  });

  it("never cuts inside a surrogate pair", () => {
    const text = "😀".repeat(10);
    const chunks = chunkForSpeech(text, 5);
    assert.equal(chunks.join(""), text);
    for (const chunk of chunks) assert.equal(chunk.length % 2, 0);
  });

  it("splits text without spaces after a full-width sentence end", () => {
    const sentence = `${"字".repeat(30)}。`;
    const chunks = chunkForSpeech(sentence.repeat(4), 70);
    assert.deepEqual(chunks, [sentence.repeat(2), sentence.repeat(2)]);
  });

  it("collapses whitespace and gives [] for empty text", () => {
    assert.deepEqual(chunkForSpeech("", ANDROID_LIMIT), []);
    assert.deepEqual(chunkForSpeech(" \n\t ", ANDROID_LIMIT), []);
    assert.deepEqual(chunkForSpeech("  Hello\n\nworld  ", ANDROID_LIMIT), [
      "Hello world",
    ]);
  });
});

interface Utterance {
  text: string;
  callbacks: TtsUtteranceCallbacks;
}

function fakeDeps(overrides: Partial<TtsDeps> = {}) {
  const calls: string[] = [];
  const spoken: Utterance[] = [];
  const deps: TtsDeps = {
    speak: (text, _options, callbacks) => {
      calls.push("speak");
      spoken.push({ text, callbacks });
    },
    stop: async () => {
      calls.push("stop");
    },
    pause: async () => {
      calls.push("pause");
    },
    resume: async () => {
      calls.push("resume");
    },
    maxInputLength: 1000,
    beforeSpeak: () => calls.push("before"),
    afterSpeak: () => calls.push("after"),
    ...overrides,
  };
  const count = (name: string) => calls.filter((c) => c === name).length;
  return { deps, calls, spoken, count };
}

/** Lets the promise callbacks run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("createTtsController", () => {
  it("stops the engine, takes the session, then queues every chunk", () => {
    const { deps, calls, spoken } = fakeDeps();
    const tts = createTtsController(deps);
    assert.equal(tts.play("note-1", prose(2500)), true);
    assert.deepEqual(calls.slice(0, 2), ["stop", "before"]);
    assert.equal(spoken.length, 3);
    assert.deepEqual(tts.getState(), { status: "playing", ownerId: "note-1" });
  });

  it("gives onDone to the last chunk only, and ends once", async () => {
    const { deps, calls, spoken, count } = fakeDeps();
    const tts = createTtsController(deps);
    tts.play("note-1", prose(2500));
    assert.deepEqual(
      spoken.map((u) => typeof u.callbacks.onDone),
      ["undefined", "undefined", "function"],
    );
    for (const u of spoken) {
      assert.equal(typeof u.callbacks.onStopped, "function");
      assert.equal(typeof u.callbacks.onError, "function");
    }
    spoken[2]?.callbacks.onDone?.();
    assert.equal(tts.getState().status, "idle");
    await flush();
    assert.deepEqual(calls.slice(-2), ["stop", "after"]);
    assert.equal(count("after"), 1);
    spoken[2]?.callbacks.onStopped();
    await flush();
    assert.equal(count("after"), 1);
  });

  it("a natural finish stops the engine before giving the session back", async () => {
    let finishStop: () => void = () => undefined;
    const { deps, calls, spoken, count } = fakeDeps();
    const tts = createTtsController({
      ...deps,
      stop: () => {
        calls.push("stop");
        return new Promise<void>((resolve) => {
          finishStop = resolve;
        });
      },
    });
    tts.play("note-1", "Some text to read.");
    finishStop();
    const stopsBefore = count("stop");
    spoken[0]?.callbacks.onDone?.();
    assert.equal(tts.getState().status, "idle");
    assert.equal(count("stop"), stopsBefore + 1);
    await flush();
    assert.equal(count("after"), 0);
    finishStop();
    await flush();
    assert.equal(count("after"), 1);
  });

  it("a play started before the finish-stop settles keeps the session", async () => {
    let finishStop: () => void = () => undefined;
    const { deps, calls, spoken, count } = fakeDeps();
    const tts = createTtsController({
      ...deps,
      stop: () => {
        calls.push("stop");
        return new Promise<void>((resolve) => {
          finishStop = resolve;
        });
      },
    });
    tts.play("note-1", "One.");
    finishStop();
    spoken[0]?.callbacks.onDone?.();
    const finishStopped = finishStop;
    tts.play("note-2", "Two.");
    finishStopped();
    finishStop();
    await flush();
    assert.equal(count("before"), 1);
    assert.equal(count("after"), 0);
    assert.deepEqual(tts.getState(), { status: "playing", ownerId: "note-2" });
  });

  it("ignores the stop of a replaced utterance (speech-14)", async () => {
    const { deps, spoken, count } = fakeDeps();
    const tts = createTtsController(deps);
    tts.play("reader", "First text.");
    tts.play("reader", "Second text.");
    // Android reports the first utterance's stop after the second started.
    spoken[0]?.callbacks.onStopped();
    await flush();
    assert.deepEqual(tts.getState(), { status: "playing", ownerId: "reader" });
    assert.equal(count("before"), 1);
    assert.equal(count("after"), 0);
    spoken[1]?.callbacks.onDone?.();
    assert.equal(tts.getState().status, "idle");
    await flush();
    assert.equal(count("after"), 1);
  });

  it("stop() goes idle and gives the session back once, after the engine stopped", async () => {
    let finishStop: () => void = () => undefined;
    const { deps, calls, spoken, count } = fakeDeps();
    const tts = createTtsController({
      ...deps,
      stop: () => {
        calls.push("stop");
        return new Promise<void>((resolve) => {
          finishStop = resolve;
        });
      },
    });
    tts.play("note-1", "Some text to read.");
    finishStop();
    const stopped = tts.stop();
    assert.equal(tts.getState().status, "idle");
    assert.equal(count("after"), 0);
    // iOS reports the cancelled utterance; it is no longer current.
    spoken[0]?.callbacks.onStopped();
    finishStop();
    await stopped;
    assert.equal(count("after"), 1);
    await tts.stop();
    assert.equal(count("after"), 1);
  });

  it("a stop while idle does not touch the engine", async () => {
    const { deps, calls } = fakeDeps();
    const tts = createTtsController(deps);
    await tts.stop();
    assert.deepEqual(calls, []);
  });

  it("an error mid-queue goes idle and stops the rest", async () => {
    const { deps, spoken, count } = fakeDeps();
    const tts = createTtsController(deps);
    tts.play("note-1", prose(2500));
    const stopsBefore = count("stop");
    spoken[1]?.callbacks.onError();
    assert.equal(tts.getState().status, "idle");
    assert.equal(count("stop"), stopsBefore + 1);
    await flush();
    assert.equal(count("after"), 1);
    spoken[2]?.callbacks.onDone?.();
    assert.equal(count("after"), 1);
  });

  it("a speak that throws goes idle", async () => {
    const { deps } = fakeDeps({
      speak: () => {
        throw new Error("too long");
      },
    });
    const tts = createTtsController(deps);
    assert.equal(tts.play("note-1", "Text."), false);
    assert.equal(tts.getState().status, "idle");
  });

  it("switches owners and keeps beforeSpeak and afterSpeak paired", async () => {
    const { deps, spoken, count } = fakeDeps();
    const tts = createTtsController(deps);
    const seen: (string | null)[] = [];
    const unsubscribe = tts.subscribe(() => seen.push(tts.getState().ownerId));
    tts.play("note-1", "One.");
    tts.play("note-2", "Two.");
    assert.equal(tts.getState().ownerId, "note-2");
    spoken[0]?.callbacks.onStopped();
    spoken[1]?.callbacks.onDone?.();
    await flush();
    assert.deepEqual(seen, ["note-1", "note-2", null]);
    assert.equal(count("before"), 1);
    assert.equal(count("after"), 1);
    tts.play("note-1", "Again.");
    await tts.stop();
    assert.equal(count("before"), 2);
    assert.equal(count("after"), 2);
    unsubscribe();
  });

  it("keeps the session for a play that starts while a stop settles", async () => {
    let finishStop: () => void = () => undefined;
    const { deps, calls, count } = fakeDeps();
    const tts = createTtsController({
      ...deps,
      stop: () => {
        calls.push("stop");
        return new Promise<void>((resolve) => {
          finishStop = resolve;
        });
      },
    });
    tts.play("note-1", "One.");
    const stopped = tts.stop();
    const release = finishStop;
    tts.play("note-2", "Two.");
    release();
    await stopped;
    assert.equal(count("after"), 0);
    assert.equal(tts.getState().status, "playing");
  });

  it("refuses to play when not allowed or with nothing to read", () => {
    const { deps, calls } = fakeDeps({ canPlay: () => false });
    const tts = createTtsController(deps);
    assert.equal(tts.play("note-1", "Text."), false);
    assert.equal(tts.play("note-1", "   "), false);
    assert.deepEqual(calls, []);
    assert.equal(tts.getState().status, "idle");
  });

  it("pauses and resumes the current playback only", async () => {
    const { deps, spoken } = fakeDeps();
    const tts = createTtsController(deps);
    await tts.pause();
    assert.equal(tts.getState().status, "idle");
    tts.play("reader", "Text.");
    await tts.pause();
    assert.equal(tts.getState().status, "paused");
    await tts.resume();
    assert.equal(tts.getState().status, "playing");
    spoken[0]?.callbacks.onDone?.();
    await tts.resume();
    assert.equal(tts.getState().status, "idle");
  });

  it("stays playing when the engine cannot pause (Android)", async () => {
    const { deps } = fakeDeps({
      pause: () => Promise.reject(new Error("unavailable")),
    });
    const tts = createTtsController(deps);
    tts.play("reader", "Text.");
    await tts.pause();
    assert.equal(tts.getState().status, "playing");
  });

  /** An engine that becomes ready when the test says so (Android). */
  function startingEngine() {
    let ready = false;
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = () => {
        ready = true;
        resolve();
      };
    });
    return { ready: () => (ready ? null : pending), finish: () => finish() };
  }

  it("a stop before the engine is ready never speaks", async () => {
    const engine = startingEngine();
    const { deps, count } = fakeDeps({ ready: engine.ready });
    const tts = createTtsController(deps);
    assert.equal(tts.play("note-1", prose(2500)), true);
    assert.equal(count("speak"), 0);
    await tts.stop();
    engine.finish();
    await flush();
    assert.equal(count("speak"), 0);
    assert.equal(tts.getState().status, "idle");
    assert.equal(count("after"), 1);
  });

  it("play waits for the engine, then queues every chunk", async () => {
    const engine = startingEngine();
    const { deps, spoken } = fakeDeps({ ready: engine.ready });
    const tts = createTtsController(deps);
    assert.equal(tts.play("note-1", prose(2500)), true);
    assert.equal(spoken.length, 0);
    assert.deepEqual(tts.getState(), { status: "playing", ownerId: "note-1" });
    engine.finish();
    await flush();
    assert.equal(spoken.length, 3);
    assert.equal(typeof spoken[2]?.callbacks.onDone, "function");
    assert.deepEqual(tts.getState(), { status: "playing", ownerId: "note-1" });
    // Once the engine is ready, a play queues at once.
    tts.play("note-2", "Two.");
    assert.equal(spoken.length, 4);
  });

  it("a second play before readiness speaks only the second text", async () => {
    const engine = startingEngine();
    const { deps, spoken } = fakeDeps({ ready: engine.ready });
    const tts = createTtsController(deps);
    tts.play("note-1", "First text.");
    tts.play("note-2", "Second text.");
    engine.finish();
    await flush();
    assert.deepEqual(
      spoken.map((u) => u.text),
      ["Second text."],
    );
    assert.deepEqual(tts.getState(), { status: "playing", ownerId: "note-2" });
  });

  it("still speaks when the readiness check fails", async () => {
    const { deps, spoken } = fakeDeps({
      ready: () => Promise.reject(new Error("no engine")),
    });
    const tts = createTtsController(deps);
    tts.play("note-1", "Text.");
    await flush();
    assert.equal(spoken.length, 1);
  });
});

describe("retryWhileThrowing", () => {
  function fakeTimer() {
    const queued: { run: () => void; ms: number }[] = [];
    return {
      queued,
      schedule: (run: () => void, ms: number) => {
        queued.push({ run, ms });
      },
      next: () => queued.shift()?.run(),
    };
  }

  it("does not schedule anything when the first attempt works", () => {
    const timer = fakeTimer();
    let attempts = 0;
    retryWhileThrowing(
      () => {
        attempts += 1;
      },
      () => true,
      timer.schedule,
    );
    assert.equal(attempts, 1);
    assert.equal(timer.queued.length, 0);
  });

  it("tries again 300 ms later after a throw", () => {
    const timer = fakeTimer();
    let attempts = 0;
    retryWhileThrowing(
      () => {
        attempts += 1;
        if (attempts === 1) throw new Error("busy");
      },
      () => true,
      timer.schedule,
    );
    assert.equal(attempts, 1);
    assert.deepEqual(
      timer.queued.map((q) => q.ms),
      [300],
    );
    timer.next();
    assert.equal(attempts, 2);
    assert.equal(timer.queued.length, 0);
  });

  it("does not try again once it is no longer wanted", () => {
    const timer = fakeTimer();
    let attempts = 0;
    const gaveUp: unknown[] = [];
    retryWhileThrowing(
      () => {
        attempts += 1;
        throw new Error("busy");
      },
      () => false,
      timer.schedule,
      (error) => gaveUp.push(error),
    );
    timer.next();
    assert.equal(attempts, 1);
    assert.equal(timer.queued.length, 0);
    assert.deepEqual(gaveUp, []);
  });

  it("gives up after three retries with the last error", () => {
    const timer = fakeTimer();
    let attempts = 0;
    const gaveUp: unknown[] = [];
    retryWhileThrowing(
      () => {
        attempts += 1;
        throw new Error(`busy ${attempts}`);
      },
      () => true,
      timer.schedule,
      (error) => gaveUp.push(error),
    );
    while (timer.queued.length > 0) timer.next();
    assert.equal(attempts, 4);
    assert.equal(gaveUp.length, 1);
    assert.equal((gaveUp[0] as Error).message, "busy 4");
  });
});

const voice = (
  identifier: string,
  language: string,
  quality = "Default",
  name = identifier,
): TtsVoice => ({ identifier, name, language, quality });

describe("voices and rate", () => {
  const voices = [
    voice("en-us-x-iol-local", "en-US"),
    voice("en-us-x-sfg-network", "en-US", "Enhanced"),
    voice("en-gb-x-gba-local", "en-GB", "Enhanced"),
    voice("en-us-x-tpd-local", "en-US", "Enhanced"),
    voice("fr-fr-x-frc-local", "fr-FR"),
  ];

  it("drops network voices on Android only", () => {
    assert.deepEqual(
      filterVoices(voices, "en-US", "android").map((v) => v.identifier),
      ["en-us-x-tpd-local", "en-gb-x-gba-local", "en-us-x-iol-local"],
    );
    assert.ok(
      filterVoices(voices, "en-US", "ios").some((v) =>
        v.identifier.includes("network"),
      ),
    );
  });

  it("keeps the base language and at most six voices", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      voice(`fr-${i}`, i % 2 ? "fr-FR" : "fr-CA"),
    );
    const kept = filterVoices([...voices, ...many], "fr-FR", "ios");
    assert.equal(kept.length, 6);
    assert.ok(kept.every((v) => v.language.startsWith("fr")));
    assert.equal(kept[0]?.identifier, "fr-fr-x-frc-local");
  });

  it("labels Android voices by language and quality", () => {
    const en = STRINGS.en;
    assert.equal(
      voiceLabel(
        voice("en-us-x-tpd-local", "en-US", "Enhanced"),
        0,
        en,
        "android",
      ),
      "en-US · Enhanced 1",
    );
    assert.equal(
      voiceLabel(voice("fr-fr-x-frc-local", "fr-FR"), 2, STRINGS.fr, "android"),
      "fr-FR · Standard 3",
    );
    assert.equal(
      voiceLabel(
        voice(
          "com.apple.voice.compact.en-US.Samantha",
          "en-US",
          "Default",
          "Samantha",
        ),
        0,
        en,
        "ios",
      ),
      "Samantha",
    );
  });

  it("gives Android the base language and other platforms the full tag", () => {
    // Android's Locale.Builder().setLanguage() rejects 'fr-FR'.
    assert.equal(engineLanguage("fr-FR", "android"), "fr");
    assert.equal(engineLanguage("ar-SA", "android"), "ar");
    assert.equal(engineLanguage("en_US", "android"), "en");
    assert.equal(engineLanguage("fr-FR", "ios"), "fr-FR");
    assert.equal(engineLanguage("fr-FR", "web"), "fr-FR");
  });

  it("formats rates for the locale", () => {
    assert.equal(formatRate(1.25, "en"), "1.25×");
    assert.equal(formatRate(1.25, "fr"), "1,25×");
    assert.equal(formatRate(1, "fr"), "1×");
    assert.equal(formatRate(0.75, "en"), "0.75×");
  });
});
