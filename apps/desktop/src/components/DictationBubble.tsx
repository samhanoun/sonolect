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
  canCancel,
  formatElapsed,
  pushLevel,
  type BubbleAction,
  type BubblePhase,
  type BubbleState,
} from "../dictationBubble";
import {
  getLocale,
  isSupportedLocale,
  setLocale,
  useT,
  type LocaleKeys,
} from "../i18n";
import "../dictation-bubble.css";

const BAR_COUNT = 18;
const INITIAL_STATE: BubbleState = {
  phase: "idle",
  startedAt: null,
  detail: null,
  hotkey: "",
  locale: getLocale(),
  dictation: false,
};

const PHASE_LABELS: Record<BubblePhase, LocaleKeys> = {
  idle: "bubble.phase.idle",
  listening: "bubble.phase.listening",
  transcribing: "bubble.phase.transcribing",
  inserted: "bubble.phase.inserted",
  copied: "bubble.phase.copied",
  error: "bubble.phase.error",
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
  const t = useT();
  const [state, setState] = useState<BubbleState>(INITIAL_STATE);
  const [levels, setLevels] = useState<number[]>(() =>
    Array.from({ length: BAR_COUNT }, () => 0),
  );
  const [now, setNow] = useState(() => Date.now());
  // False until real mic levels arrive; until then the wave breathes on its own.
  const [hasLevels, setHasLevels] = useState(false);
  const levelsRef = useRef(levels);

  useEffect(() => {
    document.documentElement.classList.add("bubble-window");
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      const { listen, emitTo } = await import("@tauri-apps/api/event");
      const offState = await listen<BubbleState>(
        BUBBLE_STATE_EVENT,
        ({ payload }) => {
          // This window has its own i18n store: it follows the main window's
          // interface language.
          if (isSupportedLocale(payload.locale)) setLocale(payload.locale);
          // Anything but a clear yes is read as a Studio recording, which
          // the bubble never offers to discard.
          setState({ ...payload, dictation: payload.dictation === true });
        },
      );
      const offLevel = await listen<number>(BUBBLE_LEVEL_EVENT, (event) => {
        const level = Number(event.payload) || 0;
        levelsRef.current = pushLevel(levelsRef.current, level, BAR_COUNT);
        setLevels(levelsRef.current);
        if (level > 0.03) setHasLevels(true);
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
      setHasLevels(false);
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
        onContextMenu={(event) => {
          event.preventDefault();
          void send("open-app");
        }}
        aria-label={t("bubble.start", { hotkey: state.hotkey })}
        title={t("bubble.idleTitle", { hotkey: state.hotkey })}
      >
        <span className="bubble__orb" aria-hidden="true">
          <Mic size={13} strokeWidth={2} />
        </span>
        <span className="bubble__hint">
          {state.hotkey || t("bubble.dictate")}
        </span>
      </button>
    );
  }

  const elapsed =
    state.startedAt !== null ? formatElapsed(now - state.startedAt) : "0:00";
  const inProgress = phase === "listening" || phase === "transcribing";
  // Only a dictation is cancelled from here, with ✕ or Esc. A recording made
  // in the Studio can be stopped from the bubble, never thrown away.
  const cancellable = canCancel(phase, state.dictation);
  const stopLabel = state.dictation
    ? t("bubble.stop")
    : t("studio.transcribe.stopRecording");

  return (
    <div
      className="bubble-stack"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className={`bubble bubble--active bubble--${phase}`}
        role="status"
        aria-live="polite"
        aria-label={t(PHASE_LABELS[phase])}
      >
        {inProgress && !cancellable ? (
          <span className="bubble__spacer" />
        ) : (
          <button
            type="button"
            className="bubble__icon-btn"
            onClick={() => void send("cancel")}
            aria-label={cancellable ? t("bubble.cancel") : t("bubble.dismiss")}
            title={
              cancellable
                ? t("bubble.cancelTitle", { key: t("studio.keys.esc") })
                : t("bubble.dismiss")
            }
          >
            <X size={15} strokeWidth={2} />
          </button>
        )}

        <div className="bubble__center">
          {phase === "listening" || phase === "transcribing" ? (
            <div
              className={`bubble__wave ${
                phase === "transcribing"
                  ? "is-thinking"
                  : hasLevels
                    ? ""
                    : "is-ambient"
              }`}
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
              {t(PHASE_LABELS[phase])}
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
              aria-label={stopLabel}
              title={stopLabel}
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
