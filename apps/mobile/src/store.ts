import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { AppState } from "react-native";
import { create } from "zustand";

import { stopCaptureWithAudio, buildTurn } from "./audioCapture";
import type {
  CaptureSession,
  CompanionSettings,
  DictionaryEntry,
  RefinementMode,
  Snippet,
  TranscriptTurn,
} from "./domain";
import { createId, keepsHistory } from "./domain";
import {
  API_FEATURES_ENABLED,
  apiConfig,
  availableRefinementModes,
  effectiveSettings,
  phoneOnlyMigration,
} from "./features";
import {
  fetchLocalTranscriptHistory,
  mergeTranscriptHistory,
  refineWithApi,
  syncQueuedTranscriptTurns,
} from "./localApi";
import { createKeepAwake } from "./keepAwake";
import type { Notice, NoticeChange, NoticeKind } from "./notices";
import {
  emptyEndOutcome,
  noticeFor,
  refineNoticeChange,
  replaceNotice,
} from "./notices";
import {
  cleanTranscript,
  modeNeedsModel,
  refineLocally,
  stylePresetForMode,
} from "./refine";
import { sweepCacheFiles } from "./recordings";
import type { SpeechSession } from "./speech";
import {
  downloadLanguageModel,
  getRecognitionEnvironment,
  invalidateRecognitionEnvironment,
  readDictationPermission,
  requestDictationPermission,
  startSpeechSession,
} from "./speech";
import type {
  PermissionOutcome,
  RecognitionPlan,
  RecognitionPlatform,
} from "./speechPolicy";
import {
  blockedNoticeKind,
  classifySpeechError,
  downloadNoticeAllowed,
  downloadNoticeKind,
  permissionNoticeKind,
  planRecognition,
  systemServicePlan,
} from "./speechPolicy";
import { deviceDefaultSettings, mobileStorage } from "./storage";
import { isUnreadableValueError } from "./storageCore";
import { setTtsPlaybackGuard, ttsController } from "./tts";

