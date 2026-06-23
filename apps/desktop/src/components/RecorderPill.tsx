import { useEffect, useState } from "react";
import { Mic, X, Check } from "lucide-react";
import { useDesktopStore } from "../store/appStore";
import { formatDuration } from "../lib/format";

const BARS = [0.3, 0.6, 0.9, 0.5, 0.8, 0.4, 0.7, 0.5];

/**
 * In-window dictation pill, ported to the migrated Tailwind design. Mirrors the
 * Wispr-style capsule: live waveform with cancel (X) and confirm (check).
 */
export default function RecorderPill() {
  const recordingState = useDesktopStore((s) => s.recordingState);
  const voiceError = useDesktopStore((s) => s.voiceError);
  const toggleRecording = useDesktopStore((s) => s.toggleRecording);
  const resetVoiceCapture = useDesktopStore((s) => s.resetVoiceCapture);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (recordingState !== "recording") {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 200);
    return () => clearInterval(id);
  }, [recordingState]);

  useEffect(() => {
    if (recordingState !== "error") return;
    const id = setTimeout(() => resetVoiceCapture(), 3000);
    return () => clearTimeout(id);
  }, [recordingState, resetVoiceCapture]);

  if (recordingState === "idle") return null;

  const isRecording = recordingState === "recording";
  const isProcessing =
    recordingState === "requesting-permission" ||
    recordingState === "uploading";
  const isDone = recordingState === "completed" || recordingState === "error";

  const status = isRecording
    ? formatDuration(elapsed)
    : recordingState === "requesting-permission"
      ? "Permitting…"
      : recordingState === "uploading"
        ? "Processing…"
        : recordingState === "completed"
          ? "Done"
          : "Error";

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-full bg-[#0C0C0C]/95 border border-white/10 shadow-2xl backdrop-blur"
      role="status"
      aria-label="Dictation recorder"
      id="recorder-pill"
    >
      {isDone ? (
        <button
          type="button"
          onClick={resetVoiceCapture}
          className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      ) : (
        <span
          className={`w-2.5 h-2.5 rounded-full ${
            isRecording ? "bg-red-500 animate-pulse" : "bg-slate-500"
          }`}
        />
      )}

      <div className="flex items-end gap-0.5 h-5" aria-hidden="true">
        {BARS.map((h, i) => (
          <span
            key={i}
            className={`w-0.5 rounded-full ${isRecording ? "bg-cyan-400 animate-pulse" : "bg-slate-600"}`}
            style={{
              height: `${Math.round((isRecording ? h : 0.25) * 20)}px`,
              animationDelay: `${i * 80}ms`,
            }}
          />
        ))}
      </div>

      <span className="text-xs font-mono text-slate-300 min-w-[3ch] text-center">
        {status}
      </span>
      {voiceError && isDone && (
        <span className="text-[10px] text-red-400 max-w-[16ch] truncate">
          {voiceError}
        </span>
      )}

      <button
        type="button"
        disabled={isProcessing}
        onClick={toggleRecording}
        className="w-7 h-7 rounded-full flex items-center justify-center bg-white text-black hover:bg-slate-200 disabled:opacity-40 transition-all"
        aria-label={isRecording ? "Finish" : "Record again"}
      >
        {isRecording ? (
          <Check className="w-4 h-4" />
        ) : (
          <Mic className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}
