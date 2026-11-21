/**
 * The steps of "Detect speakers" in the segment editor: asking before the
 * first model download, asking whether typed names stay, then progress and
 * Cancel. They live outside the editor, so a detection that is running is
 * still shown after leaving the page and coming back.
 */
import { create } from "zustand";
import { getT } from "./i18n";
import { singleCaptureId, typedSpeakerNames } from "./segmentEditor";
import { useDesktopStore } from "./store/appStore";
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

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const useSpeakerDetection = create<SpeakerDetectionState>((set, get) => {
  let captureId = "";

  const finish = (message: string) =>
    set({ current: { step: "idle" }, outcome: { captureId, message } });

  const detect = async (replaceTyped: boolean) => {
    set({
      current: { step: "detecting", progress: 0, cancelling: false },
      outcome: undefined,
    });
    try {
      const result = await useDesktopStore.getState().detectSpeakers({
        speakers: get().speakers,
        replaceTyped,
        onProgress: (progress) =>
          set((state) =>
            state.current.step === "detecting"
              ? { current: { ...state.current, progress } }
              : state,
          ),
      });
      const t = getT();
      finish(
        result.status === "labelled"
          ? t.count("studio.speakers.found", result.speakers)
          : result.status === "silent"
            ? t("studio.speakers.noSpeech")
            : t("studio.speakers.stale"),
      );
    } catch (error) {
      const { current } = get();
      if (current.step === "detecting" && current.cancelling)
        return finish(messageOf(error));
      // A model that went missing or was damaged is offered again.
      const status = await speakerModelStatus().catch(() => undefined);
      if (status && !status.ready) {
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
    const segments = useDesktopStore.getState().transcriptSegments;
    if (typedSpeakerNames(segments, speakerLabel).length)
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
      if (current.step === "consent" || current.step === "choose") {
        set({ current: { step: "idle" }, outcome: undefined });
        return;
      }
      if (current.step !== "detecting" || current.cancelling) return;
      set({ current: { ...current, cancelling: true } });
      await cancelSpeakerDetection().catch(() => undefined);
    },
  };
});