interface CompanionState {
  hydrated: boolean;
  settings: CompanionSettings;
  apiToken?: string | undefined;
  history: TranscriptTurn[];
  /** The most recent capture, kept even in ephemeral mode until cleared. */
  latest?: TranscriptTurn | undefined;
  dictionary: DictionaryEntry[];
  snippets: Snippet[];
  capture: CaptureSession;
  level: number;
  /** What the Capture screen tells the user, with the actions it offers. */
  notice: Notice | null;
  /** The plan of the current or last dictation; see speechPolicy.ts. */
  plan: RecognitionPlan | null;
  /**
   * Some saved notes could not be read at launch. Nothing was deleted, and
   * notes are only added or updated until a launch reads them all.
   */
  storageDegraded: boolean;
  /** A language pack download is in progress. */
  downloading: boolean;
  refining: boolean;
  hydrate: () => Promise<void>;
  /**
   * Starts a dictation. allowSystemServiceOnce: the user allowed the system
   * speech service for this dictation only.
   */
  startCapture: (options?: {
    allowSystemServiceOnce?: boolean;
  }) => Promise<void>;
  stopCapture: () => void;
  cancelCapture: () => void;
  /**
   * Saves typed text as a note. False, with nothing saved, when the text is
   * empty or a dictation listens or is processed.
   */
  saveTyped: (text: string) => Promise<boolean>;
  refine: (turnId: string, mode: RefinementMode) => Promise<void>;
  deleteTurn: (turnId: string) => Promise<void>;
  togglePin: (turnId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  eraseAll: () => Promise<void>;
  updateSettings: (patch: Partial<CompanionSettings>) => Promise<void>;
  setApiToken: (token: string) => Promise<void>;
  addDictionaryEntry: (spoken: string, replacement: string) => Promise<boolean>;
  removeDictionaryEntry: (id: string) => Promise<void>;
  addSnippet: (trigger: string, body: string) => Promise<boolean>;
  removeSnippet: (id: string) => Promise<void>;
  /** Asks Android to download the language pack; never starts dictating. */
  downloadModel: () => Promise<void>;
  /** Turns on the system speech service setting, then dictates. */
  allowSystemServiceAlways: () => Promise<void>;
  /** Shows the notice for a permission answer, such as onboarding's. */
  showPermissionOutcome: (outcome: PermissionOutcome) => void;
  dismissNotice: () => void;
}

const idleCapture: CaptureSession = {
  id: "idle",
  status: "idle",
  elapsedMs: 0,
  partialTranscript: "",
};

let activeSession: SpeechSession | null = null;
/** Set while a start reads the device and asks for permissions. */
let starting = false;
/** hydrate registered the AppState listener. */
let watchingAppState = false;
/** The dictation that stopped because the app went to the background. */
let backgroundStopId: string | null = null;

/** Dictations that reached 'listening'; see downloadModel. */
let dictationsStarted = 0;

const KEEP_AWAKE_TAG = "sonolect-dictation";
/**
 * Keeps the screen on while dictating. Only the dictation that holds it, or
 * an exit that ends every dictation, releases it.
 */
const screenAwake = createKeepAwake({
  activate: () => activateKeepAwakeAsync(KEEP_AWAKE_TAG),
  deactivate: () => deactivateKeepAwake(KEEP_AWAKE_TAG),
});

/**
 * Deletes the recordings and recorder temp files in the cache, unless a
 * dictation runs: its recorder may still write one. The next launch sweeps
 * then.
 */
function sweepCacheWhenIdle(): void {
  if (!activeSession) sweepCacheFiles();
}

export const useCompanionStore = create<CompanionState>((set, get) => {
  // Bumped whenever stored history is wiped, so in-flight sync/persist work
  // started before the wipe cannot write transcripts back afterwards.
  let dataEpoch = 0;
  const stillAllowed = (epoch: number) =>
    epoch === dataEpoch && keepsHistory(get().settings);

  /**
   * Runs a write to the phone's storage. A failure keeps the change in
   * memory and shows a notice; it never throws to the screen.
   */
  const persist = async (write: () => Promise<void>): Promise<boolean> => {
    try {
      await write();
      return true;
    } catch (error) {
      // A value that couldn't be read at launch is never overwritten.
      set({
        notice: noticeFor(
          isUnreadableValueError(error)
            ? "storageReadError"
            : "storageWriteError",
        ),
      });
      return false;
    }
  };

  /** The state for a notice change (notices.ts); {} when there is none. */
  const noticePatch = (
    change: NoticeChange | null,
  ): Partial<CompanionState> => {
    if (!change) return {};
    return change.resetStatus
      ? { notice: change.notice, capture: idleCapture }
      : { notice: change.notice };
  };

  /** Every note is kept: there is no local cap (data-2). */
  const persistHistory = async (history: TranscriptTurn[]) => {
    const epoch = dataEpoch;
    set({ history });
    const { settings, apiToken } = get();
    if (!keepsHistory(settings)) return;
    const config = apiConfig(settings, apiToken);
    if (config.apiUrl) {
      const synced = await syncQueuedTranscriptTurns(history, config);
      if (!stillAllowed(epoch)) return;
      if (synced !== history) applySyncResult(history, synced);
    }
    if (!stillAllowed(epoch)) return;
    await persist(() => mobileStorage.saveNotes(get().history));
  };

  /**
   * Maps server ids/sync state onto the current history (which may have
   * changed during the request) and onto `latest`. A turn edited meanwhile
   * only takes the new id and stays queued so its edit is synced next time.
   */
  const applySyncResult = (
    before: TranscriptTurn[],
    after: TranscriptTurn[],
  ) => {
    const updates = new Map<
      string,
      { original: TranscriptTurn; synced: TranscriptTurn }
    >();
    before.forEach((original, index) => {
      const synced = after[index];
      if (synced && synced !== original) {
        updates.set(original.id, { original, synced });
      }
    });
    const reconcile = (turn: TranscriptTurn): TranscriptTurn => {
      const update = updates.get(turn.id);
      if (!update) return turn;
      return turn === update.original
        ? update.synced
        : { ...turn, id: update.synced.id };
    };
    const latest = get().latest;
    set({
      history: get().history.map(reconcile),
      ...(latest ? { latest: reconcile(latest) } : {}),
    });
  };

  const addTurn = async (turn: TranscriptTurn) => {
    set({ latest: turn });
    if (keepsHistory(get().settings)) {
      await persistHistory([turn, ...get().history]);
    }
  };

  const replaceTurn = async (turn: TranscriptTurn) => {
    if (get().latest?.id === turn.id) set({ latest: turn });
    const history = get().history.map((item) =>
      item.id === turn.id ? turn : item,
    );
    await persistHistory(history);
  };

  /**
   * After a 'not-allowed' error, reads the permissions again to tell a denial
   * the user can still answer from one only Settings can lift. When both are
   * granted, the speech service itself refused.
   */
  const explainNotAllowed = async (
    shown: Notice,
    needsSpeechRecognizer: boolean,
  ) => {
    const outcome = await readDictationPermission({ needsSpeechRecognizer });
    if (!outcome || get().notice !== shown) return;
    const kind = permissionNoticeKind(outcome) ?? "serviceNotAllowed";
    if (kind !== shown.kind) {
      set({ notice: noticeFor(kind, get().settings.language) });
    }
  };

  const beginCapture = async (consentOnce: boolean) => {
    set({ notice: null });
    const { settings, apiToken } = get();
    const { language } = settings;
    const environment = await getRecognitionEnvironment(language);
    const platform: RecognitionPlatform = environment.platform;
    const plan = planRecognition({
      ...environment,
      privacyLevel: settings.privacyLevel,
      language,
      allowSystemService: settings.allowSystemService,
      consentOnce,
    });
    if (plan.route === "blocked") {
      screenAwake.release();
      set({
        capture: idleCapture,
        level: 0,
        notice: noticeFor(
          blockedNoticeKind(plan.blockedReason ?? "unavailable"),
          language,
        ),
      });
      return;
    }

    const permission = await requestDictationPermission({
      needsSpeechRecognizer: platform === "ios" && plan.route !== "on-device",
    });
    const deniedKind = permissionNoticeKind(permission);
    if (deniedKind) {
      screenAwake.release();
      set({
        capture: { ...idleCapture, status: "error" },
        level: 0,
        notice: noticeFor(deniedKind, language),
      });
      return;
    }

    const startedAt = new Date().toISOString();
    const captureId = createId("capture");
    /** The last error notice this dictation raised. */
    let raised: Notice | null = null;
    backgroundStopId = null;
    dictationsStarted += 1;
    set({
      notice: null,
      level: 0,
      plan,
      capture: {
        id: captureId,
        status: "listening",
        startedAt,
        elapsedMs: 0,
        partialTranscript: "",
      },
    });
    screenAwake.hold(captureId);

    // Assigned once the session exists; its handlers only run after that.
    let session: SpeechSession | null = null;
    let ended = false;
    session = startSpeechSession(
      {
        language,
        plan,
        fallbackToSystemService: settings.allowSystemService || consentOnce,
        persistAudio: Boolean(apiConfig(settings, apiToken).apiUrl),
      },
      {
        onTranscript: (text) => {
          const capture = get().capture;
          if (capture.id !== captureId) return;
          set({ capture: { ...capture, partialTranscript: text } });
        },
        onLevel: (level) => {
          if (get().capture.id === captureId) set({ level });
        },
        onError: (code) => {
          if (get().capture.id !== captureId) return;
          const current = get().plan;
          const kind = classifySpeechError(code, {
            requiresOnDevice: current?.requiresOnDevice ?? false,
            platform,
          });
          if (kind === "benign" || kind === "aborted") return;
          // Never a switch to the system speech service here: that needs
          // the user's consent (the notice offers it).
          const notice = noticeFor(kind, language);
          raised = notice;
          set({ notice });
          if (kind === "modelMissing") invalidateRecognitionEnvironment();
          if (kind === "micDenied") {
            void explainNotAllowed(
              notice,
              platform === "ios" && current?.route !== "on-device",
            );
          }
        },
        onRouteChange: () => {
          if (get().capture.id === captureId) {
            set({
              plan: systemServicePlan(platform, environment.osVersion),
            });
          }
        },
        onEnd: async ({ text, audio, notice: endNotice }) => {
          ended = true;
          if (activeSession === session) activeSession = null;
          // Before the check below: this dictation's hold ends with it, even
          // when something else replaced it on the screen.
          screenAwake.release(captureId);
          const capture = get().capture;
          if (capture.id !== captureId) return;
          const backgrounded = backgroundStopId === captureId;
          if (backgrounded) backgroundStopId = null;
          // Leaving the screen explains the end better than the error it
          // may have caused, such as an iOS interruption.
          const endKind: NoticeKind | undefined = backgrounded
            ? "backgrounded"
            : endNotice;
          set({
            level: 0,
            capture: { ...capture, status: "processing" },
            ...(endKind && get().notice?.kind !== endKind
              ? { notice: noticeFor(endKind, language) }
              : {}),
          });
          const state = get();
          const turn = await stopCaptureWithAudio({
            captureStartedAt: startedAt,
            settings: {
              ...effectiveSettings(state.settings),
              ...(API_FEATURES_ENABLED && state.apiToken
                ? { apiToken: state.apiToken }
                : {}),
            },
            recognizedText: text,
            audio,
            dictionary: state.dictionary,
            snippets: state.snippets,
          });
          if (get().capture.id !== captureId) return;
          if (!turn) {
            // Only an error this dictation raised reads ATTENTION; an empty
            // dictation is no error, nor is one the app stopped when it left
            // the screen.
            if (backgrounded) {
              set({ capture: idleCapture });
              return;
            }
            const outcome = emptyEndOutcome(raised, get().notice);
            set({
              capture: { ...idleCapture, status: outcome.status },
              notice: outcome.notice,
            });
            return;
          }
          // The Capture screen shows and announces `latest` once ready.
          set({
            capture: {
              ...idleCapture,
              status: "ready",
              partialTranscript: turn.refinedText,
            },
            latest: turn,
          });
          await addTurn(turn);
        },
      },
    );
    if (session && !ended) activeSession = session;

    if (!session) screenAwake.release(captureId);
    if (!session && get().capture.id === captureId) {
      set({
        capture: { ...idleCapture, status: "error" },
        level: 0,
        notice: get().notice ?? noticeFor("startFailed"),
      });
    }
  };

  /**
   * The app went to the background while dictating: the microphone stops
   * there, so the dictation ends and keeps its text.
   */
  const stopForBackground = () => {
    const capture = get().capture;
    if (capture.status !== "listening") return;
    backgroundStopId = capture.id;
    get().stopCapture();
    screenAwake.release();
    if (get().notice?.kind !== "backgrounded") {
      set({ notice: noticeFor("backgrounded") });
    }
  };

  return {
    hydrated: false,
    // Until hydrate reads the stored settings, and if it cannot.
    settings: deviceDefaultSettings(),
    history: [],
    dictionary: [],
    snippets: [],
    capture: idleCapture,
    level: 0,
    notice: null,
    plan: null,
    storageDegraded: false,
    downloading: false,
    refining: false,

    hydrate: async () => {
      if (!watchingAppState) {
        watchingAppState = true;
        AppState.addEventListener("change", (state) => {
          // A language pack installed in the system settings, or a
          // recognizer changed there, shows up back in the foreground.
          if (state === "active") invalidateRecognitionEnvironment();
          // Never 'inactive': Control Center, Notification Center, Face ID,
          // system alerts and app-switcher peeks pass through it too.
          if (state === "background") stopForBackground();
        });
      }
      let settings: CompanionSettings;
      let history: TranscriptTurn[];
      let apiToken: string | undefined;
      try {
        const [settingsRead, notesRead, dictionaryRead, snippetsRead, token] =
          await Promise.all([
            mobileStorage.loadSettings(),
            mobileStorage.loadNotes(),
            mobileStorage.loadDictionary(),
            mobileStorage.loadSnippets(),
            mobileStorage.loadApiToken(),
          ]);
        settings = settingsRead.value;
        history = notesRead.notes;
        apiToken = token;
        if (!API_FEATURES_ENABLED) {
          // Phone-only build: data from a build with the API (sync on, an
          // API URL, queued notes) becomes local before anything else runs.
          // A failed write is retried at the next launch; it must not keep
          // the app on the splash screen.
          const migrated = phoneOnlyMigration(settings, history);
          settings = migrated.settings;
          history = migrated.history;
          if (migrated.changed) {
            await Promise.all([
              mobileStorage.saveSettings(settings).catch(() => undefined),
              mobileStorage.saveNotes(history).catch(() => undefined),
            ]);
          }
          // No dormant credential stays on the phone, including one that
          // survived a reinstall in the iOS keychain.
          if (apiToken) {
            apiToken = undefined;
            await mobileStorage.saveApiToken(undefined).catch(() => undefined);
          }
        }
        // Nothing was deleted: the next launch reads again.
        const readFailed =
          !settingsRead.ok ||
          !notesRead.ok ||
          !dictionaryRead.ok ||
          !snippetsRead.ok;
        set({
          settings,
          history,
          dictionary: dictionaryRead.value,
          snippets: snippetsRead.value,
          ...(apiToken ? { apiToken } : {}),
          latest: history[0],
          storageDegraded: !notesRead.ok,
          ...(readFailed ? { notice: noticeFor("storageReadError") } : {}),
          hydrated: true,
        });
      } catch {
        // The loads report failures instead of throwing; whatever happens,
        // the app leaves the splash screen (_layout.tsx waits for this).
        set({
          hydrated: true,
          storageDegraded: true,
          notice: noticeFor("storageReadError"),
        });
        return;
      } finally {
        // No dictation runs yet: delete what earlier launches left in the
        // cache (speech-7).
        sweepCacheFiles();
      }

      const config = apiConfig(settings, apiToken);
      if (!config.apiUrl || !keepsHistory(settings)) return;
      const epoch = dataEpoch;
      try {
        const synced = await syncQueuedTranscriptTurns(history, config);
        const remote = await fetchLocalTranscriptHistory(config);
        if (!stillAllowed(epoch)) return;
        const merged = mergeTranscriptHistory(synced, remote);
        set({ history: merged, latest: merged[0] });
        await persist(() => mobileStorage.saveNotes(merged));
      } catch {
        // Offline: keep local history as is.
      }
    },

    startCapture: async (options) => {
      const { status } = get().capture;
      if (starting || status === "listening" || status === "processing") {
        return;
      }
      starting = true;
      try {
        // Read-aloud would be heard by the microphone and written into the
        // dictation (speech-4); its iOS session is given back first.
        await ttsController.stop();
        await beginCapture(options?.allowSystemServiceOnce === true);
      } finally {
        starting = false;
      }
    },

    stopCapture: () => {
      if (get().capture.status !== "listening") return;
      set({ capture: { ...get().capture, status: "processing" } });
      activeSession?.stop();
    },

    cancelCapture: () => {
      activeSession?.abort();
      activeSession = null;
      screenAwake.release();
      set({ capture: idleCapture, level: 0 });
    },

    saveTyped: async (text: string) => {
      const raw = text.trim();
      if (!raw) return false;
      // The dictation's own end would find its capture replaced and drop
      // its text.
      const { status } = get().capture;
      if (status === "listening" || status === "processing") return false;
      const { settings, dictionary, snippets } = get();
      const turn = buildTurn({
        settings,
        rawText: raw,
        refinedText: cleanTranscript(raw, {
          language: settings.language,
          dictionary,
          snippets,
        }),
        startedAtMs: Date.now(),
        durationMs: 0,
        source: "typed",
      });
      set({
        notice: null,
        capture: {
          ...idleCapture,
          status: "ready",
          partialTranscript: turn.refinedText,
        },
        latest: turn,
      });
      await addTurn(turn);
      return true;
    },

    refine: async (turnId: string, mode: RefinementMode) => {
      // Rewrite and Reply need the API; the phone-only build does not offer
      // them.
      if (!availableRefinementModes().includes(mode)) return;
      const { history, latest, settings, apiToken, dictionary, snippets } =
        get();
      const source =
        history.find((turn) => turn.id === turnId) ??
        (latest?.id === turnId ? latest : undefined);
      if (!source) return;
      // A refinement clears only its own notices: a dictation's error stays
      // with its ATTENTION status.
      set({
        refining: true,
        ...noticePatch(
          refineNoticeChange(get().notice, get().capture.status, null),
        ),
      });

      let refined: TranscriptTurn | null = null;
      let notice: Notice | null = null;
      try {
        const context = { language: source.language, dictionary, snippets };
        let refinedText = refineLocally(source.rawText, mode, context);

        const config = apiConfig(settings, apiToken);
        if (config.apiUrl) {
          const result = await refineWithApi(
            source.rawText,
            stylePresetForMode(mode),
            config,
            {
              locale: source.language,
              dictionary: dictionary.map((entry) => ({
                spoken: entry.spoken,
                written: entry.replacement,
              })),
            },
          );
          if (result.status === "completed") refinedText = result.text;
          else if (modeNeedsModel(mode)) notice = noticeFor("needsModel");
        } else if (modeNeedsModel(mode)) {
          notice = noticeFor("needsModel");
        }

        refined = {
          ...source,
          mode,
          refinedText,
          syncState:
            source.syncState === "synced" || source.syncState === "queued"
              ? "queued"
              : source.syncState,
        };
      } catch {
        // The note stays as it was. The Capture screen calls `void refine()`,
        // so a throw would only be an unhandled rejection: say so instead.
        notice = noticeFor("refineFailed");
      }
      set({
        refining: false,
        ...noticePatch(
          refineNoticeChange(get().notice, get().capture.status, notice),
        ),
      });
      if (!refined) return;
      if (get().latest?.id === turnId) set({ latest: refined });
      if (history.some((turn) => turn.id === turnId)) {
        await replaceTurn(refined);
      }
    },

    deleteTurn: async (turnId: string) => {
      // Its Listen button, and so its Stop, goes away with it.
      if (ttsController.getState().ownerId === turnId) {
        void ttsController.stop();
      }
      if (get().latest?.id === turnId) set({ latest: undefined });
      await persistHistory(get().history.filter((turn) => turn.id !== turnId));
    },

    togglePin: async (turnId: string) => {
      const turn = get().history.find((item) => item.id === turnId);
      if (!turn) return;
      await replaceTurn({ ...turn, pinned: !turn.pinned });
    },

    clearHistory: async () => {
      dataEpoch += 1;
      set({ history: [], latest: undefined });
      if (await persist(() => mobileStorage.clearNotes())) {
        set({ storageDegraded: false });
      }
      sweepCacheWhenIdle();
    },

    eraseAll: async () => {
      dataEpoch += 1;
      void ttsController.stop();
      activeSession?.abort();
      activeSession = null;
      screenAwake.release();
      const erased = await persist(() => mobileStorage.eraseAll());
      // The dictation was cancelled above: no recorder uses these files.
      sweepCacheFiles();
      if (!erased) {
        // What is left on the phone stays shown; the notice asks to retry.
        set({ capture: idleCapture, level: 0 });
        return;
      }
      set({
        // Back to a first run, which follows the device language (ux-5).
        settings: deviceDefaultSettings(),
        history: [],
        latest: undefined,
        dictionary: [],
        snippets: [],
        apiToken: undefined,
        capture: idleCapture,
        level: 0,
        notice: null,
        storageDegraded: false,
      });
    },

    updateSettings: async (patch: Partial<CompanionSettings>) => {
      const previous = get().settings;
      // While the API is off, no screen can turn sync on or set an API URL.
      const settings = effectiveSettings({ ...previous, ...patch });
      set({ settings });
      await persist(() => mobileStorage.saveSettings(settings));
      if (!keepsHistory(settings) && keepsHistory(previous)) {
        // Turning history off or going ephemeral removes what was stored,
        // and the recordings in the cache (data-15).
        dataEpoch += 1;
        if (await persist(() => mobileStorage.clearNotes())) {
          set({ history: [], storageDegraded: false });
        }
        sweepCacheWhenIdle();
      }
      if (settings.cloudSyncEnabled && !previous.cloudSyncEnabled) {
        await persistHistory(
          get().history.map((turn) =>
            turn.syncState === "local"
              ? { ...turn, syncState: "queued" }
              : turn,
          ),
        );
      }
    },

    setApiToken: async (token: string) => {
      if (!API_FEATURES_ENABLED) return;
      const trimmed = token.trim();
      if (
        await persist(() => mobileStorage.saveApiToken(trimmed || undefined))
      ) {
        set(trimmed ? { apiToken: trimmed } : { apiToken: undefined });
      }
    },

    addDictionaryEntry: async (spoken: string, replacement: string) => {
      const s = spoken.trim();
      const r = replacement.trim();
      if (!s || !r) return false;
      const existing = get().dictionary;
      if (
        existing.some((entry) => entry.spoken.toLowerCase() === s.toLowerCase())
      ) {
        return false;
      }
      const dictionary = [
        ...existing,
        { id: createId("dict"), spoken: s, replacement: r },
      ];
      set({ dictionary });
      await persist(() => mobileStorage.saveDictionary(dictionary));
      return true;
    },

    removeDictionaryEntry: async (id: string) => {
      const dictionary = get().dictionary.filter((entry) => entry.id !== id);
      set({ dictionary });
      await persist(() => mobileStorage.saveDictionary(dictionary));
    },

    addSnippet: async (trigger: string, body: string) => {
      const t = trigger.trim();
      const b = body.trim();
      if (!t || !b) return false;
      const existing = get().snippets;
      if (
        existing.some(
          (snippet) => snippet.trigger.toLowerCase() === t.toLowerCase(),
        )
      ) {
        return false;
      }
      const snippets = [
        ...existing,
        { id: createId("snippet"), trigger: t, body: b },
      ];
      set({ snippets });
      await persist(() => mobileStorage.saveSnippets(snippets));
      return true;
    },

    removeSnippet: async (id: string) => {
      const snippets = get().snippets.filter((snippet) => snippet.id !== id);
      set({ snippets });
      await persist(() => mobileStorage.saveSnippets(snippets));
    },

    downloadModel: async () => {
      if (get().downloading) return;
      const { language } = get().settings;
      const startedBefore = dictationsStarted;
      set({ downloading: true });
      try {
        const outcome = await downloadLanguageModel(language);
        // It can settle minutes later. When the outcome is not shown, the
        // download still refreshed the plan and the badge (speech.ts).
        const { capture, notice } = get();
        if (
          !downloadNoticeAllowed({
            status: capture.status,
            dictationStartedSince: dictationsStarted !== startedBefore,
            hasNotice: notice !== null,
          })
        ) {
          return;
        }
        set(
          noticePatch(
            replaceNotice(
              capture.status,
              noticeFor(downloadNoticeKind(outcome), language),
            ),
          ),
        );
      } finally {
        set({ downloading: false });
      }
    },

    allowSystemServiceAlways: async () => {
      await get().updateSettings({ allowSystemService: true });
      await get().startCapture();
    },

    showPermissionOutcome: (outcome: PermissionOutcome) => {
      const kind = permissionNoticeKind(outcome);
      if (kind) set({ notice: noticeFor(kind, get().settings.language) });
    },

    dismissNotice: () => {
      // Without its notice, an error status would read ATTENTION for nothing.
      set(noticePatch(replaceNotice(get().capture.status, null)));
    },
  };
});

// Read-aloud never starts while a dictation starts, listens or is processed
// (speech-4).
setTtsPlaybackGuard(() => {
  const { status } = useCompanionStore.getState().capture;
  return !starting && status !== "listening" && status !== "processing";
});
