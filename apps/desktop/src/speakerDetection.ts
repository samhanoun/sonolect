/**
 * The steps of "Detect speakers" in the segment editor: asking before the
 * first model download, asking whether typed names stay, then progress and
 * Cancel. They live outside the editor, so a detection that is running is
 * still shown after leaving the page and coming back.
 *
 * Each attempt is about the recording whose transcript was open when it
 * started. A question still waiting for an answer is dropped when another
 * recording is opened, and nothing is ever labelled but that recording.
 */
import { create } from "zustand";
import { getT, inEveryLocale } from "./i18n";
import { singleCaptureId, typedSpeakerNames } from "./segmentEditor";
import { useDesktopStore, type SpeakerDetectionResult } from "./store/appStore";
import {
  cancelSpeakerDetection,
  downloadSpeakerModel,
  speakerModelStatus,
} from "./speakersNative";

export type SpeakerStep =
  | { step: "idle" }
  | { step: "checking" }
  /** The model is not on this device yet: ask before downloading it. */
  | { step: "consent"; sizeBytes: number }
  | { step: "downloading"; progress: number }
  /** Some segments already have names: keep them or replace them. */
  | { step: "choose" }
  | { step: "detecting"; progress: number; cancelling: boolean };

export type SpeakerDetectionState = {
  current: SpeakerStep;
  /** What the last attempt came to, for the recording it was about. */
  outcome: { captureId: string; message: string } | undefined;
  /** How many people speak, 2 to 8; undefined counts them. */
  speakers: number | undefined;
  setSpeakers: (speakers: number | undefined) => void;
  /** Starts with the transcript's recording, asking first where needed. */
  start: () => Promise<void>;
  /** Downloads the model after the user agreed to, then goes on. */
  download: () => Promise<void>;
  /** Answers whether typed names stay, then detects. */
  choose: (replaceTyped: boolean) => Promise<void>;
  /** Stops a detection that is running, or drops the question asked. */
  cancel: () => Promise<void>;
};

export const speakerLabel = (number: number) =>
  getT()("studio.speakers.label", { number });

/** "Speaker 2" in every language, for labels detected before a switch. */
export const speakerLabelsEverywhere = (number: number) =>
  inEveryLocale("studio.speakers.label", { number });

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function resultMessage(result: SpeakerDetectionResult) {
  const t = getT();
  switch (result.status) {
    case "labelled":
      return t.count("studio.speakers.found", result.speakers);
    case "silent":
      return t("studio.speakers.noSpeech");
    case "cancelled":
      return t("native.speakersCancelled");
    case "stale":
      return t("studio.speakers.stale");
  }
}

const isQuestion = (step: SpeakerStep["step"]) =>
  step === "consent" || step === "choose";

export const useSpeakerDetection = create<SpeakerDetectionState>((set, get) => {
  /** The recording the current or last attempt is about. */
  let captureId = "";

  /** Whether the transcript open in the editor is of that recording. */
  const stillOpen = (
    segments = useDesktopStore.getState().transcriptSegments,
  ) => singleCaptureId(segments) === captureId;

  // A question is about the recording it was asked for. Opening another one
  // drops it, so the other recording's own detection can start at once.
  useDesktopStore.subscribe((state, previous) => {
    if (
      state.transcriptSegments !== previous.transcriptSegments &&
      isQuestion(get().current.step) &&
      !stillOpen(state.transcriptSegments)
    )
      set({ current: { step: "idle" } });
  });

  const finish = (message: string) =>
    set({ current: { step: "idle" }, outcome: { captureId, message } });
  /** Nothing was labelled: another recording is open now. */
  const finishStale = () => finish(getT()("studio.speakers.stale"));

  /** Cancel was pressed during the detection that is running. */
  const cancelling = () => {
    const { current } = get();
    return current.step === "detecting" && current.cancelling;
  };

  const detect = async (replaceTyped: boolean) => {
    set({
      current: { step: "detecting", progress: 0, cancelling: false },
      outcome: undefined,
    });
    try {
      const result = await useDesktopStore.getState().detectSpeakers({
        captureId,
        speakers: get().speakers,
        replaceTyped,
        onProgress: (progress) => {
          const { current } = get();
          if (current.step !== "detecting") return;
          // Still running after Cancel. The app clears a cancel when a run
          // begins, so one sent just before is lost: send it again.
          if (current.cancelling)
            void cancelSpeakerDetection().catch(() => undefined);
          set({ current: { ...current, progress } });
        },
        cancelled: cancelling,
      });
      finish(resultMessage(result));
    } catch (error) {
      if (cancelling()) return finish(messageOf(error));
      // A model that went missing or was damaged is offered again.
      const status = await speakerModelStatus().catch(() => undefined);
      if (status && !status.ready && stillOpen()) {
        set({
          current: { step: "consent", sizeBytes: status.sizeBytes },
          outcome: { captureId, message: messageOf(error) },
        });
        return;
      }
      finish(messageOf(error));
    }
  };

  /** Once the model is here: ask about typed names, or detect at once. */
  const proceed = async () => {
    // A download takes a while: another recording may be open by now.
    if (!stillOpen()) return finishStale();
    const segments = useDesktopStore.getState().transcriptSegments;
    if (
      typedSpeakerNames(segments, speakerLabel, {
        otherLabels: speakerLabelsEverywhere,
      }).length
    )
      set({ current: { step: "choose" } });
    else await detect(false);
  };

  return {
    current: { step: "idle" },
    outcome: undefined,
    speakers: undefined,
    setSpeakers: (speakers) => set({ speakers }),
    start: async () => {
      if (get().current.step !== "idle") return;
      const id = singleCaptureId(useDesktopStore.getState().transcriptSegments);
      if (!id) return;
      captureId = id;
      set({ current: { step: "checking" }, outcome: undefined });
      try {
        const status = await speakerModelStatus();
        if (!status.ready) {
          if (!stillOpen()) return finishStale();
          set({ current: { step: "consent", sizeBytes: status.sizeBytes } });
          return;
        }
      } catch (error) {
        return finish(messageOf(error));
      }
      await proceed();
    },
    download: async () => {
      if (get().current.step !== "consent") return;
      set({
        current: { step: "downloading", progress: 0 },
        outcome: undefined,
      });
      try {
        await downloadSpeakerModel((progress) =>
          set((state) =>
            state.current.step === "downloading"
              ? { current: { step: "downloading", progress } }
              : state,
          ),
        );
      } catch (error) {
        return finish(messageOf(error));
      }
      await proceed();
    },
    choose: async (replaceTyped) => {
      if (get().current.step !== "choose") return;
      await detect(replaceTyped);
    },
    cancel: async () => {
      const { current } = get();
      if (isQuestion(current.step)) {
        set({ current: { step: "idle" }, outcome: undefined });
        return;
      }
      if (current.step !== "detecting" || current.cancelling) return;
      set({ current: { ...current, cancelling: true } });
      await cancelSpeakerDetection().catch(() => undefined);
    },
  };
});
