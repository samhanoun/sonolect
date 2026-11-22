import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { saveTranscriptDraft, clearTranscriptDraft } from "./persistence";
import { transcriptUndoAction } from "./transcriptUndo";
import {
  isTauriRuntime,
  registerNativeDictationShortcuts,
} from "./desktopNative";
import DictationBubble from "./components/DictationBubble";
import { useDictationBubbleBridge } from "./bubbleBridge";
import { useSyncLifecycle } from "./sync/useSync";
import "./tailwind.css";
import StudioShell from "./components/StudioShell";
import { useDesktopStore } from "./store/appStore";
/* ── App Shell ───────────────────────────────────────────────── */

/** Hotkey captures paste into the focused app, unless Sonolect itself has focus. */
function hotkeySource(): "app" | "hotkey" {
  return document.hasFocus() ? "app" : "hotkey";
}

function App() {
  useDictationBubbleBridge();
  // Note sync runs in the main window only, and only in a build that has it.
  useSyncLifecycle();
  const setCommandOpen = useDesktopStore((state) => state.setCommandOpen);
  const toggleRecording = useDesktopStore((state) => state.toggleRecording);
  const loadTranscriptHistory = useDesktopStore(
    (state) => state.loadTranscriptHistory,
  );
  const activeSessionId = useDesktopStore((state) => state.activeSessionId);
  const transcript = useDesktopStore((state) => state.transcript);
  const transcriptSegments = useDesktopStore(
    (state) => state.transcriptSegments,
  );
  const selectedSegmentIds = useDesktopStore(
    (state) => state.selectedSegmentIds,
  );
  const openedVersion = useDesktopStore((state) => state.openedVersion);
  const undoTranscriptEdit = useDesktopStore(
    (state) => state.undoTranscriptEdit,
  );
  const redoTranscriptEdit = useDesktopStore(
    (state) => state.redoTranscriptEdit,
  );

  useEffect(() => {
    void loadTranscriptHistory();
  }, [loadTranscriptHistory]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      // Another field (the dictionary, the search) keeps its own undo.
      const undo = transcriptUndoAction(
        event,
        useDesktopStore.getState().activeView === "transcribe",
      );
      if (undo) {
        event.preventDefault();
        if (undo === "redo") redoTranscriptEdit();
        else undoTranscriptEdit();
      }
      // Hands-free toggle: ⌘⇧M — press to start, press to stop
      if (
        !isTauriRuntime() &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "m"
      ) {
        event.preventDefault();
        toggleRecording();
      }
      // Push-to-talk: ⌘⇧V — hold to record
      if (
        !isTauriRuntime() &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "v" &&
        !event.repeat
      ) {
        event.preventDefault();
        const { recordingState: rs } = useDesktopStore.getState();
        if (rs === "idle" || rs === "completed" || rs === "error") {
          if (rs === "completed" || rs === "error") {
            useDesktopStore.getState().resetVoiceCapture();
          }
          void useDesktopStore.getState().startVoiceCapture();
        }
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
      }
    };

    // Push-to-talk release: stop recording when ⌘⇧V is released
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "v") {
        const { recordingState: rs } = useDesktopStore.getState();
        if (
          !isTauriRuntime() &&
          (rs === "recording" || rs === "requesting-permission")
        ) {
          useDesktopStore.getState().stopVoiceCapture();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [setCommandOpen, toggleRecording, undoTranscriptEdit, redoTranscriptEdit]);

  useEffect(() => {
    let unregister: (() => Promise<void>) | undefined;
    const startPushToTalk = () => {
      const { recordingState: rs } = useDesktopStore.getState();
      if (rs === "idle" || rs === "completed" || rs === "error") {
        if (rs === "completed" || rs === "error") {
          useDesktopStore.getState().resetVoiceCapture();
        }
        void useDesktopStore.getState().startVoiceCapture(hotkeySource());
      }
    };
    const stopPushToTalk = () => {
      const { recordingState: rs } = useDesktopStore.getState();
      if (rs === "recording" || rs === "requesting-permission") {
        useDesktopStore.getState().stopVoiceCapture();
      }
    };

    void registerNativeDictationShortcuts({
      onToggle: () =>
        useDesktopStore.getState().toggleRecording(hotkeySource()),
      onPushToTalkStart: startPushToTalk,
      onPushToTalkStop: stopPushToTalk,
    }).then((registration) => {
      unregister = registration.unregister;
      if (!registration.enabled && isTauriRuntime()) {
        useDesktopStore.getState().addToast("toast.shortcutsUnavailable");
      }
    });

    return () => {
      if (unregister) void unregister();
    };
  }, []);

  useEffect(() => {
    if (!transcript.trim() && transcriptSegments.length === 0) {
      clearTranscriptDraft();
      return;
    }
    saveTranscriptDraft({
      activeSessionId,
      transcript,
      transcriptSegments,
      selectedSegmentIds,
      savedAt: new Date().toISOString(),
      openedVersion,
    });
  }, [
    activeSessionId,
    transcript,
    transcriptSegments,
    selectedSegmentIds,
    openedVersion,
  ]);

  return <StudioShell />;
}

/* ── Mount ───────────────────────────────────────────────────── */

const isBubbleWindow =
  new URLSearchParams(window.location.search).get("window") === "recorder";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isBubbleWindow ? <DictationBubble /> : <App />}
  </React.StrictMode>,
);
