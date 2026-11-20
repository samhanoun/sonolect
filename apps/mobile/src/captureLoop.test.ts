import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  LoopClock,
  LoopEnd,
  LoopOptions,
  LoopRecognizer,
  LoopStepInput,
} from "./captureLoop";
import {
  IDLE_LIMIT_MS,
  MAX_DURATION_MS,
  MAX_EMPTY_RESTARTS,
  RESTART_DELAY_MS,
  STOP_WAIT_MS,
  createCaptureLoop,
  nextLoopStep,
} from "./captureLoop";
import { classifySpeechError } from "./speechPolicy";

/** A session end that would restart: every rule after the first lets it. */
const restartable: LoopStepInput = {
  restartOnEnd: true,
  userStopped: false,
  cancelled: false,
  errorKind: null,
  elapsedMs: 30_000,
  idleMs: 1_000,
  emptyRestarts: 0,
};

const android12 = { requiresOnDevice: false, platform: "android" } as const;

describe("nextLoopStep", () => {
  it("restarts a session that ended on its own", () => {
    assert.deepEqual(nextLoopStep(restartable), { action: "restart" });
  });

  it("cancelled gives abort", () => {
    assert.deepEqual(nextLoopStep({ ...restartable, cancelled: true }), {
      action: "abort",
    });
    assert.deepEqual(
      nextLoopStep({
        ...restartable,
        cancelled: true,
        userStopped: true,
        errorKind: "network",
      }),
      { action: "abort" },
    );
  });

  it("userStopped gives finish, even when a restart would apply", () => {
    assert.deepEqual(nextLoopStep({ ...restartable, userStopped: true }), {
      action: "finish",
    });
    assert.deepEqual(
      nextLoopStep({ ...restartable, userStopped: true, errorKind: "network" }),
      { action: "finish" },
    );
  });

  it("benign 'no-speech' and 'speech-timeout' give restart", () => {
    for (const code of ["no-speech", "speech-timeout"]) {
      const errorKind = classifySpeechError(code, android12);
      assert.equal(errorKind, "benign", code);
      assert.deepEqual(
        nextLoopStep({ ...restartable, errorKind: "benign" }),
        { action: "restart" },
        code,
      );
    }
  });

  it("'network' gives finish with notice network", () => {
    const errorKind = classifySpeechError("network", android12);
    assert.equal(errorKind, "network");
    assert.deepEqual(nextLoopStep({ ...restartable, errorKind: "network" }), {
      action: "finish",
      notice: "network",
    });
  });

  it("ends the loop with its notice on every error the plan names", () => {
    const table: [string, string][] = [
      ["network", "network"],
      ["language-not-supported", "languageNotSupported"],
      ["not-allowed", "micDenied"],
      ["service-not-allowed", "serviceNotAllowed"],
      ["busy", "busy"],
      ["audio-capture", "audioCapture"],
      ["interrupted", "interrupted"],
    ];
    for (const [code, notice] of table) {
      const errorKind = classifySpeechError(code, android12);
      if (errorKind === "benign" || errorKind === "aborted") {
        assert.fail(`${code} is not an error`);
      }
      assert.deepEqual(
        nextLoopStep({ ...restartable, errorKind }),
        { action: "finish", notice },
        code,
      );
    }
  });

  it("restartOnEnd false gives finish", () => {
    assert.deepEqual(nextLoopStep({ ...restartable, restartOnEnd: false }), {
      action: "finish",
    });
    // An Android 13+ or on-device session that ends on its own is not
    // stretched to the caps either.
    assert.deepEqual(
      nextLoopStep({
        ...restartable,
        restartOnEnd: false,
        elapsedMs: MAX_DURATION_MS,
      }),
      { action: "finish" },
    );
  });

  it("elapsed 599_999 gives restart, and 600_000 gives finish with maxDuration", () => {
    assert.deepEqual(nextLoopStep({ ...restartable, elapsedMs: 599_999 }), {
      action: "restart",
    });
    assert.deepEqual(nextLoopStep({ ...restartable, elapsedMs: 600_000 }), {
      action: "finish",
      notice: "maxDuration",
    });
  });

  it("idle 8_999 gives restart, and 9_000 gives finish", () => {
    assert.deepEqual(nextLoopStep({ ...restartable, idleMs: 8_999 }), {
      action: "restart",
    });
    assert.deepEqual(nextLoopStep({ ...restartable, idleMs: 9_000 }), {
      action: "finish",
    });
  });

  it("emptyRestarts 2 gives restart, and 3 gives finish", () => {
    assert.deepEqual(nextLoopStep({ ...restartable, emptyRestarts: 2 }), {
      action: "restart",
    });
    assert.deepEqual(nextLoopStep({ ...restartable, emptyRestarts: 3 }), {
      action: "finish",
    });
  });

  it("applies the rules in order", () => {
    // An error explains the end better than a cap.
    assert.deepEqual(
      nextLoopStep({
        ...restartable,
        errorKind: "busy",
        elapsedMs: MAX_DURATION_MS,
        idleMs: IDLE_LIMIT_MS,
      }),
      { action: "finish", notice: "busy" },
    );
    // The 10-minute cap says why the dictation ended; the idle cap doesn't.
    assert.deepEqual(
      nextLoopStep({
        ...restartable,
        elapsedMs: MAX_DURATION_MS,
        idleMs: IDLE_LIMIT_MS,
        emptyRestarts: MAX_EMPTY_RESTARTS,
      }),
      { action: "finish", notice: "maxDuration" },
    );
    assert.deepEqual(
      nextLoopStep({
        ...restartable,
        errorKind: "benign",
        idleMs: IDLE_LIMIT_MS,
      }),
      { action: "finish" },
    );
  });

  it("keeps the plan's caps", () => {
    assert.equal(RESTART_DELAY_MS, 300);
    assert.equal(IDLE_LIMIT_MS, 9_000);
    assert.equal(MAX_DURATION_MS, 600_000);
    assert.equal(MAX_EMPTY_RESTARTS, 3);
  });
});

