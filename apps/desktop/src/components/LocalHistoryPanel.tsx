import { useEffect, useState } from "react";
import { Mic, Copy, RotateCw, Trash2, Settings } from "lucide-react";
import { useDesktopStore } from "../store/appStore";
import { isTauriRuntime } from "../desktopNative";

type Capture = {
  id: string;
  createdAtMs: number;
  durationMs: number;
  transcript: string | null;
  error: string | null;
  language: string | null;
};
export default function LocalHistoryPanel() {
  const {
    recordingState,
    setActiveView,
    whisperConfig,
    sttLanguage,
    toggleRecording,
    setActiveSession,
  } = useDesktopStore();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState("");
  const refresh = async () => {
    if (!isTauriRuntime()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setCaptures(await invoke<Capture[]>("list_local_captures"));
    } catch (error) {
      setMessage(String(error));
    }
  };
  useEffect(() => {
    void refresh();
  }, [recordingState]);
  const retry = async (id: string) => {
    setBusy(id);
    setMessage("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("retry_local_capture", {
        id,
        modelPath: whisperConfig.modelPath || null,
        language: sttLanguage,
      });
    } catch (error) {
      setMessage(String(error));
    } finally {
      await refresh();
      setBusy(undefined);
    }
  };
  const remove = async (id: string) => {
    if (
      !window.confirm(
        "Delete this saved recording and its transcript from this computer?",
      )
    )
      return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("delete_local_capture", { id });
      await refresh();
    } catch (error) {
      setMessage(String(error));
    }
  };
  return (
    <div className="flex-1 overflow-y-auto p-10 text-slate-200 space-y-6">
      <header className="flex justify-between items-start gap-4">
        <div>
          <h2 className="text-3xl font-light">Saved recordings</h2>
          <p className="text-sm text-slate-400 mt-2">
            Local audio and transcripts. Available after a restart.
          </p>
        </div>
        <button
          onClick={() => setActiveView("settings")}
          className="flex items-center gap-2 text-sm border border-white/15 p-3 rounded-xl"
        >
          <Settings size={16} /> Speech setup
        </button>
      </header>
      {message && (
        <p role="status" className="text-sm text-amber-300">
          {message}
        </p>
      )}
      {!captures.length && (
        <div className="rounded-2xl border border-white/10 bg-[#101010] p-10 text-center space-y-4">
          <Mic className="mx-auto text-slate-500" size={36} />
          <h3>No recordings yet</h3>
          <p className="text-sm text-slate-400">
            Install your local model in Speech setup, then hold Ctrl+Shift+V to
            dictate.
          </p>
          <button
            onClick={toggleRecording}
            className="bg-white text-black rounded-xl px-6 py-3"
          >
            {recordingState === "recording"
              ? "Stop recording"
              : "Start recording"}
          </button>
          {!isTauriRuntime() && (
            <p className="text-xs text-amber-300">
              Browser preview — local recognition and saved audio require the
              desktop app.
            </p>
          )}
        </div>
      )}
      {captures.map((capture) => (
        <article
          key={capture.id}
          className="rounded-2xl border border-white/10 bg-[#101010] p-6 space-y-3"
        >
          <div className="flex justify-between text-xs text-slate-400">
            <span>{new Date(capture.createdAtMs).toLocaleString()}</span>
            <span>
              {Math.round(capture.durationMs / 1000)}s ·{" "}
              {capture.language || "auto"} · local
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {capture.transcript ||
              (capture.error
                ? "Transcription needs attention"
                : "No speech detected")}
          </p>
          {capture.error && (
            <p className="text-xs text-amber-300">{capture.error}</p>
          )}
          <div className="flex gap-5 text-xs pt-2">
            <button
              disabled={!capture.transcript}
              onClick={() =>
                setActiveSession(capture.id, capture.transcript || "")
              }
              className="disabled:opacity-30"
            >
              Edit &amp; format
            </button>
            <button
              disabled={!capture.transcript}
              onClick={() => {
                void navigator.clipboard
                  .writeText(capture.transcript || "")
                  .then(() => setMessage("Transcript copied."))
                  .catch(() =>
                    setMessage(
                      "Copy was blocked. Select the transcript to copy it manually.",
                    ),
                  );
              }}
              className="flex items-center gap-1 disabled:opacity-30"
            >
              <Copy size={14} /> Copy
            </button>
            <button
              disabled={!!busy || recordingState === "uploading"}
              onClick={() => void retry(capture.id)}
              className="flex items-center gap-1 disabled:opacity-30"
            >
              <RotateCw size={14} />
              {busy === capture.id ? "Transcribing…" : "Retry locally"}
            </button>
            <button
              disabled={!!busy}
              onClick={() => void remove(capture.id)}
              className="flex items-center gap-1 text-slate-400"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
