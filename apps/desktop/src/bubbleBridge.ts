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
  displayAccelerator,
  isBubbleAction,
  parseBubbleVisibility,
  shouldShowBubble,
  type BubblePhase,
  type BubbleState,
  type BubbleVisibility,
} from "./dictationBubble";
import { DEFAULT_TOGGLE_SHORTCUT, isTauriRuntime } from "./desktopNative";
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

function isMac(): boolean {
  return /Mac/i.test(globalThis.navigator?.platform ?? "");
}

/** Keeps the bubble window in sync with the store. Call once, in the main window. */
export function useDictationBubbleBridge(): void {
  useEffect(() => {
    if (!isTauriRuntime()) return;
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
      const hotkey = displayAccelerator(DEFAULT_TOGGLE_SHORTCUT, isMac());

      const setEscape = async (active: boolean) => {
        if (active === escapeRegistered) return;
        escapeRegistered = active;
        try {
          const shortcuts = await import("@tauri-apps/plugin-global-shortcut");
          if (active) {
            await shortcuts.register("Escape", (event) => {
              if (event.state === "Pressed") {
                useDesktopStore.getState().cancelVoiceCapture();
              }
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
          st.dictationSource === "app" ? undefined : st.dictationOutcome,
        );
        if (FINISHED.has(phase) && dismissedGeneration === generation) {
          return "idle";
        }
        return phase;
      };

      const push = () => {
        if (disposed) return;
        const st = useDesktopStore.getState();
        const phase = computePhase();
        const state: BubbleState = {
          phase,
          startedAt: phase === "listening" ? startedAt : null,
          detail: bubbleDetailFor(phase, st.dictationOutcome, st.voiceError),
          hotkey,
        };
        void emitTo(BUBBLE_WINDOW_LABEL, BUBBLE_STATE_EVENT, state).catch(
          () => undefined,
        );

        void setEscape(phase === "listening" || phase === "transcribing");

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
              store.cancelVoiceCapture();
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
  }, []);
}