/** A clock whose time only moves with tick(), running timers when due. */
function fakeClock(): LoopClock & {
  tick(ms: number): void;
  set(t: number): void;
} {
  let now = 0;
  let timers: { at: number; run: () => void }[] = [];
  const runDue = () => {
    for (;;) {
      const due = timers
        .filter((timer) => timer.at <= now)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) return;
      timers = timers.filter((timer) => timer !== due);
      due.run();
    }
  };
  return {
    now: () => now,
    delay(run, ms) {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((item) => item !== timer);
      };
    },
    tick(ms) {
      now += ms;
      runDue();
    },
    set(t) {
      now = t;
      runDue();
    },
  };
}

interface Harness {
  loop: ReturnType<typeof createCaptureLoop>;
  clock: ReturnType<typeof fakeClock>;
  /** requiresOnDevice of each start, in order. */
  starts: boolean[];
  stops: number;
  aborts: number;
  transcripts: string[];
  errors: string[];
  routes: string[];
  ends: LoopEnd[];
}

function harness(
  options: Partial<LoopOptions> = {},
  failStarts: readonly number[] = [],
): Harness {
  const clock = fakeClock();
  const h = {
    clock,
    starts: [] as boolean[],
    stops: 0,
    aborts: 0,
    transcripts: [] as string[],
    errors: [] as string[],
    routes: [] as string[],
    ends: [] as LoopEnd[],
  };
  const recognizer: LoopRecognizer = {
    start(requiresOnDevice) {
      h.starts.push(requiresOnDevice);
      if (failStarts.includes(h.starts.length)) {
        throw new Error("start failed");
      }
    },
    stop() {
      h.stops += 1;
    },
    abort() {
      h.aborts += 1;
    },
  };
  const loop = createCaptureLoop(
    recognizer,
    {
      onTranscript: (text) => h.transcripts.push(text),
      onError: (code) => h.errors.push(code),
      onRouteChange: (route) => h.routes.push(route),
      onEnd: (end) => h.ends.push(end),
    },
    {
      platform: "android",
      osVersion: 31,
      requiresOnDevice: false,
      restartOnEnd: true,
      fallbackToSystemService: false,
      ...options,
    },
    clock,
  );
  return Object.assign(h, { loop });
}

