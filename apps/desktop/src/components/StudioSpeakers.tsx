import { useEffect, useState, type ReactNode } from "react";
import { Download, UsersRound } from "lucide-react";
import { useT } from "../i18n";
import { isTauriRuntime } from "../desktopNative";
import { formatSize } from "../captureStorage";
import { singleCaptureId, type TranscriptSegment } from "../segmentEditor";
import { useSpeakerDetection } from "../speakerDetection";
import {
  SPEAKER_COUNTS,
  downloadSpeakerModel,
  speakerModelStatus,
  type SpeakerModelStatus,
} from "../speakersNative";

/** "28 MB": a model download, to the nearest megabyte. */
export function modelSize(bytes: number, locale: string) {
  return formatSize(Math.round(bytes / 1_000_000) * 1_000_000, locale);
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * "Detect speakers" and how many there are. Only the desktop app can
 * detect, and only in a transcript of one saved recording.
 */
export function SpeakerTools({ segments }: { segments: TranscriptSegment[] }) {
  const t = useT();
  const { current, speakers, setSpeakers, start } = useSpeakerDetection();
  if (!isTauriRuntime() || !singleCaptureId(segments)) return null;
  const busy = current.step !== "idle";
  return (
    <div className="studio-speaker-tools">
      <button
        className="studio-button secondary"
        disabled={busy}
        onClick={() => void start()}
      >
        <UsersRound size={15} />
        {t("studio.speakers.detect")}
      </button>
      <label className="studio-speaker-count">
        {t("studio.speakers.count")}
        <select
          value={speakers ?? ""}
          disabled={busy}
          onChange={(event) =>
            setSpeakers(
              event.target.value ? Number(event.target.value) : undefined,
            )
          }
        >
          <option value="">{t("studio.speakers.auto")}</option>
          {SPEAKER_COUNTS.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * What speaker detection asks or reports, for the editor's status line.
 * Nothing while it is idle, unless the last attempt was about this
 * transcript and no segment is selected.
 */
export function useSpeakerStatus(
  segments: TranscriptSegment[],
  selecting: boolean,
): ReactNode {
  const t = useT();
  const { current, outcome, download, choose, cancel } = useSpeakerDetection();
  switch (current.step) {
    case "consent":
      return (
        <>
          {outcome && <span>{outcome.message}</span>}
          <span>
            {t("studio.speakers.consent", {
              size: modelSize(current.sizeBytes, t.locale),
            })}
          </span>
          <button
            className="studio-link"
            autoFocus
            onClick={() => void download()}
          >
            {t("studio.speakers.download")}
          </button>
          <button className="studio-link muted" onClick={() => void cancel()}>
            {t("studio.speakers.notNow")}
          </button>
        </>
      );
    case "downloading":
      return (
        <>
          <span>
            {t("studio.speakers.downloading", { progress: current.progress })}
          </span>
          <progress
            className="studio-progress"
            max={100}
            value={current.progress}
            aria-hidden="true"
          />
        </>
      );
    case "choose":
      return (
        <>
          <span>{t("studio.speakers.keepOrReplace")}</span>
          <button
            className="studio-link"
            autoFocus
            onClick={() => void choose(false)}
          >
            {t("studio.speakers.keep")}
          </button>
          <button className="studio-link" onClick={() => void choose(true)}>
            {t("studio.speakers.replace")}
          </button>
          <button className="studio-link muted" onClick={() => void cancel()}>
            {t("studio.speakers.cancel")}
          </button>
        </>
      );
    case "detecting":
      return (
        <>
          <span>
            {t("studio.speakers.detecting", { progress: current.progress })}
          </span>
          <progress
            className="studio-progress"
            max={100}
            value={current.progress}
            aria-hidden="true"
          />
          <button
            className="studio-link"
            disabled={current.cancelling}
            onClick={() => void cancel()}
          >
            {t("studio.speakers.cancel")}
          </button>
        </>
      );
    default:
      return !selecting &&
        outcome &&
        outcome.captureId === singleCaptureId(segments) ? (
        <span>{outcome.message}</span>
      ) : undefined;
  }
}

/** The speaker model, in Settings next to the Whisper model. */
export function SpeakerModelSettings() {
  const t = useT();
  const native = isTauriRuntime();
  const [status, setStatus] = useState<SpeakerModelStatus>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    speakerModelStatus().then(
      (result) => {
        if (!cancelled) setStatus(result);
      },
      (error) => {
        if (!cancelled) setMessage(messageOf(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [native]);
  const install = async () => {
    setBusy(true);
    setProgress(0);
    setMessage("");
    try {
      setStatus(await downloadSpeakerModel(setProgress));
      setMessage(t("studio.settings.speakerModelDownloaded"));
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setBusy(false);
    }
  };
  const size = status ? ` · ${modelSize(status.sizeBytes, t.locale)}` : "";
  return (
    <div className="studio-model-row">
      <h4>{t("studio.settings.speakerModelTitle")}</h4>
      <p className="studio-muted">
        {t("studio.settings.speakerModelMeta")}
        {size}
      </p>
      <p className="studio-muted">
        {status?.ready
          ? t("studio.settings.speakerModelReady")
          : t("studio.settings.speakerModelMissing")}
      </p>
      <button
        className="studio-button secondary"
        disabled={!native || busy}
        onClick={() => void install()}
      >
        <Download size={15} />
        {busy
          ? t("studio.settings.downloading", { progress })
          : status?.ready
            ? t("studio.settings.speakerModelReinstall")
            : t("studio.settings.speakerModelInstall")}
      </button>
      {busy && (
        <progress max={100} value={progress} className="studio-progress" />
      )}
      {message && (
        <p role="status" className="studio-muted">
          {message}
        </p>
      )}
    </div>
  );
}
