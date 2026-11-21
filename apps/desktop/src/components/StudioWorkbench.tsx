import { useEffect, useRef, useState } from "react";
import {
  Archive,
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
import { subscribeMicLevel, useDesktopStore } from "../store/appStore";
import { isTauriRuntime } from "../desktopNative";
import {
  nativeProviderCall,
  setProviderMode,
  useProviderStore,
  speakUsingProvider,
  rewriteUsingProvider,
  transcribeUsingProvider,
} from "../providerSettings";
import { MicrophoneSettings } from "./StudioMicrophone";
import { StudioSync } from "./StudioSync";
import { StudioModelSelector } from "./StudioModels";
import { SegmentEditor, useCapturePlayer } from "./StudioSegments";
import {
  formatTimestamp,
  singleCaptureId,
  type SavedCaptureSegment,
} from "../segmentEditor";
import { submitCapturedAudioCloud } from "../voiceApi";
import { prepareLocalAudio } from "../localAudio";
import { copyTranscript } from "../richClipboard";
import {
  CAPTURE_FORMATS,
  applyCaptureFormat,
  compressCaptures,
  formatSize,
  loadCaptureFormat,
  saveCaptureFormat,
  type CaptureFormat,
} from "../captureStorage";
import { transcribeAudioFile } from "../liveCaptureNative";
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
import { rememberAudioless } from "../captureAudio";
import {
  getSyncController,
  useSyncView,
  useSyncedNotes,
} from "../sync/useSync";
import { syncActionErrorText } from "../sync/syncMessages";
import {
  LAUNCH_LOCALES,
  LOCALE_NAMES,
  languageName,
  useT,
  type LaunchLocale,
  type LocaleKeys,
  type SupportedLocale,
} from "../i18n";

const EXPORT_FORMATS: { id: TranscriptExportFormat; label: LocaleKeys }[] = [
  { id: "txt", label: "studio.export.txt" },
  { id: "md", label: "studio.export.md" },
  { id: "srt", label: "studio.export.srt" },
  { id: "vtt", label: "studio.export.vtt" },
  { id: "json", label: "studio.export.json" },
];

const countWords = (text: string) =>
  text.trim() ? text.trim().split(/\s+/).length : 0;

const SIGNAL_BARS = [
  18, 30, 44, 26, 58, 72, 40, 64, 86, 52, 70, 94, 62, 80, 48, 90, 66, 76, 42,
  60, 84, 50, 68, 36, 56, 74, 32, 46, 24, 38, 20, 28,
];

/** The hero centerpiece: a signal meter that comes alive while dictating. */
function SignalMeter({ live }: { live: boolean }) {
  const t = useT();
  const bars = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The bars follow the microphone: they rise at once and fall slowly, so
    // a pause between words does not flatten them. Without levels (no meter
    // in this webview) they keep their own movement.
    let shown = 0;
    const unsubscribe = subscribeMicLevel((level) => {
      shown = Math.max(level, shown * 0.85);
      bars.current?.style.setProperty(
        "--signal-level",
        (0.2 + 0.8 * shown).toFixed(2),
      );
    });
    const element = bars.current;
    return () => {
      unsubscribe();
      element?.style.removeProperty("--signal-level");
    };
  }, []);
  return (
    <div className={`studio-signal ${live ? "live" : ""}`} aria-hidden="true">
      <div className="studio-signal-head">
        <span className="studio-signal-dot" />
        <span>
          {live ? t("studio.signal.listening") : t("studio.signal.ready")}
        </span>
        <span className="studio-signal-meta">{t("studio.signal.meta")}</span>
      </div>
      <div className="studio-signal-bars" ref={bars}>
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
  /** Timed segments; recordings saved by older versions have none. */
  segments?: SavedCaptureSegment[];
  /** False for a note that came through sync: its recording stays on the device that made it. */
  hasAudio?: boolean;
  /** Fields a note synced from another device may carry. */
  title?: string;
  refinedText?: string;
  pinned?: boolean;
  /** The app that made the note ("desktop" or "mobile"); absent: this one. */
  origin?: string;
  /** On a conflict copy: the note it was copied from. */
  conflictOf?: string;
  updatedAtMs?: number;
};
/** Lists the library, and remembers which notes have no audio here. */
async function listSavedCaptures(): Promise<SavedCapture[]> {
  const captures = await nativeProviderCall<SavedCapture[]>(
    "list_local_captures",
  );
  rememberAudioless(captures);
  return captures;
}
export function useSavedCaptures() {
  const recordingState = useDesktopStore((state) => state.recordingState);
  // Bumped when sync wrote notes here.
  const synced = useSyncedNotes((state) => state.version);
  const [captures, setCaptures] = useState<SavedCapture[]>([]);
  const [error, setError] = useState("");
  const refresh = async () => {
    if (!isTauriRuntime()) return;
    try {
      setCaptures(await listSavedCaptures());
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    let cancelled = false;
    if (isTauriRuntime()) {
      // With compressed storage, a recording that just finished is turned
      // into Opus in the background; the list does not wait for it.
      // A recording in progress is skipped by the recorder itself.
      if (["idle", "completed", "error"].includes(recordingState))
        void applyCaptureFormat(nativeProviderCall).catch(() => undefined);
      // Enforce the retention setting whenever the list is refreshed.
      void applyCaptureRetention(nativeProviderCall)
        .catch(() => 0)
        .then(listSavedCaptures)
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
  }, [recordingState, synced]);
  return { captures, error, refresh };
}
export function StudioOverview({ captures }: { captures: SavedCapture[] }) {
  const { setActiveView, recordingState, toggleRecording } = useDesktopStore();
  const t = useT();
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
          <p className="studio-eyebrow">{t("studio.overview.eyebrow")}</p>
          <h1>{t("studio.overview.title")}</h1>
          <p>{t("studio.overview.subtitle")}</p>
        </div>
        <span className="studio-chip">{t("studio.overview.chip")}</span>
      </div>
      <div className="studio-hero">
        <div>
          <span className="studio-eyebrow">
            {t("studio.overview.heroEyebrow")}
          </span>
          <h2>
            {t("studio.overview.heroTitle1")}
            <br />
            {t("studio.overview.heroTitle2")}
          </h2>
          <p>{t("studio.overview.heroBody")}</p>
          <button
            className="studio-button lime"
            onClick={() => {
              setActiveView("transcribe");
              toggleRecording();
            }}
          >
            <Mic size={17} />
            {recordingState === "recording"
              ? t("studio.dictation.stop")
              : t("studio.dictation.start")}
            <kbd>Ctrl ⇧ M</kbd>
          </button>
        </div>
        <SignalMeter live={recordingState === "recording"} />
      </div>
      <div className="studio-stat-grid">
        <div>
          <span>{t("studio.overview.statRecordings")}</span>
          <strong>{captures.length.toLocaleString(t.locale)}</strong>
          <small>{t("studio.overview.statRecordingsHint")}</small>
        </div>
        <div>
          <span>{t("studio.overview.statWords")}</span>
          <strong>{words.toLocaleString(t.locale)}</strong>
          <small>{t("studio.overview.statWordsHint")}</small>
        </div>
        <div>
          <span>{t("studio.overview.statRetry")}</span>
          <strong>{captures.filter((item) => item.error).length}</strong>
          <small>{t("studio.overview.statRetryHint")}</small>
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
          <h3>{t("studio.overview.ttsTitle")}</h3>
          <p>{t("studio.overview.ttsBody")}</p>
          <span>{t("studio.overview.ttsLink")}</span>
        </button>
        <button
          className="studio-action-card"
          onClick={() => setActiveView("models")}
        >
          <div className="studio-icon">
            <Cpu size={22} />
          </div>
          <h3>{t("studio.overview.modelsTitle")}</h3>
          <p>{t("studio.overview.modelsBody")}</p>
          <span>{t("studio.overview.modelsLink")}</span>
        </button>
      </div>
      <div className="studio-section-heading">
        <h2>{t("studio.overview.recent")}</h2>
        <button
          className="studio-link"
          onClick={() => setActiveView("library")}
        >
          {t("studio.overview.viewLibrary")}
        </button>
      </div>
      {!captures.length ? (
        <div className="studio-empty compact">
          <FileAudio size={25} />
          <p>{t("studio.overview.empty")}</p>
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
                {item.transcript?.slice(0, 90) || t("studio.dock.error")}
              </span>
              <small>
                {new Date(item.createdAtMs).toLocaleDateString(t.locale)}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Whether a recording is being made or finished right now. */
function isCapturing(recordingState: string) {
  return ["requesting-permission", "recording", "uploading"].includes(
    recordingState,
  );
}

export function StudioTranscribe({
  onSaved,
}: {
  onSaved: () => Promise<void>;
}) {
  const state = useDesktopStore();
  const preferences = useProviderStore((s) => s.preferences);
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [proposed, setProposed] = useState(""),
    // Until it is edited, the instruction follows the interface language.
    [customInstruction, setInstruction] = useState<string | null>(null);
  const instruction =
    customInstruction ?? t("studio.transcribe.defaultInstruction");
  const allowCloud = () => useDesktopStore.getState().privacyLevel === "cloud";
  // The app's recorder holds one recording at a time: a file is not imported
  // while it records, and nothing is recorded while it takes a file.
  const capturing = isCapturing(state.recordingState);
  const importAudio = async (file?: File) => {
    if (!file) return;
    const native = isTauriRuntime();
    if (native && isCapturing(useDesktopStore.getState().recordingState))
      return;
    if (native) useDesktopStore.setState({ importingAudio: true });
    setBusy(true);
    setMessage("");
    try {
      if (isTauriRuntime()) {
        // The app records files of any length through its chunked recorder.
        if (file.size > 100 * 1024 * 1024)
          throw new Error(t("studio.transcribe.fileTooLargeApp"));
        setMessage(t("studio.transcribe.reading"));
        const online = preferences.stt.provider !== "local" && allowCloud();
        if (online) await setProviderMode(true);
        const long = await transcribeAudioFile(
          file,
          {
            language: state.sttLanguage,
            modelPath: state.whisperConfig.modelPath,
            ...(online
              ? {
                  provider: preferences.stt.provider,
                  model: preferences.stt.model,
                }
              : {}),
          },
          ({ transcribedMs, durationMs }) =>
            setMessage(
              t("studio.transcribe.progress", {
                done: formatTimestamp(transcribedMs),
                total: formatTimestamp(durationMs),
              }),
            ),
        );
        if (long) {
          void applyCaptureFormat(nativeProviderCall).catch(() => undefined);
          state.openCapture({
            id: long.captureId!,
            durationMs: long.durationMs,
            transcript: long.text,
            segments: long.segments,
          });
          setMessage(
            long.text
              ? t("studio.transcribe.saved")
              : t("studio.transcribe.noSpeech"),
          );
          return;
        }
        setMessage("");
      }
      if (file.size > 25 * 1024 * 1024)
        throw new Error(t("studio.transcribe.fileTooLarge"));
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
        throw new Error(result.message || t("studio.transcribe.notReady"));
      if (result.captureId)
        state.openCapture({
          id: result.captureId,
          durationMs: (wav.length - 44) / 32,
          transcript: result.transcript || "",
          segments: result.segments ?? [],
        });
      else state.setTranscript(result.transcript || "");
      setMessage(
        result.transcript
          ? t("studio.transcribe.saved")
          : t("studio.transcribe.noSpeech"),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (native) useDesktopStore.setState({ importingAudio: false });
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
  const [view, setView] = useState<"text" | "segments">("text");
  const player = useCapturePlayer();
  // An edited transcript can go back to the one recording it came from.
  const libraryCaptureId = isTauriRuntime()
    ? singleCaptureId(state.transcriptSegments)
    : undefined;
  const saveToLibrary = async () => {
    if (!libraryCaptureId) return;
    setBusy(true);
    try {
      await nativeProviderCall("update_local_capture", {
        id: libraryCaptureId,
        transcript: state.transcript,
        segments: state.transcriptSegments
          .filter((segment) => segment.text.trim())
          .map((segment) => ({
            startMs: Math.round(segment.startMs),
            endMs: Math.round(Math.max(segment.startMs, segment.endMs)),
            text: segment.text.trim(),
            ...(segment.speaker ? { speaker: segment.speaker } : {}),
          })),
      });
      setMessage(t("studio.segments.saved"));
      await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    const file = exportTranscript({
      format: exportFormat,
      transcript: state.transcript,
      segments: state.transcriptSegments,
      title: t("studio.transcribe.exportTitle"),
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
          <p className="studio-eyebrow">{t("studio.transcribe.eyebrow")}</p>
          <h1>{t("studio.transcribe.title")}</h1>
          <p>{t("studio.transcribe.subtitle")}</p>
        </div>
        <button
          className="studio-button secondary"
          onClick={() => input.current?.click()}
          disabled={busy || (capturing && isTauriRuntime())}
        >
          <Upload size={16} />
          {t("studio.transcribe.import")}
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
            <h3>{t("studio.transcribe.yourTranscript")}</h3>
            <div
              className="studio-view-toggle"
              role="group"
              aria-label={t("studio.segments.viewLabel")}
            >
              {(["text", "segments"] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={view === value}
                  className={view === value ? "active" : ""}
                  onClick={() => setView(value)}
                >
                  {value === "text"
                    ? t("studio.segments.viewText")
                    : t("studio.segments.viewSegments")}
                </button>
              ))}
            </div>
            <span className="studio-tag">
              {state.privacyLevel === "local"
                ? t("studio.mode.local")
                : t("studio.mode.cloud")}
            </span>
          </div>
          {view === "text" ? (
            <textarea
              aria-label={t("studio.transcribe.editorLabel")}
              placeholder={t("studio.transcribe.placeholder")}
              value={state.transcript}
              onChange={(event) => state.setTranscript(event.target.value)}
            />
          ) : (
            <SegmentEditor player={player} />
          )}
          <div className="studio-editor-footer">
            <span>
              {t.count("studio.transcribe.words", countWords(state.transcript))}
            </span>
            <div>
              <button
                className="studio-link"
                disabled={!state.canUndoTranscript}
                onClick={state.undoTranscriptEdit}
              >
                {t("studio.common.undo")}
              </button>
              <button
                className="studio-link"
                disabled={!state.canRedoTranscript}
                onClick={state.redoTranscriptEdit}
              >
                {t("studio.common.redo")}
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
                ? t("studio.transcribe.stopRecording")
                : t("studio.transcribe.record")}
            </button>
            <button
              className="studio-button secondary"
              disabled={!state.transcript}
              onClick={() =>
                void copyTranscript(state.transcript, state.transcriptSegments)
                  .then(() => setMessage(t("studio.transcribe.copied")))
                  .catch(() => setMessage(t("studio.transcribe.copyBlocked")))
              }
            >
              <Copy size={16} />
              {t("studio.common.copy")}
            </button>
            <select
              className="studio-export-format"
              aria-label={t("studio.transcribe.exportFormat")}
              value={exportFormat}
              onChange={(event) =>
                setExportFormat(event.target.value as TranscriptExportFormat)
              }
            >
              {EXPORT_FORMATS.map((format) => (
                <option key={format.id} value={format.id}>
                  {t(format.label)}
                </option>
              ))}
            </select>
            <button
              className="studio-icon-button"
              aria-label={t("studio.transcribe.export")}
              title={t("studio.transcribe.export")}
              disabled={!state.transcript}
              onClick={download}
            >
              <Download size={17} />
            </button>
            {libraryCaptureId && (
              <button
                className="studio-button secondary"
                disabled={busy || !state.transcript.trim()}
                onClick={() => void saveToLibrary()}
              >
                <Check size={16} />
                {t("studio.segments.saveToLibrary")}
              </button>
            )}
          </div>
          {state.liveTranscript &&
            (state.recordingState === "recording" ||
              state.recordingState === "uploading") && (
              <div className="studio-live-text">
                <span>{t("studio.transcribe.liveLabel")}</span>
                <p>{state.liveTranscript}</p>
              </div>
            )}
          {(message || player.error || state.voiceError) && (
            <StatusNotice
              text={
                message || player.error || t.message(state.voiceError || "")
              }
            />
          )}
        </section>
        <aside className="studio-editor-tools">
          <section className="studio-card">
            <h3>{t("studio.transcribe.recognition")}</h3>
            <StudioModelSelector task="stt" inlineStatus />
            <label>
              {t("studio.common.language")}
              <select
                value={state.sttLanguage}
                onChange={(event) => state.setSttLanguage(event.target.value)}
              >
                {STT_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.code === "auto"
                      ? t("studio.settings.languageAuto")
                      : language.nativeName}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="studio-card">
            <h3>
              <Sparkles size={16} /> {t("studio.transcribe.polishTitle")}
            </h3>
            <p className="studio-muted">{t("studio.transcribe.polishBody")}</p>
            <button
              className="studio-button secondary full"
              disabled={!state.transcript}
              onClick={state.applyPolishedPreview}
            >
              {t("studio.transcribe.cleanLocal")}
            </button>
            <details className="studio-details">
              <summary>{t("studio.transcribe.refineOnline")}</summary>
              <label>
                {t("studio.transcribe.instruction")}
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
                {busy
                  ? t("studio.common.working")
                  : t("studio.transcribe.previewEdit")}
              </button>
              <button
                className="studio-link"
                onClick={() => state.setActiveView("models")}
              >
                {t("studio.transcribe.chooseModel")}
              </button>
            </details>
          </section>
        </aside>
      </div>
      {proposed && (
        <section className="studio-card">
          <h3>{t("studio.transcribe.reviewTitle")}</h3>
          <p className="studio-transcript-preview">{proposed}</p>
          <button
            className="studio-button"
            onClick={() => {
              state.setTranscript(proposed);
              setProposed("");
            }}
          >
            {t("studio.transcribe.apply")}
          </button>
          <button
            className="studio-button ghost"
            onClick={() => setProposed("")}
          >
            {t("studio.transcribe.keep")}
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
  const t = useT();
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
          <p className="studio-eyebrow">{t("studio.speech.eyebrow")}</p>
          <h1>{t("studio.speech.title")}</h1>
          <p>{t("studio.speech.subtitle")}</p>
        </div>
      </div>
      <div className="studio-editor-layout">
        <section className="studio-card studio-editor">
          <div className="studio-section-heading">
            <h3>{t("studio.speech.question")}</h3>
            <span className="studio-tag">{t("studio.task.tts")}</span>
          </div>
          <textarea
            aria-label={t("studio.speech.inputLabel")}
            maxLength={12000}
            placeholder={t("studio.speech.placeholder")}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="studio-editor-footer">
            <span>
              {t("studio.speech.characters", {
                count: text.length.toLocaleString(t.locale),
                max: (12000).toLocaleString(t.locale),
              })}
            </span>
          </div>
          <div className="studio-editor-actions">
            <button
              className="studio-button"
              disabled={!text.trim() || busy}
              onClick={() => void generate()}
            >
              <Play size={16} />
              {busy
                ? t("studio.speech.generating")
                : t("studio.speech.generate")}
            </button>
            {url && (
              <a
                className="studio-button secondary"
                href={url}
                download={`sonolect-speech.${extension}`}
              >
                <Download size={16} />
                {t("studio.speech.download", {
                  format: extension.toUpperCase(),
                })}
              </a>
            )}
          </div>
          {url && <audio className="studio-audio" controls src={url} />}
          {mode === "local" && (
            <p className="studio-notice">{t("studio.speech.localNotice")}</p>
          )}
          {message && <StatusNotice text={message} />}
        </section>
        <aside className="studio-editor-tools">
          <section className="studio-card">
            <h3>{t("studio.speech.modelVoice")}</h3>
            <StudioModelSelector task="tts" inlineStatus />
            <label>
              {t("studio.speech.format")}
              <select
                value={format}
                onChange={(event) =>
                  setFormat(event.target.value as "mp3" | "pcm")
                }
              >
                <option value="mp3">MP3</option>
                <option value="pcm">{t("studio.speech.pcmOption")}</option>
              </select>
            </label>
            {format === "pcm" && (
              <label>
                {t("studio.speech.sampleRate")}
                <select
                  value={sampleRate}
                  onChange={(event) =>
                    setSampleRate(Number(event.target.value))
                  }
                >
                  {[16000, 22050, 24000, 44100, 48000].map((rate) => (
                    <option value={rate} key={rate}>
                      {rate.toLocaleString(t.locale)} Hz
                    </option>
                  ))}
                </select>
                <small>{t("studio.speech.sampleRateHint")}</small>
              </label>
            )}
            <p className="studio-muted">{t("studio.speech.formatHint")}</p>
            <label>
              {t("studio.speech.voice")}
              {selected?.voices.length ? (
                <select
                  value={preferences.voice}
                  onChange={(event) => setVoice(event.target.value)}
                >
                  <option value="">{t("studio.speech.voiceDefault")}</option>
                  {selected.voices.map((voice) => (
                    <option key={voice} value={voice}>
                      {voice}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  placeholder={t("studio.speech.voicePlaceholder")}
                  value={preferences.voice}
                  onChange={(event) => setVoice(event.target.value)}
                />
              )}
            </label>
            <p className="studio-muted">{t("studio.speech.voiceHint")}</p>
          </section>
          <section className="studio-local-callout small">
            <Cpu size={22} />
            <p>{t("studio.speech.localCallout")}</p>
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
  const t = useT();
  const player = useCapturePlayer();
  const retry = async (id: string) => {
    setBusy(id);
    try {
      await nativeProviderCall("retry_local_capture", {
        id,
        modelPath: state.whisperConfig.modelPath || null,
        language: state.sttLanguage,
      });
      setMessage(t("studio.library.retried"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      await refresh();
      setBusy("");
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm(t("studio.library.confirmDelete"))) return;
    try {
      await nativeProviderCall("delete_local_capture", { id });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const needle = query.toLocaleLowerCase(t.locale);
  const visible = captures.filter((item) =>
    [item.title, item.transcript || item.error]
      .filter(Boolean)
      .join("\n")
      .toLocaleLowerCase(t.locale)
      .includes(needle),
  );
  const originalDate = (id: string) => {
    const original = captures.find((capture) => capture.id === id);
    return original
      ? new Date(original.createdAtMs).toLocaleString(t.locale)
      : undefined;
  };
  return (
    <div className="studio-page">
      <div className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">{t("studio.library.eyebrow")}</p>
          <h1>{t("studio.library.title")}</h1>
          <p>{t("studio.library.subtitle")}</p>
        </div>
        <button
          className="studio-button secondary"
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
          {t("studio.common.refresh")}
        </button>
      </div>
      <input
        className="studio-search"
        aria-label={t("studio.library.searchLabel")}
        placeholder={t("studio.library.searchPlaceholder")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {(message || player.error || error) && (
        <p className="studio-notice" role="status">
          {message || player.error || error}
        </p>
      )}
      {!visible.length ? (
        <div className="studio-empty">
          <FileAudio size={38} />
          <h3>
            {query
              ? t("studio.library.noMatch")
              : t("studio.library.emptyTitle")}
          </h3>
          <p>
            {query
              ? t("studio.library.tryOther")
              : t("studio.library.emptyBody")}
          </p>
          <button
            className="studio-button"
            onClick={() => state.setActiveView("transcribe")}
          >
            {t("studio.library.createFirst")}
          </button>
        </div>
      ) : (
        <div className="studio-library-list">
          {visible.map((item) => (
            <article key={item.id} className="studio-card">
              <div className="studio-section-heading">
                <span className="studio-muted">
                  {new Date(item.createdAtMs).toLocaleString(t.locale)} ·{" "}
                  {t("studio.common.secondsShort", {
                    count: Math.round(item.durationMs / 1000),
                  })}
                </span>
                <span
                  className={`studio-tag ${item.error || item.conflictOf ? "amber" : "green"}`}
                >
                  {item.error
                    ? t("studio.library.retryNeeded")
                    : item.conflictOf
                      ? t("studio.library.conflictCopy")
                      : item.hasAudio === false
                        ? t("studio.library.synced")
                        : t("studio.library.savedOnDevice")}
                </span>
              </div>
              {item.title && (
                <h3 className="studio-library-title">{item.title}</h3>
              )}
              <p className="studio-transcript-preview">
                {item.transcript || t("studio.library.noTranscript")}
              </p>
              {item.error && <p className="studio-muted">{item.error}</p>}
              {item.conflictOf && originalDate(item.conflictOf) && (
                <p className="studio-muted">
                  {t("studio.library.conflictOf", {
                    date: originalDate(item.conflictOf)!,
                  })}
                </p>
              )}
              {item.hasAudio === false && (
                <p className="studio-muted">{t("studio.library.noAudio")}</p>
              )}
              <div className="studio-card-actions">
                {item.hasAudio !== false && (
                  <button
                    className="studio-link"
                    onClick={() =>
                      player.captureId === item.id && player.playing
                        ? player.pause()
                        : void player.play(
                            item.id,
                            // Carry on where this recording was paused.
                            player.captureId === item.id &&
                              player.positionMs < item.durationMs - 250
                              ? player.positionMs
                              : 0,
                          )
                    }
                  >
                    {player.captureId === item.id && player.playing ? (
                      <Pause size={14} />
                    ) : (
                      <Play size={14} />
                    )}
                    {player.captureId === item.id && player.playing
                      ? t("studio.library.pause")
                      : t("studio.library.listen")}
                    {player.captureId === item.id && (
                      <span className="studio-playhead">
                        {formatTimestamp(player.positionMs)}
                      </span>
                    )}
                  </button>
                )}
                <button
                  className="studio-link"
                  disabled={!item.transcript}
                  onClick={() => {
                    state.openCapture(item);
                    state.setActiveView("transcribe");
                  }}
                >
                  {t("studio.library.openEditor")}
                </button>
                <button
                  className="studio-link"
                  disabled={!item.transcript}
                  onClick={() =>
                    void copyTranscript(item.transcript || "", item.segments)
                      .then(() => setMessage(t("studio.transcribe.copied")))
                      .catch(() => setMessage(t("studio.library.copyBlocked")))
                  }
                >
                  <Copy size={14} />
                  {t("studio.common.copy")}
                </button>
                {item.hasAudio !== false && (
                  <button
                    className="studio-link"
                    disabled={!!busy}
                    onClick={() => void retry(item.id)}
                  >
                    <RefreshCw size={14} />
                    {busy === item.id
                      ? t("studio.library.transcribing")
                      : t("studio.library.retryLocal")}
                  </button>
                )}
                <button
                  className="studio-link muted"
                  disabled={!!busy}
                  onClick={() => void remove(item.id)}
                >
                  <Trash2 size={14} />
                  {t("studio.common.delete")}
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
  const t = useT();
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
          <p className="studio-eyebrow">{t("studio.vocab.eyebrow")}</p>
          <h1>
            {snippets
              ? t("studio.snippets.title")
              : t("studio.dictionary.title")}
          </h1>
          <p>
            {snippets
              ? t("studio.snippets.subtitle")
              : t("studio.dictionary.subtitle")}
          </p>
        </div>
      </div>
      <section className="studio-card">
        <div className="studio-form-grid">
          <label>
            {snippets
              ? t("studio.snippets.triggerLabel")
              : t("studio.dictionary.spokenLabel")}
            <input
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              placeholder={
                snippets
                  ? t("studio.snippets.triggerPlaceholder")
                  : t("studio.dictionary.spokenPlaceholder")
              }
            />
          </label>
          <label>
            {snippets
              ? t("studio.snippets.bodyLabel")
              : t("studio.dictionary.replacementLabel")}
            <input
              value={second}
              onChange={(e) => setSecond(e.target.value)}
              placeholder={
                snippets
                  ? t("studio.snippets.bodyPlaceholder")
                  : t("studio.dictionary.replacementPlaceholder")
              }
            />
          </label>
          <button
            className="studio-button"
            onClick={add}
            disabled={!first.trim() || !second.trim()}
          >
            {snippets ? t("studio.snippets.add") : t("studio.dictionary.add")}
          </button>
        </div>
      </section>
      <div className="studio-section-heading">
        <h2>
          {snippets
            ? t("studio.snippets.listTitle")
            : t("studio.dictionary.listTitle")}
        </h2>
        <span className="studio-muted">
          {t.count("studio.vocab.count", items.length)}
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
                aria-label={t("studio.vocab.deleteLabel", { name: item.first })}
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
          <p>{t("studio.vocab.empty")}</p>
        </div>
      )}
    </div>
  );
}

/** "Deutsch (German)" in English, "Deutsch (allemand)" in French. */
function dictationLanguageLabel(
  language: (typeof STT_LANGUAGES)[number],
  locale: SupportedLocale,
) {
  const translated = languageName(language.code, locale, language.name);
  return translated.toLocaleLowerCase(locale) ===
    language.nativeName.toLocaleLowerCase(locale)
    ? language.nativeName
    : `${language.nativeName} (${translated})`;
}

function PrivacyControls() {
  const recordingState = useDesktopStore((s) => s.recordingState);
  const t = useT();
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
          ? t("studio.privacy.keptForever")
          : t("studio.privacy.savedPreview"),
      );
      return;
    }
    try {
      const removed = await applyCaptureRetention(nativeProviderCall, days);
      setMessage(
        removed
          ? t.count("studio.privacy.savedDeleted", removed, {
              period: retentionLabel(days),
            })
          : t("studio.privacy.savedAuto", { period: retentionLabel(days) }),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const [format, setFormat] = useState<CaptureFormat>(() =>
    loadCaptureFormat(),
  );
  const [compressing, setCompressing] = useState(false);
  const compressNow = async () => {
    setCompressing(true);
    setMessage("");
    try {
      const done = await compressCaptures(nativeProviderCall);
      const parts = [
        done.recordings
          ? t.count("studio.storage.compressed", done.recordings, {
              size: formatSize(done.bytesFreed, t.locale),
            })
          : done.failed
            ? ""
            : t("studio.storage.nothingToCompress"),
        done.failed ? t.count("studio.storage.failed", done.failed) : "",
      ];
      setMessage(parts.filter(Boolean).join(" "));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCompressing(false);
    }
  };
  const changeFormat = (next: CaptureFormat) => {
    setFormat(next);
    saveCaptureFormat(next);
    setMessage(
      !native
        ? t("studio.privacy.savedPreview")
        : next === "opus"
          ? t("studio.storage.savedOpus")
          : t("studio.storage.savedWav"),
    );
  };
  const sync = getSyncController();
  const syncAvailable = useSyncView().available;
  const deleteEverything = async () => {
    if (!window.confirm(t("studio.privacy.confirmDeleteAll"))) return;
    setBusy(true);
    setMessage("");
    try {
      // With sync on, the server copy can go first; the other devices then
      // turn sync off and keep their notes. If that fails, nothing is deleted.
      if (
        sync?.getView().phase === "on" &&
        window.confirm(t("studio.sync.deleteAllServer"))
      ) {
        try {
          await sync.turnOff({ deleteServerCopy: true });
        } catch (error) {
          setMessage(syncActionErrorText(error, t));
          return;
        }
      }
      const result = await deleteAllLocalData(
        native
          ? nativeProviderCall
          : async <T,>() =>
              0 as unknown as T /* browser preview: nothing native */,
        undefined,
        sync ? { forgetSync: () => sync.forgetLocal() } : {},
      );
      if (result.problems.length) {
        setMessage(
          t("studio.privacy.partialFailure", {
            problems: result.problems.join("; "),
          }),
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
          <h3>{t("studio.privacy.title")}</h3>
          <p>{t("studio.privacy.subtitle")}</p>
        </div>
      </div>
      <div className="studio-privacy-actions">
        <label>
          {t("studio.privacy.keep")}
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
        <label>
          {t("studio.storage.format")}
          <select
            value={format}
            onChange={(event) =>
              changeFormat(event.target.value as CaptureFormat)
            }
          >
            {CAPTURE_FORMATS.map((choice) => (
              <option key={choice} value={choice}>
                {t(`studio.storage.${choice}`)}
              </option>
            ))}
          </select>
        </label>
        {native && format === "opus" && (
          <button
            className="studio-button secondary"
            disabled={compressing || busy || capturing}
            onClick={() => void compressNow()}
          >
            <Archive size={15} />
            {compressing
              ? t("studio.storage.compressing")
              : t("studio.storage.compressNow")}
          </button>
        )}
        <button
          className="studio-button danger"
          disabled={busy || capturing}
          onClick={() => void deleteEverything()}
        >
          <Trash2 size={15} />
          {busy ? t("studio.privacy.deleting") : t("studio.privacy.deleteAll")}
        </button>
      </div>
      <p className="studio-muted">
        {t("studio.privacy.deleteAllHint")}
        {syncAvailable ? ` ${t("studio.sync.deleteAllHint")}` : ""}
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
  const t = useT();
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
      setMessage(t("studio.settings.modelDownloaded"));
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
          <p className="studio-eyebrow">{t("studio.settings.eyebrow")}</p>
          <h1>{t("studio.settings.title")}</h1>
          <p>{t("studio.settings.subtitle")}</p>
        </div>
      </div>
      <div className="studio-grid two">
        <section className="studio-card">
          <div className="studio-card-heading">
            <div className="studio-icon">
              <Cpu size={25} />
            </div>
            <div>
              <h3>{t("studio.settings.whisperTitle")}</h3>
              <p>{t("studio.settings.whisperMeta")}</p>
            </div>
          </div>
          <p className="studio-muted">
            {model?.ready
              ? t("studio.settings.modelReady")
              : t("studio.settings.modelMissing")}
          </p>
          <button
            className="studio-button"
            disabled={!isTauriRuntime() || busy}
            onClick={() => void install()}
          >
            <Download size={15} />
            {busy
              ? t("studio.settings.downloading", { progress })
              : model?.ready
                ? t("studio.settings.reinstall")
                : t("studio.settings.install")}
          </button>
          {busy && (
            <progress max={100} value={progress} className="studio-progress" />
          )}
          <details className="studio-details">
            <summary>{t("studio.settings.existingModel")}</summary>
            <label>
              {t("studio.settings.modelPath")}
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
          <h3>{t("studio.settings.languageTitle")}</h3>
          <label>
            {t("studio.settings.interfaceLanguage")}
            <select
              value={
                (LAUNCH_LOCALES as readonly string[]).includes(state.locale)
                  ? state.locale
                  : "en"
              }
              onChange={(e) => state.setLocale(e.target.value as LaunchLocale)}
            >
              {LAUNCH_LOCALES.map((locale) => (
                <option value={locale} key={locale} lang={locale}>
                  {LOCALE_NAMES[locale]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("studio.settings.dictationLanguage")}
            <select
              value={state.sttLanguage}
              onChange={(e) => state.setSttLanguage(e.target.value)}
            >
              {STT_LANGUAGES.map((language) => (
                <option value={language.code} key={language.code}>
                  {language.code === "auto"
                    ? t("studio.settings.languageAuto")
                    : dictationLanguageLabel(language, t.locale)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("studio.mode.label")}
            <select
              value={state.privacyLevel}
              onChange={(e) =>
                state.setPrivacyLevel(e.target.value as "local" | "cloud")
              }
            >
              <option value="local">{t("studio.mode.local")}</option>
              <option value="cloud">{t("studio.mode.cloud")}</option>
            </select>
          </label>
          <p className="studio-muted">{t("studio.settings.modeHint")}</p>
        </section>
      </div>
      <section className="studio-card" aria-labelledby="bubble-settings">
        <h3 id="bubble-settings">{t("studio.settings.bubbleTitle")}</h3>
        <p className="studio-muted">
          {t("studio.settings.bubbleHint", {
            toggle: `Ctrl + ${t("studio.keys.shift")} + M`,
            hold: `Ctrl + ${t("studio.keys.shift")} + V`,
            cancel: t("studio.keys.esc"),
          })}
        </p>
        <label>
          {t("studio.settings.bubbleShow")}
          <select
            value={bubbleVisibility}
            onChange={(e) => {
              const next = e.target.value as BubbleVisibility;
              setBubbleVisibility(next);
              saveBubbleVisibility(next);
            }}
          >
            <option value="always">{t("studio.settings.bubbleAlways")}</option>
            <option value="dictating">
              {t("studio.settings.bubbleDictating")}
            </option>
            <option value="off">{t("studio.settings.bubbleOff")}</option>
          </select>
        </label>
      </section>
      <MicrophoneSettings />
      <StudioSync />
      <PrivacyControls />
      <section className="studio-card">
        <h3>{t("studio.settings.shortcutsTitle")}</h3>
        <div className="studio-workflow-row">
          <span>{t("studio.settings.shortcutToggle")}</span>
          <kbd>Ctrl + {t("studio.keys.shift")} + M</kbd>
        </div>
        <div className="studio-workflow-row">
          <span>{t("studio.settings.shortcutHold")}</span>
          <kbd>Ctrl + {t("studio.keys.shift")} + V</kbd>
        </div>
        <div className="studio-workflow-row">
          <span>{t("studio.settings.shortcutCancel")}</span>
          <kbd>{t("studio.keys.esc")}</kbd>
        </div>
        <div className="studio-workflow-row">
          <span>{t("studio.settings.shortcutNav")}</span>
          <kbd>Ctrl + K</kbd>
        </div>
        <p className="studio-muted">{t("studio.settings.storageHint")}</p>
      </section>
      {message && (
        <p role="status" className="studio-notice">
          {message}
        </p>
      )}
      {!isTauriRuntime() && (
        <p className="studio-notice">{t("studio.settings.previewNotice")}</p>
      )}
    </div>
  );
}