/** Ends the current session and runs the restart after its delay. */
function restart(h: Harness): void {
  h.loop.ended();
  h.clock.tick(RESTART_DELAY_MS);
  h.loop.started();
}

describe("createCaptureLoop", () => {
  it("keeps every session's text across restarts below Android 13", () => {
    const h = harness();
    assert.equal(h.loop.begin(), true);
    h.loop.started();
    h.loop.result("hello", false);
    h.loop.result("hello world", true);
    h.loop.ended();
    assert.equal(h.ends.length, 0);
    assert.equal(h.starts.length, 1);
    h.clock.tick(RESTART_DELAY_MS - 1);
    assert.equal(h.starts.length, 1);
    h.clock.tick(1);
    assert.equal(h.starts.length, 2);
    h.loop.started();
    // This session ends without a final result: its interim text stays.
    h.loop.result("how are", false);
    restart(h);
    assert.equal(h.starts.length, 3);
    h.loop.result("you", false);
    assert.equal(h.transcripts.at(-1), "hello world how are you");
    h.loop.result("you", true);
    h.loop.stop();
    assert.equal(h.stops, 1);
    h.loop.ended();
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0]?.text, "hello world how are you");
    assert.equal(h.ends[0]?.notice, undefined);
    assert.deepEqual(h.starts, [false, false, false]);
  });

  it("finishes at once on Done between sessions, without a native stop or a later start", () => {
    const h = harness();
    h.loop.begin();
    h.loop.started();
    h.loop.result("first part", true);
    h.loop.ended();
    h.loop.stop();
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0]?.text, "first part");
    assert.equal(h.stops, 0);
    h.clock.tick(10_000);
    assert.equal(h.starts.length, 1);
  });

  it("ends without onEnd on Cancel between sessions, and never starts again", () => {
    const h = harness();
    h.loop.begin();
    h.loop.started();
    h.loop.result("draft", true);
    h.loop.ended();
    h.loop.abort();
    h.clock.tick(10_000);
    assert.equal(h.ends.length, 0);
    assert.equal(h.aborts, 0);
    assert.equal(h.starts.length, 1);
  });

  it("aborts a running session on Cancel and ignores what it sends after", () => {
    const h = harness();
    h.loop.begin();
    h.loop.started();
    h.loop.result("never mind", false);
    h.loop.abort();
    assert.equal(h.aborts, 1);
    h.loop.error("aborted");
    h.loop.result("never mind at all", true);
    h.loop.ended();
    h.clock.tick(10_000);
    assert.equal(h.ends.length, 0);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.transcripts, ["never mind"]);
    assert.equal(h.starts.length, 1);
  });

  it("stops the loop on an error, which is reported once", () => {
    const h = harness();
    h.loop.begin();
    h.loop.started();
    h.loop.result("kept", true);
    h.loop.error("network");
    h.loop.ended();
    h.clock.tick(10_000);
    assert.deepEqual(h.errors, ["network"]);
    assert.equal(h.starts.length, 1);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0]?.text, "kept");
    // The store already shows the error's notice.
    assert.equal(h.ends[0]?.notice, undefined);
  });

  it("restarts after silence and timeouts without reporting them", () => {
    const h = harness();
    h.loop.begin();
    h.loop.started();
    h.loop.result("one", true);
    h.loop.error("no-speech");
    restart(h);
    h.loop.error("speech-timeout");
    restart(h);
    assert.equal(h.starts.length, 3);
    assert.deepEqual(h.errors, []);
    assert.equal(h.ends.length, 0);
  });

  it("finishes with the maxDuration notice after 10 minutes", () => {
    const h = harness();
    h.loop.begin();
    h.loop.started();
    h.loop.result("a", true);
    h.clock.set(MAX_DURATION_MS - 1_000);
    h.loop.result("b", true);
    h.clock.set(MAX_DURATION_MS - 1);
    restart(h);
    assert.equal(h.starts.length, 2);
    h.loop.result("c", true);
    h.loop.ended();
    assert.equal(h.ends.length, 1);
    assert.deepEqual(
      { text: h.ends[0]?.text, notice: h.ends[0]?.notice },
      { text: "a b c", notice: "maxDuration" },
    );
    h.clock.tick(10_000);
    assert.equal(h.starts.length, 2);
  });

  it("finishes after 9 s without new text", () => {
    const h = harness();
    h.loop.begin();
    h.loop.started();
    h.loop.result("hi", true);
    h.clock.set(5_000);
    restart(h);
    // Empty results are no text.
    h.loop.result("", false);
    h.clock.set(IDLE_LIMIT_MS);
    h.loop.ended();
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0]?.text, "hi");
    assert.equal(h.ends[0]?.notice, undefined);
  });

  it("finishes after three empty sessions in a row; text resets the count", () => {
    const h = harness();
    h.loop.begin();
    h.loop.started();
    restart(h);
    restart(h);
    h.loop.result("finally", true);
    restart(h);
    restart(h);
    restart(h);
    assert.equal(h.ends.length, 0);
    h.loop.ended();
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0]?.text, "finally");
    assert.equal(h.starts.length, 6);
  });

  it("finishes when the plan does not restart", () => {
    const h = harness({ osVersion: 34, restartOnEnd: false });
    h.loop.begin();
    h.loop.started();
    h.loop.result("continuous", true);
    h.loop.ended();
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0]?.text, "continuous");
    h.clock.tick(10_000);
    assert.equal(h.starts.length, 1);
  });

  it("calls onEnd once, whatever comes after", () => {
    const h = harness({ restartOnEnd: false });
    h.loop.begin();
    h.loop.started();
    h.loop.result("done", true);
    h.loop.stop();
    h.loop.stop();
    assert.equal(h.stops, 1);
    h.loop.ended();
    h.loop.ended();
    h.loop.result("late", true);
    h.loop.error("network");
    h.loop.stop();
    h.loop.abort();
    h.clock.tick(10_000);
    assert.equal(h.ends.length, 1);
    assert.deepEqual(h.errors, []);
    assert.equal(h.aborts, 0);
    assert.deepEqual(h.transcripts, ["done"]);
  });

  it("finishes in JS when the native stop throws", () => {
    const h = harness();
    const loop = createCaptureLoop(
      {
        start: () => undefined,
        stop: () => {
          throw new Error("no recognizer");
        },
        abort: () => undefined,
      },
      {
        onTranscript: () => undefined,
        onError: () => undefined,
        onRouteChange: () => undefined,
        onEnd: (end) => h.ends.push(end),
      },
      {
        platform: "ios",
        osVersion: 17,
        requiresOnDevice: true,
        restartOnEnd: false,
        fallbackToSystemService: false,
      },
      h.clock,
    );
    loop.begin();
    loop.started();
    loop.result("saved", false);
    loop.stop();
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0]?.text, "saved");
  });

  it("waits for a starting session to listen before stopping it", () => {
    const h = harness();
    h.loop.begin();
    h.loop.started();
    h.loop.result("before", true);
    h.loop.ended();
    h.clock.tick(RESTART_DELAY_MS);
    assert.equal(h.starts.length, 2);
    // Done while the restarted session is starting.
    h.loop.stop();
    assert.equal(h.stops, 0);
    h.loop.started();
    assert.equal(h.stops, 1);
    h.loop.result("after", true);
    h.loop.ended();
    h.clock.tick(STOP_WAIT_MS * 2);
    assert.equal(h.aborts, 0);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0]?.text, "before after");
    assert.equal(h.starts.length, 2);
  });

  it("finishes on the session's end when Done came while it was starting", () => {
    const h = harness();
    h.loop.begin();
    h.loop.stop();
    h.loop.error("no-speech");
    h.loop.ended();
    h.clock.tick(STOP_WAIT_MS * 2);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0]?.text, "");
    assert.equal(h.stops, 0);
    assert.equal(h.aborts, 0);
    assert.equal(h.starts.length, 1);
  });

  it("cancels a session that never starts listening, then finishes", () => {
    const h = harness();
    h.loop.begin();
    h.loop.stop();
    h.clock.tick(STOP_WAIT_MS - 1);
    assert.equal(h.ends.length, 0);
    h.clock.tick(1);
    assert.equal(h.aborts, 1);
    assert.equal(h.ends.length, 1);
    h.loop.started();
    h.loop.ended();
    assert.equal(h.stops, 0);
    assert.equal(h.ends.length, 1);
  });

  it("switches once to the speech service with consent, then restarts it on iOS", () => {
    const h = harness({
      platform: "ios",
      osVersion: 17,
      requiresOnDevice: true,
      restartOnEnd: false,
      fallbackToSystemService: true,
    });
    h.loop.begin();
    h.loop.error("language-not-supported");
    assert.deepEqual(h.errors, []);
    h.loop.ended();
    assert.deepEqual(h.routes, []);
    h.clock.tick(RESTART_DELAY_MS);
    assert.deepEqual(h.starts, [true, false]);
    assert.deepEqual(h.routes, ["system-service"]);
    h.loop.started();
    h.loop.result("bonjour", true);
    // Apple's server session ends after about a minute: it restarts.
    restart(h);
    assert.deepEqual(h.starts, [true, false, false]);
    h.loop.result("encore", true);
    // The service missing the language is reported, not retried again.
    h.loop.error("language-not-supported");
    assert.deepEqual(h.errors, ["language-not-supported"]);
    h.loop.ended();
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0]?.text, "bonjour encore");
    assert.deepEqual(h.routes, ["system-service"]);
  });

  it("never switches without consent", () => {
    const h = harness({
      osVersion: 34,
      requiresOnDevice: true,
      restartOnEnd: false,
    });
    h.loop.begin();
    h.loop.error("language-not-supported");
    h.loop.ended();
    h.clock.tick(10_000);
    assert.deepEqual(h.errors, ["language-not-supported"]);
    assert.deepEqual(h.starts, [true]);
    assert.deepEqual(h.routes, []);
    assert.equal(h.ends.length, 1);
  });

  it("reports the held-back error when Done comes before the switch", () => {
    const consent = {
      osVersion: 34,
      requiresOnDevice: true,
      restartOnEnd: false,
      fallbackToSystemService: true,
    };
    const running = harness(consent);
    running.loop.begin();
    running.loop.started();
    running.loop.error("language-not-supported");
    running.loop.stop();
    running.loop.ended();
    running.clock.tick(10_000);
    assert.deepEqual(running.errors, ["language-not-supported"]);
    assert.deepEqual(running.starts, [true]);
    assert.equal(running.ends.length, 1);

    const between = harness(consent);
    between.loop.begin();
    between.loop.error("language-not-supported");
    between.loop.ended();
    between.loop.stop();
    between.clock.tick(10_000);
    assert.deepEqual(between.errors, ["language-not-supported"]);
    assert.deepEqual(between.starts, [true]);
    assert.deepEqual(between.routes, []);
    assert.equal(between.ends.length, 1);
  });

  it("drops the failed on-device attempt's recording when it switches", () => {
    const h = harness({
      osVersion: 34,
      requiresOnDevice: true,
      restartOnEnd: false,
      fallbackToSystemService: true,
    });
    h.loop.begin();
    h.loop.error("language-not-supported");
    h.loop.audioEnd("file:///on-device.wav");
    h.loop.ended();
    h.clock.tick(RESTART_DELAY_MS);
    h.loop.started();
    h.loop.result("service text", true);
    h.loop.audioEnd("file:///service.wav");
    // Android 13+ runs the service continuously: no restart.
    h.loop.ended();
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0]?.audioUri, "file:///service.wav");
    assert.deepEqual(h.ends[0]?.recordings, [
      "file:///on-device.wav",
      "file:///service.wav",
    ]);
    assert.equal(h.starts.length, 2);
  });

  it("keeps the recording only when one session made it", () => {
    const one = harness({ restartOnEnd: false });
    one.loop.begin();
    one.loop.started();
    one.loop.result("x", true);
    one.loop.audioEnd(null);
    one.loop.audioEnd("file:///one.wav");
    one.loop.ended();
    assert.equal(one.ends[0]?.audioUri, "file:///one.wav");
    assert.deepEqual(one.ends[0]?.recordings, ["file:///one.wav"]);

    const two = harness({ platform: "ios", osVersion: 17 });
    two.loop.begin();
    two.loop.started();
    two.loop.result("x", true);
    two.loop.audioEnd("file:///1.caf");
    restart(two);
    two.loop.result("y", true);
    two.loop.audioEnd("file:///2.caf");
    two.loop.stop();
    two.loop.ended();
    assert.equal(two.ends.length, 1);
    assert.equal(two.ends[0]?.text, "x y");
    assert.equal("audioUri" in (two.ends[0] ?? {}), false);
    // Every segment's file is reported, so it can be deleted.
    assert.deepEqual(two.ends[0]?.recordings, [
      "file:///1.caf",
      "file:///2.caf",
    ]);

    // One file name reused by every session holds the last one only.
    const reused = harness({ platform: "ios", osVersion: 17 });
    reused.loop.begin();
    reused.loop.started();
    reused.loop.result("x", true);
    reused.loop.audioEnd("file:///capture.caf");
    restart(reused);
    reused.loop.result("y", true);
    reused.loop.audioEnd("file:///capture.caf");
    reused.loop.stop();
    reused.loop.ended();
    assert.equal("audioUri" in (reused.ends[0] ?? {}), false);
    assert.deepEqual(reused.ends[0]?.recordings, ["file:///capture.caf"]);
  });

  it("ignores stale results and errors between sessions", () => {
    const h = harness();
    h.loop.begin();
    h.loop.started();
    h.loop.result("live", true);
    h.loop.ended();
    h.loop.result("stale", false);
    h.loop.error("network");
    h.loop.ended();
    h.clock.tick(RESTART_DELAY_MS);
    assert.equal(h.starts.length, 2);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.transcripts, ["live"]);
    assert.equal(h.ends.length, 0);
  });

  it("reports a failed first start without onEnd", () => {
    const h = harness({}, [1]);
    assert.equal(h.loop.begin(), false);
    assert.deepEqual(h.errors, ["start-failed"]);
    h.loop.started();
    h.loop.result("ghost", true);
    h.loop.ended();
    h.loop.stop();
    assert.equal(h.ends.length, 0);
    assert.deepEqual(h.transcripts, []);
    assert.equal(h.loop.begin(), false);
    assert.equal(h.starts.length, 1);
  });

  it("keeps the text when a restart fails to start", () => {
    const h = harness({}, [2]);
    h.loop.begin();
    h.loop.started();
    h.loop.result("kept anyway", false);
    h.loop.ended();
    h.clock.tick(RESTART_DELAY_MS);
    assert.deepEqual(h.errors, ["start-failed"]);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0]?.text, "kept anyway");
  });

  it("measures the dictation from its first start", () => {
    const h = harness({ restartOnEnd: false });
    h.clock.set(1_000);
    h.loop.begin();
    h.loop.started();
    h.loop.result("timed", true);
    h.clock.set(4_500);
    h.loop.ended();
    assert.equal(h.ends[0]?.durationMs, 3_500);
  });
});
