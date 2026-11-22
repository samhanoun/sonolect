import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { AppState, Platform } from "react-native";
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
  SYNC_URL,
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
import type { OnlineChoice } from "./onlineEdit";
import { planOnlineEdit, runOnlineEdit } from "./onlineEdit";
import type { OnlineEditing, OnlinePlan, OnlineProvider } from "./onlineRefine";
import {
  isOnlineEditingReady,
  normalizeOnlineEditing,
  normalizeProviderKey,
} from "./onlineRefine";
import { providerFetch } from "./providerFetch";
import type { ProviderKeyStatus } from "./providerKeys";
import { NO_PROVIDER_KEYS } from "./providerKeys";
import {
  cleanTranscript,
  modeNeedsModel,
  refineLocally,
  stylePresetForMode,
} from "./refine";
import { sweepCacheFiles } from "./recordings";
import { applyRetention } from "./retention";
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
import type { SyncController, SyncPause } from "./sync/controller";
import {
  type DeleteScope,
  type Stamp,
  type Tombstone,
  addNote,
  changeNote,
  deleteNotes,
} from "./sync/edits";
import { createNotesHost, createSyncNoteStore } from "./sync/noteStore";
import { createAppSync } from "./sync/runtime";
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
  /** The mode being applied while refining. */
  refiningMode: RefinementMode | null;
  /** The provider an online edit is waiting for, if any. */
  sendingTo: OnlineProvider | null;
  /**
   * Which providers have a key saved in SecureStore. Only booleans: the key
   * itself is read at send time and never kept in state.
   */
  onlineKeySaved: ProviderKeyStatus;
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
  /**
   * Applies a refinement mode. Rewrite and Reply with online editing send
   * the note only after consent: consentedTo, the provider and model the
   * dialog named when the user tapped Send, or "Always allow" outside
   * Ephemeral. Without it nothing happens, so the Capture screen asks first
   * (see onlinePlan).
   */
  refine: (
    turnId: string,
    mode: RefinementMode,
    options?: { consentedTo?: OnlineChoice },
  ) => Promise<void>;
  /** What a tap on a note's chip does: refine here, ask, or send. */
  onlinePlan: (turnId: string, mode: RefinementMode) => OnlinePlan;
  deleteTurn: (turnId: string) => Promise<void>;
  togglePin: (turnId: string) => Promise<void>;
  /**
   * Deletes every note. "everywhere" (Settings): with sync on, the other
   * devices delete them too. "here": this phone only (the recovery screen).
   */
  clearHistory: (scope: DeleteScope) => Promise<void>;
  /**
   * Erases all data. With sync on, also forgets the sync key and state,
   * after deleting the server copy when asked: when that delete fails,
   * nothing is erased.
   */
  eraseAll: (options?: { deleteServerCopy?: boolean }) => Promise<EraseOutcome>;
  updateSettings: (patch: Partial<CompanionSettings>) => Promise<void>;
  setApiToken: (token: string) => Promise<void>;
  /**
   * Saves the user's key for a provider in SecureStore. "invalid": not a
   * key the provider could accept, nothing saved. "failed": SecureStore
   * refused it, or the web preview, which keeps no keys.
   */
  saveProviderKey: (
    provider: OnlineProvider,
    key: string,
  ) => Promise<"saved" | "invalid" | "failed">;
  removeProviderKey: (provider: OnlineProvider) => Promise<void>;
  /**
   * Sets the provider and model for online editing, or turns it off
   * (undefined). False, with nothing changed, for an invalid choice.
   */
  setOnlineEditing: (editing: OnlineEditing | undefined) => Promise<boolean>;
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

/**
 * What Erase all did. failed: the phone's storage could not be erased (a
 * notice says so). serverCopyKept: the server copy could not be deleted,
 * and nothing was erased.
 */
export type EraseOutcome = "erased" | "failed" | "serverCopyKept";

/** This build's sync (features.ts SYNC_URL); null in builds without one. */
let appSync: SyncController | null = null;

