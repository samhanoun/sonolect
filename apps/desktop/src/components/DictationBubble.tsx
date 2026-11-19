import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ClipboardCheck,
  Mic,
  Square,
  X,
} from "lucide-react";
import {
  BUBBLE_ACTION_EVENT,
  BUBBLE_LEVEL_EVENT,
  BUBBLE_READY_EVENT,
  BUBBLE_STATE_EVENT,
  MAIN_WINDOW_LABEL,
  formatElapsed,
  pushLevel,
  type BubbleAction,
  type BubbleState,
} from "../dictationBubble";
import "../dictation-bubble.css";

const BAR_COUNT = 18;
const INITIAL_STATE: BubbleState = {
  phase: "idle",
  startedAt: null,
  detail: null,
  hotkey: "",
};

async function send(action: BubbleAction) {
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo(MAIN_WINDOW_LABEL, BUBBLE_ACTION_EVENT, action);
  } catch {
    // Main window is gone; nothing to do.
  }
}

/** Rendered inside the always-on-top "recorder" window. */
export default function DictationBubble() {
  const [state, setState] = useState<BubbleState>(INITIAL_STATE);
  const [levels, setLevels] = useState<number[]>(() =>
    Array.from({ length: BAR_COUNT }, () => 0),
  );
  const [now, setNow] = useState(() => Date.now());
  const levelsRef = useRef(levels);

  useEffect(() => {
    document.documentElement.classList.add("bubble-window");
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      const { listen, emitTo } = await import("@tauri-apps/api/event");
      const offState = await listen<BubbleState>(BUBBLE_STATE_EVENT, (event) =>
        setState(event.payload),
      );
      const offLevel = await listen<number>(BUBBLE_LEVEL_EVENT, (event) => {
        levelsRef.current = pushLevel(
          levelsRef.current,
          Number(event.payload) || 0,
          BAR_COUNT,
        );
        setLevels(levelsRef.current);
      });
      if (disposed) {
        offState();
        offLevel();
        return;
      }
      unlisteners.push(offState, offLevel);
      await emitTo(MAIN_WINDOW_LABEL, BUBBLE_READY_EVENT).catch(
        () => undefined,
      );
    })();
    return () => {
      disposed = true;
      unlisteners.forEach((off) => off());
    };
  }, []);

  useEffect(() => {
    if (state.phase !== "listening") {
      levelsRef.current = Array.from({ length: BAR_COUNT }, () => 0);
      setLevels(levelsRef.current);
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state.phase]);

  const { phase } = state;

  if (phase === "idle") {
    return (
      <button
        type="button"
        className="bubble bubble--idle"
        onClick={() => void send("toggle")}
        onDoubleClick={() => void send("open-app")}
        aria-label={`Start dictation (${state.hotkey})`}
        title={`Click or press ${state.hotkey} to dictate. Double-click to open Sonolect.`}
      >
        <span className="bubble__orb" aria-hidden="true">
          <Mic size={13} strokeWidth={2} />
        </span>
        <span className="bubble__hint">{state.hotkey || "Dictate"}</span>
      </button>
    );
  }

  const elapsed =
    state.startedAt !== null ? formatElapsed(now - state.startedAt) : "0:00";

  return (
    <div className="bubble-stack">
      <div
        className={`bubble bubble--active bubble--${phase}`}
        role="status"
        aria-live="polite"
        aria-label={labelFor(phase)}
      >
        <button
          type="button"
          className="bubble__icon-btn"
          onClick={() => void send("cancel")}
          aria-label={
            phase === "listening" || phase === "transcribing"
              ? "Cancel dictation"
              : "Dismiss"
          }
          title="Cancel (Esc)"
        >
          <X size={15} strokeWidth={2} />
        </button>

        <div className="bubble__center">
          {phase === "listening" || phase === "transcribing" ? (
            <div
              className={`bubble__wave ${phase === "transcribing" ? "is-thinking" : ""}`}
              aria-hidden="true"
            >
              {levels.map((level, index) => (
                <span
                  key={index}
                  style={{
                    transform: `scaleY(${phase === "transcribing" ? 0.35 : 0.12 + level * 0.88})`,
                    animationDelay: `${index * 55}ms`,
                  }}
                />
              ))}
            </div>
          ) : (
            <span className="bubble__result">
              {phase === "inserted" && <Check size={15} strokeWidth={2.4} />}
              {phase === "copied" && (
                <ClipboardCheck size={15} strokeWidth={2.2} />
              )}
              {phase === "error" && <AlertCircle size={15} strokeWidth={2.2} />}
              {labelFor(phase)}
            </span>
          )}
        </div>

        {phase === "listening" ? (
          <>
            <span className="bubble__timer">{elapsed}</span>
            <button
              type="button"
              className="bubble__stop"
              onClick={() => void send("finish")}
              aria-label="Stop and insert"
              title="Stop and insert"
            >
              <Square size={11} strokeWidth={0} fill="currentColor" />
            </button>
          </>
        ) : phase === "transcribing" ? (
          <span className="bubble__timer">…</span>
        ) : (
          <span className="bubble__spacer" />
        )}
      </div>
      {state.detail && <p className="bubble__detail">{state.detail}</p>}
    </div>
  );
}

function labelFor(phase: BubbleState["phase"]): string {
  switch (phase) {
    case "listening":
      return "Listening";
    case "transcribing":
      return "Transcribing";
    case "inserted":
      return "Inserted";
    case "copied":
      return "Copied";
    case "error":
      return "Couldn't dictate";
    default:
      return "Ready";
  }
}
