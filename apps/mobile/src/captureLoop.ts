import type { NoticeKind } from "./notices";
import type { RecognitionPlatform } from "./speechPolicy";
import {
  TranscriptAccumulator,
  classifySpeechError,
  restartsOnEnd,
  shouldRetryWithSystemService,
} from "./speechPolicy";

/**
 * The capture loop. Below Android 13 the recognizer ends at the first pause,
 * and Apple's server recognizer ends after about a minute. When the plan
 * says restartOnEnd, an end the user did not ask for starts the recognizer
 * again and the text keeps growing, until Done, Cancel, an error or a cap.
 *
 * Pure, so tests can drive it: speech.ts passes the native module in as a
 * LoopRecognizer and forwards its events. The loop calls onEnd at most once
 * and never after abort(), never starts the recognizer again after Done or
 * Cancel, and keeps every finalised and interim text.
 */

/** The wait before a restart, which avoids ERROR_RECOGNIZER_BUSY. */
export const RESTART_DELAY_MS = 300;
/** No new text for this long ends a dictation that restarts. */
export const IDLE_LIMIT_MS = 9_000;
/** A dictation that restarts ends after 10 minutes. */
export const MAX_DURATION_MS = 600_000;
/** Recognizer sessions in a row without text that end the dictation. */
export const MAX_EMPTY_RESTARTS = 3;
/**
 * Done pressed while a recognizer session is still starting: how long to
 * wait for its 'start' before cancelling it and finishing with the text so
 * far. iOS creates the session asynchronously, so a stop sent earlier could
 * be lost or leave that session running.
 */
export const STOP_WAIT_MS = 2_000;

/** A notice, 'benign' (silence or a timeout), or null for no error. */
export type LoopErrorKind = NoticeKind | "benign" | null;

export interface LoopStepInput {
  restartOnEnd: boolean;
  /** The user pressed Done. */
  userStopped: boolean;
  /** The user pressed Cancel. */
  cancelled: boolean;
  /** The error of the recognizer session that just ended. */
  errorKind: LoopErrorKind;
  /** Since the dictation started. */
  elapsedMs: number;
  /** Since the last recognized text, or since the start. */
  idleMs: number;
  /** Recognizer sessions in a row, this one included, without text. */
  emptyRestarts: number;
}

export interface LoopStep {
  action: "restart" | "finish" | "abort";
  notice?: NoticeKind;
}

/**
 * What to do when a recognizer session ends. The first matching rule wins:
 * Cancel, Done, an error, a plan that does not restart, the 10-minute cap,
 * then the idle and empty-session caps. A dictation that ends on a cap
 * without text gets its 'noSpeech' notice later, from the store.
 */
export function nextLoopStep(input: LoopStepInput): LoopStep {
  if (input.cancelled) return { action: "abort" };
  if (input.userStopped) return { action: "finish" };
  if (input.errorKind !== null && input.errorKind !== "benign") {
    return { action: "finish", notice: input.errorKind };
  }
  if (!input.restartOnEnd) return { action: "finish" };
  if (input.elapsedMs >= MAX_DURATION_MS) {
    return { action: "finish", notice: "maxDuration" };
  }
  if (
    input.idleMs >= IDLE_LIMIT_MS ||
    input.emptyRestarts >= MAX_EMPTY_RESTARTS
  ) {
    return { action: "finish" };
  }
  return { action: "restart" };
}

/** The native recognizer, as speech.ts drives it. */
export interface LoopRecognizer {
  /** Starts a session. Throws when the native call throws. */
  start(requiresOnDevice: boolean): void;
  /** Asks for the final result; the native 'end' follows. */
  stop(): void;
  /** Cancels at once, without a final result. */
  abort(): void;
}

/** Time, passed in so tests can drive it. */
export interface LoopClock {
  now(): number;
  /** Runs `run` after ms; the returned function cancels it. */
  delay(run: () => void, ms: number): () => void;
}

