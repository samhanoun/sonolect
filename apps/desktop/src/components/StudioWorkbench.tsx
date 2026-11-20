import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Cpu,
  Download,
  FileAudio,
  Mic,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useDesktopStore } from "../store/appStore";
import { isTauriRuntime } from "../desktopNative";
import {
  nativeProviderCall,
  useProviderStore,
  speakUsingProvider,
  rewriteUsingProvider,
  transcribeUsingProvider,
} from "../providerSettings";
import { StudioModelSelector } from "./StudioModels";
import { submitCapturedAudioCloud } from "../voiceApi";
import { prepareLocalAudio } from "../localAudio";
import { STT_LANGUAGES } from "../sttLanguages";
import { loadBubbleVisibility, saveBubbleVisibility } from "../bubbleBridge";
import type { BubbleVisibility } from "../dictationBubble";
import {
  exportTranscript,
  type TranscriptExportFormat,
} from "../transcriptExport";
import {
  RETENTION_DAY_CHOICES,
  applyCaptureRetention,
  deleteAllLocalData,
  loadCaptureRetentionDays,
  retentionLabel,
  saveCaptureRetentionDays,
  type RetentionDays,
} from "../privacyControls";

const EXPORT_FORMATS: { id: TranscriptExportFormat; label: string }[] = [
  { id: "txt", label: "Plain text (.txt)" },
  { id: "md", label: "Markdown (.md)" },
  { id: "srt", label: "Subtitles (.srt)" },
  { id: "vtt", label: "Web subtitles (.vtt)" },
  { id: "json", label: "JSON with timings (.json)" },
];

const SIGNAL_BARS = [
  18, 30, 44, 26, 58, 72, 40, 64, 86, 52, 70, 94, 62, 80, 48, 90, 66, 76, 42,
  60, 84, 50, 68, 36, 56, 74, 32, 46, 24, 38, 20, 28,
];

/** The hero centerpiece: a signal meter that comes alive while dictating. */
function SignalMeter({ live }: { live: boolean }) {
  return (
    <div className={`studio-signal ${live ? "live" : ""}`} aria-hidden="true">
      <div className="studio-signal-head">
        <span className="studio-signal-dot" />
        <span>{live ? "Listening" : "Ready"}</span>
        <span className="studio-signal-meta">16 kHz · mono · on device</span>
      </div>
      <div className="studio-signal-bars">
        {SIGNAL_BARS.map((height, index) => (
          <i
            key={index}
            style={{
              height: `${height}%`,
              animationDelay: `${(index % 8) * 90}ms`,
            }}
          />
        ))}
      </div>
      <div className="studio-signal-scale">
        <span>-60</span>
        <span>-30</span>
        <span>-12</span>
        <span>0 dB</span>
      </div>
    </div>
  );
}
/** A status line that scrolls itself into view so feedback is never below the fold. */
function StatusNotice({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [text]);
  return (
    <p ref={ref} role="status" className="studio-notice">
      {text}
    </p>
  );
}

