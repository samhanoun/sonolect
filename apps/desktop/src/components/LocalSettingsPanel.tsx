import { useEffect, useState } from "react";
import { Cpu, Shield, Download, CheckCircle2 } from "lucide-react";
import { useDesktopStore } from "../store/appStore";
import { isTauriRuntime } from "../desktopNative";
import { STT_LANGUAGES } from "../sttLanguages";

type ModelStatus = { path: string; ready: boolean; sizeBytes: number };
export default function LocalSettingsPanel() {
  const {
    privacyLevel,
    setPrivacyLevel,
    sttLanguage,
    setSttLanguage,
    whisperConfig,
    setWhisperConfig,
  } = useDesktopStore();
  const [status, setStatus] = useState<ModelStatus>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const native = isTauriRuntime();
  const inspect = async () => {
    if (!native) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setStatus(
        await invoke<ModelStatus>("local_model_status", {
          modelPath: whisperConfig.modelPath || null,
        }),
      );
    } catch (error) {
      setMessage(String(error));
    }
  };
  useEffect(() => {
    void inspect();
  }, [whisperConfig.modelPath]);
  const install = async () => {
    setBusy(true);
    setMessage("");
    setProgress(0);
    let unlisten: (() => void) | undefined;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<number>("local-model-progress", (event) =>
        setProgress(event.payload),
      );
      const model = await invoke<ModelStatus>("download_local_model");
      setWhisperConfig({
        ...whisperConfig,
        modelPath: model.path,
        modelName: "base",
        command: [],
      });
      setStatus(model);
      setMessage(
        "Model verified and installed. You can now disconnect from the internet.",
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      unlisten?.();
      setBusy(false);
    }
  };
  const card = "rounded-2xl border border-white/10 bg-[#101010] p-6 space-y-4";
  return (
    <div className="flex-1 overflow-y-auto p-10 space-y-6 text-slate-200">
      <header>
        <h2 className="text-3xl font-light">Local speech & privacy</h2>
        <p className="mt-2 text-sm text-slate-400">
          Your voice, processed on your computer.
        </p>
      </header>
      <section className={card}>
        <h3 className="flex gap-2 items-center">
          <Shield size={18} /> Processing mode
        </h3>
        <div className="flex gap-3">
          {(["local", "cloud"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setPrivacyLevel(mode)}
              aria-pressed={privacyLevel === mode}
              className={`px-5 py-3 rounded-xl border ${privacyLevel === mode ? "bg-white text-black" : "border-white/20"}`}
            >
              {mode === "local" ? "Local only" : "Allow cloud fallback"}
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-400">
          {privacyLevel === "local"
            ? "Dictation stays on this device. If local recognition fails, no cloud upload is attempted."
            : "Try the local model first. If unavailable, the configured cloud service may process your audio and text."}
        </p>
      </section>
      <section className={card}>
        <h3 className="flex gap-2 items-center">
          <Cpu size={18} /> Offline speech model
        </h3>
        <p className="text-sm text-slate-400">
          Whisper Base · multilingual · 148 MB · CPU processing. Download once,
          then use without an account or internet.
        </p>
        {!native && (
          <p role="status" className="text-amber-300 text-sm">
            This is the browser preview. Run the desktop app to install a model
            and transcribe locally.
          </p>
        )}
        <button
          onClick={() => void install()}
          disabled={busy || !native}
          className="flex items-center gap-2 bg-white text-black px-5 py-3 rounded-xl disabled:opacity-40"
        >
          <Download size={16} />
          {busy ? `Downloading ${progress}%` : "Download & verify model"}
        </button>
        {busy && (
          <progress
            className="w-full"
            aria-label="Model download progress"
            max={100}
            value={progress}
          />
        )}
        {status && (
          <p
            className={`text-sm flex gap-2 items-center ${status.ready ? "text-emerald-300" : "text-amber-300"}`}
          >
            <CheckCircle2 size={16} />
            {status.ready
              ? "Model file available. Ready for local dictation."
              : "No usable model found. Download one or choose an existing model below."}
          </p>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-400">
            Use an existing Whisper model
          </summary>
          <label htmlFor="local-model-path" className="block mt-4 mb-2">
            Model file path (.bin)
          </label>
          <input
            id="local-model-path"
            className="w-full bg-black rounded-lg border border-white/20 p-3"
            placeholder="C:/Models/ggml-base.bin"
            value={whisperConfig.modelPath}
            onChange={(event) =>
              setWhisperConfig({
                ...whisperConfig,
                modelPath: event.target.value,
              })
            }
          />
          <p className="text-xs text-slate-500 mt-2">
            Saved automatically. The speech engine validates the model when
            loading it.
          </p>
        </details>
        {message && (
          <p role="status" className="text-sm text-slate-300">
            {message}
          </p>
        )}
      </section>
      <section className={card}>
        <label htmlFor="stt-language" className="block">
          Dictation language
        </label>
        <select
          id="stt-language"
          value={sttLanguage}
          onChange={(event) => setSttLanguage(event.target.value)}
          className="bg-black rounded-lg p-3 border border-white/20 w-full"
        >
          {STT_LANGUAGES.map((language) => (
            <option key={language.code} value={language.code}>
              {language.nativeName} ({language.name})
            </option>
          ))}
        </select>
        <p className="text-sm text-slate-400">
          Local recordings are saved on this computer for retry. Delete them
          from Saved recordings when you no longer need them. This build limits
          each recording to three minutes.
        </p>
      </section>
    </div>
  );
}