/** The phone's sync, for Settings and the join screen; null in builds without sync. */
export function syncController(): SyncController | null {
  return appSync;
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
   * The notes dictated or typed in Ephemeral. One can stay on the Capture
   * screen after the user leaves Ephemeral, and online editing still asks
   * before sending it.
   */
  const ephemeralNotes = new Set<string>();

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

  /** Set once hydrate is done with the notes: sync may write them. */
  let syncReady = false;
  /** Why sync waits: history off, or notes not read (yet). */
  const syncPause = (): SyncPause | null => {
    const { settings, storageDegraded } = get();
    if (!keepsHistory(settings)) return "historyOff";
    if (!syncReady || storageDegraded) return "storage";
    return null;
  };

  // Sync reads the notes shown here and writes remote changes through the
  // phone's storage (src/sync/noteStore.ts). None in builds without a sync
  // server: then nothing below stamps, records or syncs anything.
  const sync = SYNC_URL
    ? createAppSync({
        serverUrl: SYNC_URL,
        notes: createSyncNoteStore(
          createNotesHost({
            read: () => {
              const { history, latest } = get();
              return { history, latest, writable: syncPause() === null };
            },
            update: (patch) => set(patch),
            apply: (change) => mobileStorage.applyNotes(change),
            readCompanion: (id) => mobileStorage.readSyncCompanion(id),
            generation: () => dataEpoch,
            now: Date.now,
            onRemoved: (ids) => {
              // A note another device deleted takes its Listen button along.
              const speaking = ttsController.getState().ownerId;
              if (speaking && ids.includes(speaking)) void ttsController.stop();
            },
          }),
        ),
        paused: syncPause,
        retentionDays: () => get().settings.retentionDays,
      })
    : null;
  appSync = sync;
  /** A new HLC for each note created or changed here (src/sync/edits.ts). */
  const stamp: Stamp = sync ? (previous) => sync.stamp(previous) : null;

  /** At launch, once the notes are read (and merged with the API's). */
  const startSync = () => {
    if (!sync) return;
    syncReady = true;
    void sync.start();
    // Started early by the app coming to the foreground: runs now.
    sync.refresh();
  };

  /** Deletes the other devices make too; recorded before the notes go. */
  const recordDeletes = (tombstones: Tombstone[]): Promise<void> =>
    sync && tombstones.length > 0
      ? sync.recordDeletes(tombstones).catch(() => undefined)
      : Promise.resolve();

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
   * Deletes the notes past the retention limit (retention.ts): at launch,
   * each time the app comes back to the foreground, and when the limit
   * changes. Notes that could not be read are left alone. Returns how many
   * notes were deleted.
   */
  const enforceRetention = async (): Promise<number> => {
    const { settings, history, latest, storageDegraded } = get();
    if (!keepsHistory(settings) || storageDegraded) return 0;
    const { kept, expired } = applyRetention(
      history,
      settings.retentionDays,
      Date.now(),
    );
    if (expired.length === 0) return 0;
    const gone = new Set(expired.map((turn) => turn.id));
    // A deleted note's Listen button, and so its Stop, goes away with it.
    const speaking = ttsController.getState().ownerId;
    if (speaking && gone.has(speaking)) void ttsController.stop();
    if (latest && gone.has(latest.id)) set({ latest: undefined });
    await persistHistory(kept);
    return expired.length;
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

  const addTurn = async (captured: TranscriptTurn) => {
    if (get().settings.privacyLevel === "ephemeral") {
      ephemeralNotes.add(captured.id);
    }
    const { history, turn } = addNote(get().history, captured, stamp);
    set({ latest: turn });
    if (keepsHistory(get().settings)) {
      await persistHistory(history);
      sync?.noteChanged();
    }
  };

  /** An edit, a refine or a pin. */
  const replaceTurn = async (changed: TranscriptTurn) => {
    const { history, turn } = changeNote(get().history, changed, stamp);
    if (get().latest?.id === turn.id) set({ latest: turn });
    await persistHistory(history);
    sync?.noteChanged();
  };

  /** A note in the history, or the latest capture (Ephemeral keeps only it). */
  const findTurn = (turnId: string): TranscriptTurn | undefined => {
    const { history, latest } = get();
    return (
      history.find((turn) => turn.id === turnId) ??
      (latest?.id === turnId ? latest : undefined)
    );
  };

  const doneRefining = {
    refining: false,
    refiningMode: null,
    sendingTo: null,
  } as const;

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
          // Capture shows `latest` once ready; the root layout announces it.
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
    refiningMode: null,
    sendingTo: null,
    onlineKeySaved: { ...NO_PROVIDER_KEYS },

    hydrate: async () => {
      if (!watchingAppState) {
        watchingAppState = true;
        AppState.addEventListener("change", (state) => {
          // A language pack installed in the system settings, or a
          // recognizer changed there, shows up back in the foreground.
          if (state === "active") {
            invalidateRecognitionEnvironment();
            // A phone left open for days still honours the limit.
            void enforceRetention();
            sync?.setForeground(true);
          }
          // Never 'inactive': Control Center, Notification Center, Face ID,
          // system alerts and app-switcher peeks pass through it too.
          if (state === "background") {
            stopForBackground();
            sync?.setForeground(false);
          }
        });
      }
      let settings: CompanionSettings;
      let history: TranscriptTurn[];
      let apiToken: string | undefined;
      try {
        const [
          settingsRead,
          notesRead,
          dictionaryRead,
          snippetsRead,
          token,
          keyStatus,
        ] = await Promise.all([
          mobileStorage.loadSettings(),
          mobileStorage.loadNotes(),
          mobileStorage.loadDictionary(),
          mobileStorage.loadSnippets(),
          mobileStorage.loadApiToken(),
          // Booleans only; no network call (nothing is sent at launch).
          mobileStorage.providerKeyStatus(),
        ]);
        settings = settingsRead.value;
        history = notesRead.notes;
        apiToken = token;
        let onlineKeySaved = keyStatus;
        if (
          settingsRead.ok &&
          !settingsRead.stored &&
          (keyStatus.openrouter || keyStatus.opencode)
        ) {
          // No settings: a first run, so these keys were left in the iOS
          // keychain by an earlier install. They go with it.
          onlineKeySaved = { ...NO_PROVIDER_KEYS };
          await mobileStorage.removeProviderKeys().catch(() => undefined);
        }
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
        // Notes past the retention limit go before anything is shown. A
        // failed write is retried at the next launch.
        if (notesRead.ok && keepsHistory(settings)) {
          const { kept, expired } = applyRetention(
            history,
            settings.retentionDays,
            Date.now(),
          );
          if (expired.length > 0) {
            history = kept;
            await mobileStorage.saveNotes(history).catch(() => undefined);
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
          onlineKeySaved,
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
        // Paused while the notes can't be read; Settings still shows it.
        startSync();
        return;
      } finally {
        // No dictation runs yet: delete what earlier launches left in the
        // cache (speech-7).
        sweepCacheFiles();
      }

      try {
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
          // The server may have returned notes this phone already let go.
          await enforceRetention();
        } catch {
          // Offline: keep local history as is.
        }
      } finally {
        // After the API's merge, which would otherwise replace the notes
        // sync writes meanwhile.
        startSync();
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

    refine: async (turnId, mode, options) => {
      const web = Platform.OS === "web";
      const state = get();
      // Rewrite and Reply need a model: online editing with the user's own
      // key, or the dormant API. Without one they are not offered.
      const onlineReady = isOnlineEditingReady(
        state.settings,
        state.onlineKeySaved,
        web,
      );
      if (!availableRefinementModes(onlineReady).includes(mode)) return;
      // One refinement at a time: the chips are disabled meanwhile.
      if (state.refining) return;
      const first = findTurn(turnId);
      if (!first) return;

      // A refinement clears only its own notices: a dictation's error stays
      // with its ATTENTION status.
      const clearOwnNotice = () =>
        noticePatch(
          refineNoticeChange(get().notice, get().capture.status, null),
        );
      // Erase all, Clear history or going Ephemeral bumps the epoch.
      const epoch = dataEpoch;
      let sentTo: OnlineProvider | null = null;
      const online = await runOnlineEdit({
        turn: first,
        mode,
        consentedTo: options?.consentedTo,
        web,
        settings: state.settings,
        ephemeralNote: ephemeralNotes.has(turnId),
        keySaved: state.onlineKeySaved,
        dictionary: state.dictionary,
        snippets: state.snippets,
        readKey: (provider) => mobileStorage.loadProviderKey(provider),
        // Refuses redirects on the phone too (providerFetch.ts).
        fetchImpl: providerFetch,
        current: () => (epoch === dataEpoch ? findTurn(turnId) : undefined),
        onSend: (editing) => {
          sentTo = editing.provider;
          set({
            refining: true,
            refiningMode: mode,
            sendingTo: editing.provider,
            ...clearOwnNotice(),
          });
        },
      });
      switch (online.kind) {
        case "ask":
          // Nothing was sent: the Capture screen asks first.
          return;
        case "stale":
          set(doneRefining);
          return;
        case "failed":
          set({
            ...doneRefining,
            // The key was not found at send time: the chips go until one is
            // saved again.
            ...(online.notice === "onlineSetup" && sentTo
              ? {
                  onlineKeySaved: {
                    ...get().onlineKeySaved,
                    [sentTo]: false,
                  },
                }
              : {}),
            ...noticePatch(
              refineNoticeChange(
                get().notice,
                get().capture.status,
                noticeFor(online.notice),
              ),
            ),
          });
          return;
        case "applied": {
          set(doneRefining);
          const turn = online.turn;
          if (get().latest?.id === turnId) set({ latest: turn });
          if (get().history.some((item) => item.id === turnId)) {
            await replaceTurn(turn);
          }
          return;
        }
        case "local":
          break;
      }

      const { history, settings, apiToken, dictionary, snippets } = get();
      const source = findTurn(turnId);
      if (!source || get().refining) return;
      set({ refining: true, refiningMode: mode, ...clearOwnNotice() });

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
        ...doneRefining,
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

    onlinePlan: (turnId, mode) => {
      const { settings, onlineKeySaved } = get();
      return planOnlineEdit({
        mode,
        settings,
        keySaved: onlineKeySaved,
        web: Platform.OS === "web",
        consentedNow: false,
        ephemeralNote: ephemeralNotes.has(turnId),
      });
    },

    deleteTurn: async (turnId: string) => {
      // Its Listen button, and so its Stop, goes away with it.
      if (ttsController.getState().ownerId === turnId) {
        void ttsController.stop();
      }
      if (get().latest?.id === turnId) set({ latest: undefined });
      const { history, tombstones } = deleteNotes(
        get().history,
        [turnId],
        "everywhere",
      );
      // Before the note goes: a sync that starts now does not upload it.
      const recorded = recordDeletes(tombstones);
      await persistHistory(history);
      await recorded;
    },

    togglePin: async (turnId: string) => {
      const turn = get().history.find((item) => item.id === turnId);
      if (!turn) return;
      await replaceTurn({ ...turn, pinned: !turn.pinned });
    },

    clearHistory: async (scope: DeleteScope) => {
      const { tombstones } = deleteNotes(get().history, "all", scope);
      dataEpoch += 1;
      const recorded = recordDeletes(tombstones);
      set({ history: [], latest: undefined });
      const cleared = await persist(() => mobileStorage.clearNotes());
      if (cleared) set({ storageDegraded: false });
      await recorded;
      // From this phone only (the recovery screen): sync forgets what it
      // knew, so the other devices' notes download again, and the deletes
      // made here before still reach them.
      if (cleared && scope === "here") await sync?.notesClearedLocally();
      sync?.refresh();
      sweepCacheWhenIdle();
    },

    eraseAll: async (options) => {
      if (sync) {
        try {
          await sync.eraseAll(options?.deleteServerCopy === true);
        } catch {
          // The server copy could not be deleted: nothing is erased.
          return "serverCopyKept";
        }
      }
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
        return "failed";
      }
      set({
        // Back to a first run, which follows the device language (ux-5).
        settings: deviceDefaultSettings(),
        history: [],
        latest: undefined,
        dictionary: [],
        snippets: [],
        apiToken: undefined,
        onlineKeySaved: { ...NO_PROVIDER_KEYS },
        ...doneRefining,
        capture: idleCapture,
        level: 0,
        notice: null,
        storageDegraded: false,
      });
      return "erased";
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
          // From this phone only: they download again once history is back.
          void sync?.notesClearedLocally();
        }
        sweepCacheWhenIdle();
      }
      // Sync pauses while history is off, and resumes when it is back.
      sync?.refresh();
      if (settings.retentionDays !== previous.retentionDays) {
        await enforceRetention();
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

    saveProviderKey: async (provider, key) => {
      if (Platform.OS === "web") return "failed";
      if (!normalizeProviderKey(key)) return "invalid";
      // Saved settings mark this install: a launch that finds none removes
      // any provider key the iOS keychain kept from an earlier install.
      await persist(() => mobileStorage.saveSettings(get().settings));
      let saved = false;
      const written = await persist(async () => {
        saved = await mobileStorage.saveProviderKey(provider, key);
      });
      if (!written) return "failed";
      if (!saved) return "invalid";
      set({ onlineKeySaved: { ...get().onlineKeySaved, [provider]: true } });
      return "saved";
    },

    removeProviderKey: async (provider) => {
      if (await persist(() => mobileStorage.removeProviderKey(provider))) {
        set({
          onlineKeySaved: { ...get().onlineKeySaved, [provider]: false },
        });
      }
    },

    setOnlineEditing: async (editing) => {
      // Normalized, so only the provider, the model and the switch are
      // ever stored.
      const onlineEditing =
        editing === undefined ? undefined : normalizeOnlineEditing(editing);
      if (editing !== undefined && !onlineEditing) return false;
      await get().updateSettings({ onlineEditing });
      return true;
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
