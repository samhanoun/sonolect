/**
 * Main-window side of the floating dictation bubble. Runs inside the main
 * window (which owns the microphone and the speech engine), keeps the bubble
 * window in sync and turns bubble button presses into store actions.
 */

import { useEffect } from "react";
import {
  BUBBLE_ACTION_EVENT,
  BUBBLE_LEVEL_EVENT,
  BUBBLE_READY_EVENT,
  BUBBLE_STATE_EVENT,
  BUBBLE_VISIBILITY_KEY,
  BUBBLE_WINDOW_LABEL,
  OUTCOME_LINGER_MS,
  bubbleDetailFor,
  bubblePhaseFor,
  bubbleSizeFor,
  canCancel,
  displayAccelerator,
  isBubbleAction,
  isDictation,
  parseBubbleVisibility,
  shouldShowBubble,
  type BubblePhase,
  type BubbleState,
  type BubbleVisibility,
} from "./dictationBubble";
import {
  DEFAULT_TOGGLE_SHORTCUT,
  isMacPlatform,
  isTauriRuntime,
} from "./desktopNative";
import { getLocale, getT, useI18nStore } from "./i18n";
import { subscribeMicLevel, useDesktopStore } from "./store/appStore";

type VisibilityListener = (visibility: BubbleVisibility) => void;
const visibilityListeners = new Set<VisibilityListener>();

export function loadBubbleVisibility(): BubbleVisibility {
  try {
    return parseBubbleVisibility(localStorage.getItem(BUBBLE_VISIBILITY_KEY));
  } catch {
    return parseBubbleVisibility(null);
  }
}

export function saveBubbleVisibility(visibility: BubbleVisibility): void {
  try {
    localStorage.setItem(BUBBLE_VISIBILITY_KEY, visibility);
  } catch {
    // Storage unavailable: still apply for this session.
  }
  visibilityListeners.forEach((listener) => listener(visibility));
}

const FINISHED: ReadonlySet<BubblePhase> = new Set([
  "inserted",
  "copied",
  "error",
]);
const LEVEL_FRAME_MS = 45;

/**
 * Keeps the bubble window in sync with the store, from the main window.
 * Returns what stops it.
 */
