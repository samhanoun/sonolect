import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Combine,
  Pause,
  Play,
  Scissors,
} from "lucide-react";
import { useDesktopStore } from "../store/appStore";
import { hasPlayableAudio, useAudiolessCaptures } from "../captureAudio";
import { isTauriRuntime } from "../desktopNative";
import { nativeProviderCall } from "../providerSettings";
import { CapturePlayback } from "../capturePlayback";
import { useT } from "../i18n";
import {
  formatTimestamp,
  mergeableRun,
  segmentAtTime,
  speakerColorIndex,
  speakerNames,
  type TranscriptSegment,
} from "../segmentEditor";
import { SpeakerTools, useSpeakerStatus } from "./StudioSpeakers";

export type CapturePlayer = {
  /** The recording that is loaded, playing or paused. */
  captureId: string | undefined;
  playing: boolean;
  positionMs: number;
  error: string;
  /** Plays a saved recording from a position, loading its audio if needed. */
  play: (captureId: string, fromMs?: number) => Promise<void>;
  pause: () => void;
};

/**
 * Plays saved recordings. The audio is read from the device once per
 * recording, as Opus when the webview can play it, and kept until another
 * one is played or the page closes.
 */
export function useCapturePlayer(): CapturePlayer {
  const playback = useRef<CapturePlayback | null>(null);
  const [status, setStatus] = useState({
    captureId: undefined as string | undefined,
    playing: false,
    positionMs: 0,
    error: "",
  });

  useEffect(() => () => playback.current?.close(), []);

  const player = () => {
    if (playback.current) return playback.current;
    const created = new Audio();
    const position = () => Math.round(created.currentTime * 1000);
    created.addEventListener("timeupdate", () =>
      setStatus((current) => ({ ...current, positionMs: position() })),
    );
    created.addEventListener("play", () =>
      setStatus((current) => ({ ...current, playing: true })),
    );
    for (const event of ["pause", "ended"] as const)
      created.addEventListener(event, () =>
        setStatus((current) => ({
          ...current,
          playing: false,
          positionMs: position(),
        })),
      );
    playback.current = new CapturePlayback(created, {
      read: (id, format) =>
        nativeProviderCall<ArrayBuffer>("read_local_capture_audio", {
          id,
          format,
        }),
      createUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => URL.revokeObjectURL(url),
    });
    return playback.current;
  };

  const play = async (captureId: string, fromMs = 0) => {
    try {
      // A newer click, or leaving the page, wins over this one, which then
      // ends without an error.
      await player().play(captureId, fromMs, () =>
        setStatus({ captureId, playing: true, positionMs: fromMs, error: "" }),
      );
    } catch (error) {
      setStatus((previous) => ({
        ...previous,
        playing: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const pause = () => {
    playback.current?.pause();
    // Shown at once: while the audio is still being read nothing plays yet,
    // so the element may not report the pause.
    setStatus((current) => ({ ...current, playing: false }));
  };

  return { ...status, play, pause };
}

/**
 * A speaker field that is only saved when the name is finished, so a name can
 * contain spaces and one rename is one undo step.
 */
function SpeakerField({
  value,
  label,
  placeholder,
  listId,
  onCommit,
}: {
  value: string;
  label: string;
  placeholder?: string;
  listId: string;
  onCommit: (speaker: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft);
    else setDraft(value);
  };
  return (
    <input
      className="studio-segment-speaker"
      aria-label={label}
      placeholder={placeholder}
      list={listId}
      maxLength={80}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(value);
      }}
    />
  );
}

/**
 * The speakers of a transcript, each with its colour and how many segments
 * it has. Renaming one here renames it on every segment.
 */
function SpeakerLegend({
  segments,
  listId,
}: {
  segments: TranscriptSegment[];
  listId: string;
}) {
  const t = useT();
  const rename = useDesktopStore((state) => state.renameSpeakerEverywhere);
  const names = speakerNames(segments);
  if (!names.length) return null;
  return (
    <ul
      className="studio-speaker-legend"
      aria-label={t("studio.speakers.legend")}
    >
      {names.map((name) => (
        <li
          key={name}
          className={`studio-speaker speaker-${speakerColorIndex(segments, name)}`}
        >
          <span className="studio-speaker-swatch" aria-hidden="true" />
          <SpeakerField
            value={name}
            label={t("studio.speakers.rename", { name })}
            listId={listId}
            onCommit={(to) => rename(name, to)}
          />
          <span>
            {t.count(
              "studio.speakers.segments",
              segments.filter((segment) => segment.speaker?.trim() === name)
                .length,
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The transcript as timed segments: edit, merge, split, reorder, label, play. */
export function SegmentEditor({ player }: { player: CapturePlayer }) {
  const segments = useDesktopStore((state) => state.transcriptSegments);
  const selected = useDesktopStore((state) => state.selectedSegmentIds);
  const actions = useDesktopStore();
  const t = useT();
  const speakerListId = useId();
  // Where the cursor last was, so Split can cut there.
  const caret = useRef<{ id: string; index: number } | null>(null);
  const [speakerDraft, setSpeakerDraft] = useState("");
  const canPlay = isTauriRuntime();
  // A note that came through sync has no recording here: no play buttons.
  const audioless = useAudiolessCaptures((state) => state.ids);
  const playable =
    canPlay &&
    segments.some((segment) => hasPlayableAudio(segment.captureId, audioless));
  const names = speakerNames(segments);
  const activeId = segmentAtTime(segments, player.captureId, player.positionMs);
  const selectedSegment =
    selected.length === 1
      ? segments.find((segment) => segment.id === selected[0])
      : undefined;
  const canSplit = Boolean(
    selectedSegment && /\S\s+\S/.test(selectedSegment.text),
  );
  const speakerStatus = useSpeakerStatus(segments, selected.length > 0);

  if (!segments.length)
    return (
      <p className="studio-segments-empty studio-muted">
        {t("studio.segments.empty")}
      </p>
    );

  return (
    <div className="studio-segments">
      <div className="studio-segments-toolbar">
        <button
          className="studio-button secondary"
          disabled={!mergeableRun(segments, selected).length}
          onClick={actions.mergeSelectedSegments}
        >
          <Combine size={15} />
          {t("studio.segments.merge")}
        </button>
        <button
          className="studio-button secondary"
          disabled={!canSplit}
          title={t("studio.segments.splitTitle")}
          onClick={() => {
            if (!selectedSegment) return;
            actions.splitSegment(
              selectedSegment.id,
              caret.current?.id === selectedSegment.id
                ? caret.current.index
                : undefined,
            );
          }}
        >
          <Scissors size={15} />
          {t("studio.segments.split")}
        </button>
        <form
          className="studio-segments-label"
          onSubmit={(event) => {
            event.preventDefault();
            actions.setSpeakerForSelection(speakerDraft);
            setSpeakerDraft("");
          }}
        >
          <input
            aria-label={t("studio.segments.speakerForSelection")}
            placeholder={t("studio.segments.speakerForSelection")}
            list={speakerListId}
            maxLength={80}
            value={speakerDraft}
            disabled={!selected.length}
            onChange={(event) => setSpeakerDraft(event.target.value)}
          />
          <button
            className="studio-button secondary"
            disabled={!selected.length}
          >
            {t("studio.segments.applySpeaker")}
          </button>
        </form>
        <SpeakerTools segments={segments} />
        <datalist id={speakerListId}>
          {names.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      <p className="studio-segments-status studio-muted" role="status">
        {speakerStatus ??
          (selected.length ? (
            <>
              {t.count("studio.segments.selected", selected.length)}
              <button
                className="studio-link"
                onClick={actions.clearSegmentSelection}
              >
                {t("studio.segments.clearSelection")}
              </button>
            </>
          ) : playable ? (
            t("studio.segments.hintPlay")
          ) : (
            t("studio.segments.hint")
          ))}
      </p>
      <SpeakerLegend segments={segments} listId={speakerListId} />
      <ol
        className="studio-segment-list"
        aria-label={t("studio.segments.listLabel")}
      >
        {segments.map((segment, index) => {
          const number = index + 1;
          const color = speakerColorIndex(segments, segment.speaker);
          const time = `${segment.approx ? "~" : ""}${formatTimestamp(segment.startMs)}`;
          const isActive = segment.id === activeId;
          const isPlaying = isActive && player.playing;
          const captureId = segment.captureId;
          return (
            <li
              key={segment.id}
              className={[
                "studio-segment",
                selected.includes(segment.id) ? "selected" : "",
                isActive ? "active" : "",
                color === undefined ? "" : `speaker-${color}`,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <input
                type="checkbox"
                aria-label={t("studio.segments.select", { number })}
                checked={selected.includes(segment.id)}
                onChange={() => actions.toggleSegmentSelection(segment.id)}
              />
              <div className="studio-segment-meta">
                {canPlay && hasPlayableAudio(captureId, audioless) ? (
                  <button
                    className="studio-segment-time"
                    title={
                      segment.approx ? t("studio.segments.approx") : undefined
                    }
                    aria-label={
                      isPlaying
                        ? t("studio.segments.pauseAt", { time })
                        : t("studio.segments.playFrom", { time })
                    }
                    onClick={() =>
                      isPlaying
                        ? player.pause()
                        : void player.play(captureId, segment.startMs)
                    }
                  >
                    {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                    {time}
                  </button>
                ) : (
                  <span
                    className="studio-segment-time"
                    title={
                      captureId && segment.approx
                        ? t("studio.segments.approx")
                        : undefined
                    }
                  >
                    {captureId ? time : `#${number}`}
                  </span>
                )}
                <SpeakerField
                  value={segment.speaker ?? ""}
                  label={t("studio.segments.speakerOf", { number })}
                  placeholder={t("studio.segments.speakerPlaceholder")}
                  listId={speakerListId}
                  onCommit={(speaker) =>
                    actions.updateSegmentSpeaker(segment.id, speaker)
                  }
                />
              </div>
              <textarea
                className="studio-segment-text"
                aria-label={t("studio.segments.textOf", { number })}
                rows={Math.max(1, Math.ceil(segment.text.length / 70))}
                value={segment.text}
                onChange={(event) =>
                  actions.updateSegmentText(segment.id, event.target.value)
                }
                onSelect={(event) => {
                  caret.current = {
                    id: segment.id,
                    index: event.currentTarget.selectionStart,
                  };
                }}
                onKeyDown={(event) => {
                  if (
                    event.key !== "Enter" ||
                    !(event.ctrlKey || event.metaKey)
                  )
                    return;
                  event.preventDefault();
                  const at = event.currentTarget.selectionStart;
                  // Nothing to split with the cursor at either end.
                  if (
                    segment.text.slice(0, at).trim() &&
                    segment.text.slice(at).trim()
                  )
                    actions.splitSegment(segment.id, at);
                }}
              />
              <div className="studio-segment-move">
                <button
                  className="studio-icon-button"
                  aria-label={t("studio.segments.moveUp", { number })}
                  title={t("studio.segments.moveUp", { number })}
                  disabled={index === 0}
                  onClick={() => actions.moveSegment(segment.id, "up")}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  className="studio-icon-button"
                  aria-label={t("studio.segments.moveDown", { number })}
                  title={t("studio.segments.moveDown", { number })}
                  disabled={index === segments.length - 1}
                  onClick={() => actions.moveSegment(segment.id, "down")}
                >
                  <ArrowDown size={13} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