export type SavedCapture = {
  id: string;
  createdAtMs: number;
  durationMs: number;
  transcript: string | null;
  error: string | null;
  language: string | null;
};
export function useSavedCaptures() {
  const recordingState = useDesktopStore((state) => state.recordingState);
  const [captures, setCaptures] = useState<SavedCapture[]>([]);
  const [error, setError] = useState("");
  const refresh = async () => {
    if (!isTauriRuntime()) return;
    try {
      setCaptures(
        await nativeProviderCall<SavedCapture[]>("list_local_captures"),
      );
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    let cancelled = false;
    if (isTauriRuntime()) {
      // Enforce the retention setting whenever the list is refreshed.
      void applyCaptureRetention(nativeProviderCall)
        .catch(() => 0)
        .then(() => nativeProviderCall<SavedCapture[]>("list_local_captures"))
        .then((result) => {
          if (!cancelled) {
            setCaptures(result);
            setError("");
          }
        })
        .catch((error) => {
          if (!cancelled)
            setError(error instanceof Error ? error.message : String(error));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [recordingState]);
  return { captures, error, refresh };
}
export function StudioOverview({ captures }: { captures: SavedCapture[] }) {
  const { setActiveView, recordingState, toggleRecording } = useDesktopStore();
  const words = captures.reduce(
    (count, item) =>
      count +
      (item.transcript?.trim().split(/\s+/).filter(Boolean).length ?? 0),
    0,
  );
  return (
    <div className="studio-page">
      <div className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">A little less typing</p>
          <h1>Make room for your thoughts</h1>
          <p>Speak naturally. Turn your voice into something useful.</p>
        </div>
        <span className="studio-chip">Your personal workspace</span>
      </div>
      <div className="studio-hero">
        <div>
          <span className="studio-eyebrow">Start with your voice</span>
          <h2>
            Say it.
            <br />
            Let your ideas flow.
          </h2>
          <p>
            Capture a thought, write a message, or get a first draft down. Local
            recognition is ready when you are.
          </p>
          <button
            className="studio-button lime"
            onClick={() => {
              setActiveView("transcribe");
              toggleRecording();
            }}
          >
            <Mic size={17} />
            {recordingState === "recording"
              ? "Stop dictation"
              : "Start dictating"}
            <kbd>Ctrl ⇧ M</kbd>
          </button>
        </div>
        <SignalMeter live={recordingState === "recording"} />
      </div>
      <div className="studio-stat-grid">
        <div>
          <span>Recordings</span>
          <strong>{captures.length}</strong>
          <small>Saved on this device</small>
        </div>
        <div>
          <span>Words captured</span>
          <strong>{words.toLocaleString()}</strong>
          <small>From your saved transcripts</small>
        </div>
        <div>
          <span>Ready for another pass</span>
          <strong>{captures.filter((item) => item.error).length}</strong>
          <small>Recordings you can retry</small>
        </div>
      </div>
      <div className="studio-grid two">
        <button
          className="studio-action-card"
          onClick={() => setActiveView("speech")}
        >
          <div className="studio-icon">
            <Play size={22} />
          </div>
          <h3>Give your text a voice</h3>
          <p>Choose a speech model and listen to your writing.</p>
          <span>Open text to speech →</span>
        </button>
        <button
          className="studio-action-card"
          onClick={() => setActiveView("models")}
        >
          <div className="studio-icon">
            <Cpu size={22} />
          </div>
          <h3>A model for every task</h3>
          <p>
            Connect OpenRouter or OpenCode Zen. Keep local speech one click
            away.
          </p>
          <span>Explore models & voices →</span>
        </button>
      </div>
      <div className="studio-section-heading">
        <h2>Recent recordings</h2>
        <button
          className="studio-link"
          onClick={() => setActiveView("library")}
        >
          View library →
        </button>
      </div>
      {!captures.length ? (
        <div className="studio-empty compact">
          <FileAudio size={25} />
          <p>Your first recording will appear here.</p>
        </div>
      ) : (
        <div className="studio-card">
          {captures.slice(0, 3).map((item) => (
            <button
              className="studio-recent-row"
              key={item.id}
              onClick={() => setActiveView("library")}
            >
              <FileAudio size={18} />
              <span>
                {item.transcript?.slice(0, 90) || "Recording needs attention"}
              </span>
              <small>{new Date(item.createdAtMs).toLocaleDateString()}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function StudioTranscribe({
  onSaved,
}: {
  onSaved: () => Promise<void>;
}) {
  const state = useDesktopStore();
  const preferences = useProviderStore((s) => s.preferences);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [proposed, setProposed] = useState(""),
    [instruction, setInstruction] = useState(
      "Make this clear and concise without changing its meaning.",
    );
  const allowCloud = () => useDesktopStore.getState().privacyLevel === "cloud";
  const importAudio = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      if (file.size > 25 * 1024 * 1024)
        throw new Error("Choose an audio file under 25 MB and three minutes.");
      const wav = await prepareLocalAudio(file);
      const blob = new Blob([wav as Uint8Array<ArrayBuffer>], {
        type: "audio/wav",
      });
      const result = await submitCapturedAudioCloud(
        blob,
        {
          mimeType: "audio/wav",
          durationMs: (wav.length - 44) / 32,
          sizeBytes: wav.length,
        },
        {
          processingMode: state.privacyLevel,
          modelPath: state.whisperConfig.modelPath,
          language: state.sttLanguage,
          canUseCloud: allowCloud,
          ...(preferences.stt.provider !== "local"
            ? {
                cloudTranscriber: (
                  audio: Blob,
                  metadata: import("../voiceApi").VoiceCaptureMetadata,
                ) =>
                  transcribeUsingProvider(
                    audio,
                    metadata,
                    preferences.stt,
                    state.sttLanguage,
                    allowCloud,
                  ),
              }
            : {}),
        },
      );
      if (result.status !== "completed")
        throw new Error(result.message || "Transcription is not ready.");
      state.setTranscript(result.transcript || "");
      setMessage(
        result.transcript
          ? "Audio transcribed and saved."
          : "No speech was detected.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      await onSaved();
      if (input.current) input.current.value = "";
    }
  };
  const refine = async () => {
    setBusy(true);
    setMessage("");
    try {
      setProposed(
        await rewriteUsingProvider(
          state.transcript,
          instruction,
          preferences.text,
          allowCloud,
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const [exportFormat, setExportFormat] =
    useState<TranscriptExportFormat>("txt");
  const download = () => {
    const file = exportTranscript({
      format: exportFormat,
      transcript: state.transcript,
      segments: state.transcriptSegments,
      title: "Sonolect transcript",
    });
    const url = URL.createObjectURL(
      new Blob([file.content], { type: file.mimeType }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `sonolect-${file.filename}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="studio-page">
      <div className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">From thought to text</p>
          <h1>Find your flow</h1>
          <p>Record your voice, import audio, or work on your next draft.</p>
        </div>
        <button
          className="studio-button secondary"
          onClick={() => input.current?.click()}
          disabled={busy}
        >
          <Upload size={16} />
          Import audio
        </button>
        <input
          ref={input}
          type="file"
          accept="audio/*"
          hidden
          onChange={(event) => void importAudio(event.target.files?.[0])}
        />
      </div>
      <div className="studio-editor-layout">
        <section className="studio-card studio-editor">
          <div className="studio-section-heading">
            <h3>Your transcript</h3>
            <span className="studio-tag">
              {state.privacyLevel === "local" ? "Local only" : "Cloud enabled"}
            </span>
          </div>
          <textarea
            aria-label="Transcript editor"
            placeholder="Your words will appear here. You can also start typing…"
            value={state.transcript}
            onChange={(event) => state.setTranscript(event.target.value)}
          />
          <div className="studio-editor-footer">
            <span>
              {state.transcript.trim()
                ? state.transcript.trim().split(/\s+/).length
                : 0}{" "}
              words
            </span>
            <div>
              <button
                className="studio-link"
                disabled={!state.canUndoTranscript}
                onClick={state.undoTranscriptEdit}
              >
                Undo
              </button>
              <button
                className="studio-link"
                disabled={!state.canRedoTranscript}
                onClick={state.redoTranscriptEdit}
              >
                Redo
              </button>
            </div>
          </div>
          <div className="studio-editor-actions">
            <button
              className="studio-button"
              onClick={() => state.toggleRecording()}
              disabled={busy || state.recordingState === "uploading"}
            >
              <Mic size={17} />
              {state.recordingState === "recording"
                ? "Stop recording"
                : "Record to add text"}
            </button>
            <button
              className="studio-button secondary"
              disabled={!state.transcript}
              onClick={() =>
                void navigator.clipboard
                  .writeText(state.transcript)
                  .then(() => setMessage("Transcript copied."))
                  .catch(() =>
                    setMessage(
                      "Copy was blocked. Select the text to copy it manually.",
                    ),
                  )
              }
            >
              <Copy size={16} />
              Copy
            </button>
            <select
              className="studio-export-format"
              aria-label="Export format"
              value={exportFormat}
              onChange={(event) =>
                setExportFormat(event.target.value as TranscriptExportFormat)
              }
            >
              {EXPORT_FORMATS.map((format) => (
                <option key={format.id} value={format.id}>
                  {format.label}
                </option>
              ))}
            </select>
            <button
              className="studio-icon-button"
              aria-label="Export transcript"
              title="Export transcript"
              disabled={!state.transcript}
              onClick={download}
            >
              <Download size={17} />
            </button>
          </div>
          {(message || state.voiceError) && (
            <StatusNotice text={message || state.voiceError || ""} />
          )}
        </section>
        <aside className="studio-editor-tools">
          <section className="studio-card">
            <h3>Recognition</h3>
            <StudioModelSelector task="stt" inlineStatus />
            <label>
              Language
              <select
                value={state.sttLanguage}
                onChange={(event) => state.setSttLanguage(event.target.value)}
              >
                {STT_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.nativeName}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="studio-card">
            <h3>
              <Sparkles size={16} /> A little polish
            </h3>
            <p className="studio-muted">
              Apply your dictionary and conservative local formatting.
            </p>
            <button
              className="studio-button secondary full"
              disabled={!state.transcript}
              onClick={state.applyPolishedPreview}
            >
              Clean up locally
            </button>
            <details className="studio-details">
              <summary>Refine with an online model</summary>
              <label>
                Editing instruction
                <input
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                />
              </label>
              <button
                className="studio-button full"
                disabled={busy || !state.transcript}
                onClick={() => void refine()}
              >
                <WandSparkles size={15} />
                {busy ? "Working…" : "Preview online edit"}
              </button>
              <button
                className="studio-link"
                onClick={() => state.setActiveView("models")}
              >
                Choose editing model →
              </button>
            </details>
          </section>
        </aside>
      </div>
      {proposed && (
        <section className="studio-card">
          <h3>Review the suggested edit</h3>
          <p className="studio-transcript-preview">{proposed}</p>
          <button
            className="studio-button"
            onClick={() => {
              state.setTranscript(proposed);
              setProposed("");
            }}
          >
            Apply edit
          </button>
          <button
            className="studio-button ghost"
            onClick={() => setProposed("")}
          >
            Keep original
          </button>
        </section>
      )}
    </div>
  );
}

export function StudioSpeech() {
  const [format, setFormat] = useState<"mp3" | "pcm">("mp3");
  const [sampleRate, setSampleRate] = useState(24000);
  const [extension, setExtension] = useState("mp3");
  const [text, setText] = useState(""),
    [url, setUrl] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const { preferences, models, setVoice } = useProviderStore();
  const mode = useDesktopStore((s) => s.privacyLevel);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const selected = models.openrouter.find(
    (model) => model.id === preferences.tts.model,
  );
  const generate = async () => {
    setBusy(true);
    setMessage("");
    try {
      const blob = await speakUsingProvider(
        text,
        preferences.tts,
        preferences.voice,
        () => useDesktopStore.getState().privacyLevel === "cloud",
        format,
        sampleRate,
      );
      if (mounted.current) {
        setUrl(URL.createObjectURL(blob));
        setExtension(blob.type === "audio/wav" ? "wav" : "mp3");
      }
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="studio-page">
      <div className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">Words worth hearing</p>
          <h1>Give your writing a voice</h1>
          <p>Pick a model, find a voice, and listen before you share.</p>
        </div>
      </div>
      <div className="studio-editor-layout">
        <section className="studio-card studio-editor">
          <div className="studio-section-heading">
            <h3>What would you like to hear?</h3>
            <span className="studio-tag">Text to speech</span>
          </div>
          <textarea
            aria-label="Text to speak"
            maxLength={12000}
            placeholder="Paste a script, a message, or a passage you want to listen to…"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="studio-editor-footer">
            <span>{text.length.toLocaleString()} / 12,000 characters</span>
          </div>
          <div className="studio-editor-actions">
            <button
              className="studio-button"
              disabled={!text.trim() || busy}
              onClick={() => void generate()}
            >
              <Play size={16} />
              {busy ? "Generating speech…" : "Generate speech"}
            </button>
            {url && (
              <a
                className="studio-button secondary"
                href={url}
                download={`sonolect-speech.${extension}`}
              >
                <Download size={16} />
                Download {extension.toUpperCase()}
              </a>
            )}
          </div>
          {url && <audio className="studio-audio" controls src={url} />}
          {mode === "local" && (
            <p className="studio-notice">
              Local only is selected. Switch the processing control to Cloud
              enabled before generating online speech.
            </p>
          )}
          {message && <StatusNotice text={message} />}
        </section>
        <aside className="studio-editor-tools">
          <section className="studio-card">
            <h3>Model & voice</h3>
            <StudioModelSelector task="tts" inlineStatus />
            <label>
              Audio format
              <select
                value={format}
                onChange={(event) =>
                  setFormat(event.target.value as "mp3" | "pcm")
                }
              >
                <option value="mp3">MP3</option>
                <option value="pcm">PCM → playable WAV</option>
              </select>
            </label>
            {format === "pcm" && (
              <label>
                PCM sample rate
                <select
                  value={sampleRate}
                  onChange={(event) =>
                    setSampleRate(Number(event.target.value))
                  }
                >
                  {[16000, 22050, 24000, 44100, 48000].map((rate) => (
                    <option value={rate} key={rate}>
                      {rate.toLocaleString()} Hz
                    </option>
                  ))}
                </select>
                <small>
                  16-bit mono. Match the selected model's output rate.
                </small>
              </label>
            )}
            <p className="studio-muted">
              Gemini and HeyGen speech models require PCM. Other models may
              require MP3.
            </p>
            <label>
              Voice
              {selected?.voices.length ? (
                <select
                  value={preferences.voice}
                  onChange={(event) => setVoice(event.target.value)}
                >
                  <option value="">Provider default, if supported</option>
                  {selected.voices.map((voice) => (
                    <option key={voice} value={voice}>
                      {voice}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  placeholder="Voice ID, or leave blank for a provider default"
                  value={preferences.voice}
                  onChange={(event) => setVoice(event.target.value)}
                />
              )}
            </label>
            <p className="studio-muted">
              Available voices depend on the model. If a model has no default,
              enter one of its supported voice IDs.
            </p>
          </section>
          <section className="studio-local-callout small">
            <Cpu size={22} />
            <p>
              Local speech recognition remains available. Online speech
              generation uses your OpenRouter account.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function StudioLibrary({
  captures,
  refresh,
  error,
}: {
  captures: SavedCapture[];
  refresh: () => Promise<void>;
  error: string;
}) {
  const [query, setQuery] = useState(""),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("");
  const state = useDesktopStore();
  const retry = async (id: string) => {
    setBusy(id);
    try {
      await nativeProviderCall("retry_local_capture", {
        id,
        modelPath: state.whisperConfig.modelPath || null,
        language: state.sttLanguage,
      });
      setMessage("Recording transcribed locally.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      await refresh();
      setBusy("");
    }
  };
  const remove = async (id: string) => {
    if (
      !window.confirm(
        "Delete this recording and its transcript from this device?",
      )
    )
      return;
    try {
      await nativeProviderCall("delete_local_capture", { id });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const visible = captures.filter((item) =>
    (item.transcript || item.error || "")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="studio-page">
      <div className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">A place for every thought</p>
          <h1>Your voice library</h1>
          <p>
            Saved recordings, ready to revisit. Audio stays here until you
            delete it.
          </p>
        </div>
        <button
          className="studio-button secondary"
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      <input
        className="studio-search"
        aria-label="Search saved recordings"
        placeholder="Search your recordings…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {(message || error) && (
        <p className="studio-notice" role="status">
          {message || error}
        </p>
      )}
      {!visible.length ? (
        <div className="studio-empty">
          <FileAudio size={38} />
          <h3>{query ? "No matching recordings" : "A fresh start."}</h3>
          <p>
            {query
              ? "Try a different word."
              : "Your recordings will appear here after you dictate or import audio in the Windows app."}
          </p>
          <button
            className="studio-button"
            onClick={() => state.setActiveView("transcribe")}
          >
            Create your first recording
          </button>
        </div>
      ) : (
        <div className="studio-library-list">
          {visible.map((item) => (
            <article key={item.id} className="studio-card">
              <div className="studio-section-heading">
                <span className="studio-muted">
                  {new Date(item.createdAtMs).toLocaleString()} ·{" "}
                  {Math.round(item.durationMs / 1000)}s
                </span>
                <span
                  className={`studio-tag ${item.error ? "amber" : "green"}`}
                >
                  {item.error ? "Retry needed" : "Saved on device"}
                </span>
              </div>
              <p className="studio-transcript-preview">
                {item.transcript || "No transcript yet."}
              </p>
              {item.error && <p className="studio-muted">{item.error}</p>}
              <div className="studio-card-actions">
                <button
                  className="studio-link"
                  disabled={!item.transcript}
                  onClick={() => {
                    state.setTranscript(item.transcript || "");
                    state.setActiveView("transcribe");
                  }}
                >
                  Open editor →
                </button>
                <button
                  className="studio-link"
                  disabled={!item.transcript}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(item.transcript || "")
                      .then(() => setMessage("Transcript copied."))
                      .catch(() => setMessage("Copy was blocked."))
                  }
                >
                  <Copy size={14} />
                  Copy
                </button>
                <button
                  className="studio-link"
                  disabled={!!busy}
                  onClick={() => void retry(item.id)}
                >
                  <RefreshCw size={14} />
                  {busy === item.id ? "Transcribing…" : "Retry locally"}
                </button>
                <button
                  className="studio-link muted"
                  disabled={!!busy}
                  onClick={() => void remove(item.id)}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function StudioVocabulary({ snippets = false }: { snippets?: boolean }) {
  const state = useDesktopStore();
  const [first, setFirst] = useState(""),
    [second, setSecond] = useState("");
  const items = snippets
    ? state.snippets.map((item) => ({
        id: item.id,
        first: item.trigger,
        second: item.body,
      }))
    : state.dictionaryEntries.map((item) => ({
        id: item.id,
        first: item.spoken,
        second: item.replacement,
      }));
  const add = () => {
    if (!first.trim() || !second.trim()) return;
    if (snippets) state.addSnippet(first, second);
    else state.addDictionaryEntry(first, second);
    setFirst("");
    setSecond("");
  };
  return (
    <div className="studio-page">
      <div className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">Sounds like you</p>
          <h1>
            {snippets ? "Say less, write more" : "Your words, spelled right"}
          </h1>
          <p>
            {snippets
              ? "Save reusable text blocks for local expansion in your drafts."
              : "Teach local formatting the names, terms, and spellings you use."}
          </p>
        </div>
      </div>
      <section className="studio-card">
        <div className="studio-form-grid">
          <label>
            {snippets ? "Shortcut" : "Spoken or recognized spelling"}
            <input
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              placeholder={
                snippets ? "/signature" : "A word that needs correcting"
              }
            />
          </label>
          <label>
            {snippets ? "Text to insert" : "Preferred spelling"}
            <input
              value={second}
              onChange={(e) => setSecond(e.target.value)}
              placeholder={
                snippets ? "Your reusable text" : "How it should appear"
              }
            />
          </label>
          <button
            className="studio-button"
            onClick={add}
            disabled={!first.trim() || !second.trim()}
          >
            Add {snippets ? "snippet" : "word"}
          </button>
        </div>
      </section>
      <div className="studio-section-heading">
        <h2>{snippets ? "Your snippets" : "Personal dictionary"}</h2>
        <span className="studio-muted">
          {items.length} entries · stored locally
        </span>
      </div>
      {items.length ? (
        <section className="studio-card">
          {items.map((item) => (
            <div className="studio-vocabulary-row" key={item.id}>
              <strong>{item.first}</strong>
              <span>→</span>
              <p>{item.second}</p>
              <button
                className="studio-icon-button"
                aria-label={`Delete ${item.first}`}
                onClick={() =>
                  snippets
                    ? state.removeSnippet(item.id)
                    : state.removeDictionaryEntry(item.id)
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </section>
      ) : (
        <div className="studio-empty compact">
          <p>No entries yet. Add one above to personalize your drafts.</p>
        </div>
      )}
    </div>
  );
}

function PrivacyControls() {
  const recordingState = useDesktopStore((s) => s.recordingState);
  const [retention, setRetention] = useState<RetentionDays>(() =>
    loadCaptureRetentionDays(),
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const native = isTauriRuntime();
  const capturing =
    recordingState === "recording" ||
    recordingState === "uploading" ||
    recordingState === "requesting-permission";
  const changeRetention = async (days: RetentionDays) => {
    setRetention(days);
    saveCaptureRetentionDays(days);
    if (!native || days === 0) {
      setMessage(
        days === 0
          ? "Recordings are kept until you delete them."
          : "Saved. It applies in the Windows app.",
      );
      return;
    }
    try {
      const removed = await applyCaptureRetention(nativeProviderCall, days);
      setMessage(
        removed
          ? `Saved. Deleted ${removed} recording${removed === 1 ? "" : "s"} older than ${retentionLabel(days)}.`
          : `Saved. Recordings older than ${retentionLabel(days)} are deleted automatically.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const deleteEverything = async () => {
    if (
      !window.confirm(
        "Delete all your recordings, transcripts, dictionary, snippets, saved API keys and settings from this device? This cannot be undone.",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const result = await deleteAllLocalData(
        native
          ? nativeProviderCall
          : async <T,>() =>
              0 as unknown as T /* browser preview: nothing native */,
      );
      if (result.problems.length) {
        setMessage(
          `Some data could not be deleted: ${result.problems.join("; ")}`,
        );
        return;
      }
      // Start again from a clean state, exactly like a first launch.
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="studio-card studio-privacy">
      <div className="studio-card-heading">
        <div className="studio-icon">
          <ShieldCheck size={25} />
        </div>
        <div>
          <h3>Privacy & retention</h3>
          <p>
            Recordings and transcripts never leave this device in Local only.
          </p>
        </div>
      </div>
      <div className="studio-privacy-actions">
        <label>
          Keep recordings
          <select
            value={retention}
            onChange={(event) =>
              void changeRetention(Number(event.target.value) as RetentionDays)
            }
          >
            {RETENTION_DAY_CHOICES.map((days) => (
              <option key={days} value={days}>
                {retentionLabel(days)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="studio-button danger"
          disabled={busy || capturing}
          onClick={() => void deleteEverything()}
        >
          <Trash2 size={15} />
          {busy ? "Deleting…" : "Delete all my data"}
        </button>
      </div>
      <p className="studio-muted">
        Deletes recordings, transcripts, your dictionary and snippets, saved API
        keys and settings. Downloaded speech models are kept.
      </p>
      {message && (
        <p role="status" className="studio-notice">
          {message}
        </p>
      )}
    </section>
  );
}

export function StudioSettings() {
  const state = useDesktopStore();
  const [bubbleVisibility, setBubbleVisibility] =
    useState<BubbleVisibility>(loadBubbleVisibility);
  const [model, setModel] = useState<{ ready: boolean; path: string }>(),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (isTauriRuntime()) {
      void nativeProviderCall<{ ready: boolean; path: string }>(
        "local_model_status",
        { modelPath: state.whisperConfig.modelPath || null },
      )
        .then((result) => {
          if (!cancelled) setModel(result);
        })
        .catch((error) => {
          if (!cancelled)
            setMessage(error instanceof Error ? error.message : String(error));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [state.whisperConfig.modelPath]);
  const install = async () => {
    setBusy(true);
    setMessage("");
    let unlisten: (() => void) | undefined;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<number>("local-model-progress", (event) =>
        setProgress(event.payload),
      );
      const result = await nativeProviderCall<{ ready: boolean; path: string }>(
        "download_local_model",
      );
      state.setWhisperConfig({
        ...state.whisperConfig,
        modelName: "base",
        modelPath: result.path,
        command: [],
      });
      setModel(result);
      setMessage(
        "Model downloaded and checksum verified. You can use it offline.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      unlisten?.();
      setBusy(false);
    }
  };
  return (
    <div className="studio-page">
      <div className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">Your space, your rules</p>
          <h1>Make yourself at home</h1>
          <p>Local models, language, and privacy in one place.</p>
        </div>
      </div>
      <div className="studio-grid two">
        <section className="studio-card">
          <div className="studio-card-heading">
            <div className="studio-icon">
              <Cpu size={25} />
            </div>
            <div>
              <h3>Local Whisper</h3>
              <p>Multilingual Base · CPU · 148 MB</p>
            </div>
          </div>
          <p className="studio-muted">
            {model?.ready
              ? "A local model is available on this computer."
              : "Install a model once, then dictate without an internet connection."}
          </p>
          <button
            className="studio-button"
            disabled={!isTauriRuntime() || busy}
            onClick={() => void install()}
          >
            <Download size={15} />
            {busy
              ? `Downloading ${progress}%`
              : model?.ready
                ? "Reinstall verified model"
                : "Install local model"}
          </button>
          {busy && (
            <progress max={100} value={progress} className="studio-progress" />
          )}
          <details className="studio-details">
            <summary>Use an existing model</summary>
            <label>
              Whisper .bin file path
              <input
                value={state.whisperConfig.modelPath}
                onChange={(e) =>
                  state.setWhisperConfig({
                    ...state.whisperConfig,
                    modelPath: e.target.value,
                  })
                }
              />
            </label>
          </details>
        </section>
        <section className="studio-card">
          <h3>Language & processing</h3>
          <label>
            Dictation language
            <select
              value={state.sttLanguage}
              onChange={(e) => state.setSttLanguage(e.target.value)}
            >
              {STT_LANGUAGES.map((language) => (
                <option value={language.code} key={language.code}>
                  {language.nativeName === language.name
                    ? language.name
                    : `${language.nativeName} (${language.name})`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Processing mode
            <select
              value={state.privacyLevel}
              onChange={(e) =>
                state.setPrivacyLevel(e.target.value as "local" | "cloud")
              }
            >
              <option value="local">Local only</option>
              <option value="cloud">Cloud enabled</option>
            </select>
          </label>
          <p className="studio-muted">
            Local only blocks online audio and text processing. Model catalog
            lookups and downloads are separate actions.
          </p>
        </section>
      </div>
      <section className="studio-card" aria-labelledby="bubble-settings">
        <h3 id="bubble-settings">Dictation bubble</h3>
        <p className="studio-muted">
          Press Ctrl + Shift + M (or hold Ctrl + Shift + V) in any app. A
          floating bubble shows Sonolect is listening, then your words are
          pasted where your cursor is. Click the bubble to start or stop, Esc to
          cancel, right-click it to open Sonolect.
        </p>
        <label>
          Show the bubble
          <select
            value={bubbleVisibility}
            onChange={(e) => {
              const next = e.target.value as BubbleVisibility;
              setBubbleVisibility(next);
              saveBubbleVisibility(next);
            }}
          >
            <option value="always">Always (small pill when idle)</option>
            <option value="dictating">Only while dictating</option>
            <option value="off">Off</option>
          </select>
        </label>
      </section>
      <PrivacyControls />
      <section className="studio-card">
        <h3>Shortcuts & storage</h3>
        <div className="studio-workflow-row">
          <span>Toggle recording</span>
          <kbd>Ctrl + Shift + M</kbd>
        </div>
        <div className="studio-workflow-row">
          <span>Hold to talk</span>
          <kbd>Ctrl + Shift + V</kbd>
        </div>
        <div className="studio-workflow-row">
          <span>Cancel dictation</span>
          <kbd>Esc</kbd>
        </div>
        <div className="studio-workflow-row">
          <span>Quick navigation</span>
          <kbd>Ctrl + K</kbd>
        </div>
        <p className="studio-muted">
          Recordings are limited to three minutes and saved on this device for
          as long as you choose above. API keys use Windows Credential Manager.
        </p>
      </section>
      {message && (
        <p role="status" className="studio-notice">
          {message}
        </p>
      )}
      {!isTauriRuntime() && (
        <p className="studio-notice">
          This is the browser preview. Model installation and local speech run
          in the Windows app.
        </p>
      )}
    </div>
  );
}