export const systemClock: LoopClock = {
  now: () => Date.now(),
  delay: (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

export interface LoopEnd {
  /** Every session's text, the last interim text included. */
  text: string;
  /** From the first start to the end. */
  durationMs: number;
  /**
   * The recording, only when exactly one session made one: segments of a
   * restarted dictation are not joined, so none of them is uploaded.
   */
  audioUri?: string;
  /** Every recording the sessions reported, uploaded or not. */
  recordings: string[];
  /** A notice of the loop's own, such as 'maxDuration'. */
  notice?: NoticeKind;
}

export interface LoopHandlers {
  onTranscript(text: string, isFinal: boolean): void;
  /**
   * An error code that ends the dictation, or 'start-failed' when a start
   * throws. Benign ends ('no-speech', 'speech-timeout', 'aborted') are not
   * reported.
   */
  onError(code: string): void;
  /** The dictation moved to the system speech service, with consent. */
  onRouteChange(route: "system-service"): void;
  /** Called at most once, and never after abort(). */
  onEnd(result: LoopEnd): void;
}

export interface LoopOptions {
  platform: RecognitionPlatform;
  osVersion: number;
  /** The first session asks for on-device recognition. */
  requiresOnDevice: boolean;
  /** The plan's restartOnEnd. */
  restartOnEnd: boolean;
  /**
   * The user allowed the system speech service for this dictation: when the
   * on-device recognizer has no model for the language, the dictation
   * switches once to the service instead of failing.
   */
  fallbackToSystemService: boolean;
}

export interface CaptureLoop {
  /** Starts the first session; false, after onError, when it throws. */
  begin(): boolean;
  /** Native 'result': the best transcript of the current session. */
  result(transcript: string, isFinal: boolean): void;
  /** Native 'error': an expo-speech-recognition error code. */
  error(code: string): void;
  /** Native 'start': the session is listening. */
  started(): void;
  /** Native 'audioend': the session's recording, if any. */
  audioEnd(uri: string | null): void;
  /** Native 'end': the session is over. */
  ended(): void;
  /** Done: finish with the text so far. */
  stop(): void;
  /** Cancel: end without onEnd. */
  abort(): void;
}

/**
 * idle: before begin(). starting: a session was started and has not
 * reported 'start'. running: the session listens. between: it ended and a
 * restart is due. closed: finished or aborted.
 */
type Phase = "idle" | "starting" | "running" | "between" | "closed";

export function createCaptureLoop(
  recognizer: LoopRecognizer,
  handlers: LoopHandlers,
  options: LoopOptions,
  clock: LoopClock = systemClock,
): CaptureLoop {
  const accumulator = new TranscriptAccumulator();
  const recordings: string[] = [];
  /** Recordings of the current route: each session's, in order. */
  let routeRecordings: string[] = [];
  let phase: Phase = "idle";
  let onDevice = options.requiresOnDevice;
  let restartOnEnd = options.restartOnEnd;
  let startedAt = 0;
  let lastTextAt = 0;
  let emptySessions = 0;
  let stopRequested = false;
  let retried = false;
  /** A missing-language error held back to switch to the speech service. */
  let switchPending = false;
  /** The restart that is due switches to the speech service. */
  let restartSwitches = false;
  let sessionHadText = false;
  let sessionError: LoopErrorKind = null;
  let cancelTimer: (() => void) | null = null;

  const clearTimer = () => {
    cancelTimer?.();
    cancelTimer = null;
  };

  const close = () => {
    phase = "closed";
    clearTimer();
  };

  const finish = (notice?: NoticeKind) => {
    if (phase === "closed") return;
    close();
    const [onlyUri] = routeRecordings;
    handlers.onEnd({
      text: accumulator.commitInterim(),
      durationMs: clock.now() - startedAt,
      ...(routeRecordings.length === 1 && onlyUri ? { audioUri: onlyUri } : {}),
      recordings: [...recordings],
      ...(notice ? { notice } : {}),
    });
  };

  /** Starts a recognizer session; false when the native call throws. */
  const startSession = (): boolean => {
    phase = "starting";
    sessionHadText = false;
    sessionError = null;
    try {
      recognizer.start(onDevice);
      return true;
    } catch {
      return false;
    }
  };

  const stopNative = () => {
    try {
      recognizer.stop();
    } catch {
      finish();
    }
  };

  /** The session is listening; a Done that waited for it goes through. */
  const markRunning = () => {
    if (phase !== "starting") return;
    phase = "running";
    if (stopRequested) {
      clearTimer();
      stopNative();
    }
  };

  const scheduleRestart = (switchToService: boolean) => {
    phase = "between";
    restartSwitches = switchToService;
    cancelTimer = clock.delay(() => {
      cancelTimer = null;
      if (phase !== "between") return;
      if (switchToService) {
        onDevice = false;
        restartOnEnd = restartsOnEnd(
          options.platform,
          options.osVersion,
          "system-service",
        );
        // The failed on-device attempt's recording is not part of the text.
        routeRecordings = [];
      }
      if (!startSession()) {
        handlers.onError("start-failed");
        finish();
        return;
      }
      if (switchToService) handlers.onRouteChange("system-service");
    }, RESTART_DELAY_MS);
  };

  return {
    begin() {
      if (phase !== "idle") return false;
      startedAt = clock.now();
      lastTextAt = startedAt;
      if (startSession()) return true;
      close();
      handlers.onError("start-failed");
      return false;
    },

    result(transcript, isFinal) {
      // A session that ended sends nothing more; ignore anything stale.
      if (phase !== "starting" && phase !== "running") return;
      const text = accumulator.push(transcript, isFinal);
      if (transcript.trim()) {
        sessionHadText = true;
        lastTextAt = clock.now();
      }
      handlers.onTranscript(text, isFinal);
      markRunning();
    },

    error(code) {
      if (phase !== "starting" && phase !== "running") return;
      const kind = classifySpeechError(code, {
        requiresOnDevice: onDevice,
        platform: options.platform,
      });
      if (kind === "aborted") return;
      if (kind === "benign") {
        sessionError ??= "benign";
        return;
      }
      if (
        shouldRetryWithSystemService({
          code,
          requiresOnDevice: onDevice,
          consented: options.fallbackToSystemService,
          alreadyRetried: retried,
          stopRequested,
        })
      ) {
        switchPending = true;
        return;
      }
      if (sessionError === null || sessionError === "benign") {
        sessionError = kind;
      }
      handlers.onError(code);
    },

    started() {
      markRunning();
    },

    audioEnd(uri) {
      if (phase === "idle" || phase === "closed" || !uri) return;
      // A fixed file name is reused: it then holds the last session only.
      routeRecordings.push(uri);
      if (!recordings.includes(uri)) recordings.push(uri);
    },

    ended() {
      if (phase !== "starting" && phase !== "running") return;
      clearTimer();
      if (switchPending) {
        switchPending = false;
        if (stopRequested) {
          // Done came before the switch: report the held-back error.
          handlers.onError("language-not-supported");
          finish();
        } else {
          retried = true;
          scheduleRestart(true);
        }
        return;
      }
      const now = clock.now();
      emptySessions = sessionHadText ? 0 : emptySessions + 1;
      const step = nextLoopStep({
        restartOnEnd,
        userStopped: stopRequested,
        // Cancel closes the loop at once, so no session end follows it.
        cancelled: false,
        errorKind: sessionError,
        elapsedMs: now - startedAt,
        idleMs: now - lastTextAt,
        emptyRestarts: emptySessions,
      });
      switch (step.action) {
        case "restart":
          accumulator.commitInterim();
          scheduleRestart(false);
          return;
        case "finish":
          // An error's notice already went out through onError.
          finish(step.notice === sessionError ? undefined : step.notice);
          return;
        case "abort":
          close();
          return;
      }
    },

    stop() {
      if (phase === "idle" || phase === "closed" || stopRequested) return;
      stopRequested = true;
      switch (phase) {
        case "between":
          // The session already ended, and a native stop would emit nothing.
          if (restartSwitches) handlers.onError("language-not-supported");
          finish();
          return;
        case "starting":
          cancelTimer = clock.delay(() => {
            cancelTimer = null;
            if (phase !== "starting") return;
            try {
              recognizer.abort();
            } catch {
              // Nothing is running.
            }
            finish();
          }, STOP_WAIT_MS);
          return;
        case "running":
          stopNative();
          return;
      }
    },

    abort() {
      if (phase === "closed") return;
      const sessionLive = phase === "starting" || phase === "running";
      close();
      if (!sessionLive) return;
      try {
        recognizer.abort();
      } catch {
        // Already stopped.
      }
    },
  };
}