export function startDictationBubbleBridge(): () => void {
  if (!isTauriRuntime()) return () => undefined;
  let disposed = false;
  const cleanups: Array<() => void> = [];

  void (async () => {
    const [{ emitTo, listen }, { invoke }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/core"),
    ]);
    if (disposed) return;

    let visibility = loadBubbleVisibility();
    // Each capture gets a generation; a finished state is shown until the
    // linger timer marks that generation as dismissed.
    let generation = 0;
    let dismissedGeneration = -1;
    let startedAt: number | null = null;
    let lingerTimer: ReturnType<typeof setTimeout> | undefined;
    let lastShown: string | undefined;
    let escapeRegistered = false;

    const setEscape = async (active: boolean) => {
      if (active === escapeRegistered) return;
      escapeRegistered = active;
      try {
        const shortcuts = await import("@tauri-apps/plugin-global-shortcut");
        if (active) {
          await shortcuts.register("Escape", (event) => {
            if (event.state === "Pressed") cancelDictation();
          });
        } else {
          await shortcuts.unregister("Escape");
        }
      } catch {
        // Another app owns Escape; the ✕ button still cancels.
      }
    };

    const computePhase = (): BubblePhase => {
      const st = useDesktopStore.getState();
      const phase = bubblePhaseFor(
        st.recordingState,
        st.dictationOutcome,
        st.dictationSource,
      );
      if (FINISHED.has(phase) && dismissedGeneration === generation) {
        return "idle";
      }
      return phase;
    };

    // Esc and the bubble's ✕. Checked again here: the shortcut is taken and
    // released asynchronously, and the bubble window only sends requests.
    const cancelDictation = () => {
      const st = useDesktopStore.getState();
      if (canCancel(computePhase(), isDictation(st.dictationSource))) {
        st.cancelVoiceCapture();
      }
    };

    const push = () => {
      if (disposed) return;
      const st = useDesktopStore.getState();
      const phase = computePhase();
      const dictation = isDictation(st.dictationSource);
      // In the interface language as it is now: the bubble follows it.
      const t = getT();
      const state: BubbleState = {
        phase,
        startedAt: phase === "listening" ? startedAt : null,
        detail: bubbleDetailFor(
          phase,
          st.dictationOutcome,
          st.voiceError,
          t,
          displayAccelerator("CommandOrControl+V", isMacPlatform()),
        ),
        hotkey: displayAccelerator(DEFAULT_TOGGLE_SHORTCUT, isMacPlatform(), {
          Shift: t("studio.keys.shift"),
        }),
        locale: getLocale(),
        dictation,
      };
      void emitTo(BUBBLE_WINDOW_LABEL, BUBBLE_STATE_EVENT, state).catch(
        () => undefined,
      );

      // Esc is taken from every other app while it is registered, and it
      // discards the audio: only for a dictation, never a Studio recording.
      void setEscape(canCancel(phase, dictation));

      const size = bubbleSizeFor(phase);
      const visible = shouldShowBubble(visibility, phase);
      const key = visible ? `${size.width}x${size.height}` : "hidden";
      if (key !== lastShown) {
        lastShown = key;
        void (
          visible ? invoke("bubble_show", size) : invoke("bubble_hide")
        ).catch(() => {
          lastShown = undefined;
        });
      }

      clearTimeout(lingerTimer);
      if (FINISHED.has(phase)) {
        const lingerFor = generation;
        lingerTimer = setTimeout(() => {
          dismissedGeneration = lingerFor;
          push();
        }, OUTCOME_LINGER_MS);
      }
    };

    let previousState = useDesktopStore.getState().recordingState;
    cleanups.push(
      useDesktopStore.subscribe((st, prev) => {
        if (
          st.recordingState === previousState &&
          st.dictationOutcome === prev.dictationOutcome &&
          st.dictationSource === prev.dictationSource &&
          st.voiceError === prev.voiceError
        ) {
          return;
        }
        if (
          st.recordingState === "requesting-permission" ||
          (st.recordingState === "recording" &&
            previousState !== "requesting-permission")
        ) {
          generation += 1;
          startedAt = Date.now();
        }
        previousState = st.recordingState;
        push();
      }),
    );

    // A change of interface language reaches the bubble at once.
    cleanups.push(useI18nStore.subscribe(() => push()));

    let lastFrame = 0;
    cleanups.push(
      subscribeMicLevel((level) => {
        const now = Date.now();
        if (level > 0 && now - lastFrame < LEVEL_FRAME_MS) return;
        lastFrame = now;
        void emitTo(BUBBLE_WINDOW_LABEL, BUBBLE_LEVEL_EVENT, level).catch(
          () => undefined,
        );
      }),
    );

    const visibilityListener: VisibilityListener = (next) => {
      visibility = next;
      lastShown = undefined;
      push();
    };
    visibilityListeners.add(visibilityListener);
    cleanups.push(() => visibilityListeners.delete(visibilityListener));

    const unlistenReady = await listen(BUBBLE_READY_EVENT, () => push());
    const unlistenAction = await listen<unknown>(
      BUBBLE_ACTION_EVENT,
      (event) => {
        const action = event.payload;
        if (!isBubbleAction(action)) return;
        const store = useDesktopStore.getState();
        switch (action) {
          case "toggle": {
            const phase = computePhase();
            if (phase === "listening") store.stopVoiceCapture();
            else if (phase === "transcribing") return;
            else {
              dismissedGeneration = generation;
              store.toggleRecording("bubble");
            }
            return;
          }
          case "finish":
            store.stopVoiceCapture();
            return;
          case "cancel":
            if (FINISHED.has(computePhase())) {
              dismissedGeneration = generation;
              push();
              return;
            }
            cancelDictation();
            return;
          case "open-app":
            void invoke("bubble_open_main").catch(() => undefined);
            return;
        }
      },
    );
    if (disposed) {
      unlistenReady();
      unlistenAction();
      return;
    }
    cleanups.push(unlistenReady, unlistenAction, () => {
      clearTimeout(lingerTimer);
      void setEscape(false);
    });
    push();
  })();

  return () => {
    disposed = true;
    cleanups.forEach((cleanup) => cleanup());
  };
}

/** Runs the bubble bridge for as long as the main window is mounted. */
export function useDictationBubbleBridge(): void {
  useEffect(() => startDictationBubbleBridge(), []);
}
