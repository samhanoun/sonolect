import type { CaptureStatus, DictationLanguage } from "./domain";
import type { Strings } from "./i18n";

/**
 * Capture-screen notices. Pure: the text comes from the i18n strings passed
 * in, never from a native error message.
 */

export const NOTICE_KINDS = [
  "noSpeech",
  "unavailable",
  "micDenied",
  "micBlocked",
  "speechDenied",
  "speechRestricted",
  "modelMissing",
  "needsConsent",
  "modelInstalled",
  "modelDialogOpened",
  "modelScheduled",
  "modelNotSupported",
  "modelFailed",
  "network",
  "languageNotSupported",
  "busy",
  "audioCapture",
  "interrupted",
  "serviceNotAllowed",
  // The capture loop's own ends (WP3).
  "backgrounded",
  "maxDuration",
  "startFailed",
  "generic",
  // Dormant API refine path (Rewrite/Reply without the API).
  "needsModel",
  // A refinement threw; the note was kept as it was.
  "refineFailed",
  // Notes and settings on the phone (WP4).
  "storageReadError",
  "storageWriteError",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** The notices about storage, shown on Library and Settings too. */
export const STORAGE_NOTICE_KINDS = [
  "storageReadError",
  "storageWriteError",
] as const satisfies readonly NoticeKind[];

export function isStorageNotice(kind: NoticeKind): boolean {
  return (STORAGE_NOTICE_KINDS as readonly NoticeKind[]).includes(kind);
}

export const NOTICE_ACTIONS = [
  "downloadModel",
  "useServiceOnce",
  "alwaysAllow",
  "openSettings",
  "typeInstead",
  "dismiss",
] as const;
export type NoticeAction = (typeof NOTICE_ACTIONS)[number];

/** The notices whose text names the dictation language. */
export const LANGUAGE_NOTICE_KINDS = [
  "modelMissing",
  "needsConsent",
  "modelInstalled",
  "languageNotSupported",
] as const satisfies readonly NoticeKind[];
type LanguageNoticeKind = (typeof LANGUAGE_NOTICE_KINDS)[number];

export interface Notice {
  kind: NoticeKind;
  actions: readonly NoticeAction[];
  /** The dictation language, named by the notices about language packs. */
  language?: DictationLanguage;
}

const DEFAULT_ACTIONS: Record<NoticeKind, readonly NoticeAction[]> = {
  noSpeech: ["dismiss"],
  unavailable: ["typeInstead"],
  micDenied: ["dismiss"],
  micBlocked: ["openSettings"],
  speechDenied: ["openSettings"],
  // Settings cannot lift a Screen Time or device-profile restriction.
  speechRestricted: ["typeInstead"],
  modelMissing: ["downloadModel", "useServiceOnce", "typeInstead"],
  needsConsent: ["useServiceOnce", "alwaysAllow", "typeInstead"],
  modelInstalled: ["dismiss"],
  modelDialogOpened: ["dismiss"],
  modelScheduled: ["dismiss"],
  modelNotSupported: ["useServiceOnce", "dismiss"],
  modelFailed: ["useServiceOnce", "dismiss"],
  network: ["dismiss"],
  languageNotSupported: ["typeInstead"],
  busy: ["dismiss"],
  audioCapture: ["dismiss"],
  interrupted: ["dismiss"],
  serviceNotAllowed: ["dismiss"],
  backgrounded: ["dismiss"],
  maxDuration: ["dismiss"],
  startFailed: ["dismiss"],
  generic: ["dismiss"],
  needsModel: ["dismiss"],
  refineFailed: ["dismiss"],
  storageReadError: ["dismiss"],
  storageWriteError: ["dismiss"],
};

/**
 * The notice of a kind with its default actions. The notices that name the
 * dictation language need it; the others may leave it out.
 */
export function noticeFor(
  kind: NoticeKind,
  language: DictationLanguage,
): Notice;
export function noticeFor(
  kind: Exclude<NoticeKind, LanguageNoticeKind>,
): Notice;
export function noticeFor(
  kind: NoticeKind,
  language?: DictationLanguage,
): Notice {
  const actions = DEFAULT_ACTIONS[kind];
  return language === undefined
    ? { kind, actions }
    : { kind, actions, language };
}

const TEXT: Record<NoticeKind, (t: Strings, language: string) => string> = {
  noSpeech: (t) => t.capture.noSpeech,
  unavailable: (t) => t.capture.unavailable,
  micDenied: (t) => t.capture.notices.micDenied,
  micBlocked: (t) => t.capture.permissionDenied,
  speechDenied: (t) => t.capture.notices.speechDenied,
  speechRestricted: (t) => t.capture.notices.speechRestricted,
  modelMissing: (t, language) => t.capture.notices.modelMissing(language),
  needsConsent: (t, language) => t.capture.notices.needsConsent(language),
  modelInstalled: (t, language) => t.capture.notices.modelInstalled(language),
  modelDialogOpened: (t) => t.capture.notices.modelDialogOpened,
  modelScheduled: (t) => t.capture.notices.modelScheduled,
  modelNotSupported: (t) => t.capture.notices.modelNotSupported,
  modelFailed: (t) => t.capture.notices.modelFailed,
  network: (t) => t.capture.notices.network,
  languageNotSupported: (t, language) =>
    t.capture.notices.languageNotSupported(language),
  busy: (t) => t.capture.notices.busy,
  audioCapture: (t) => t.capture.notices.audioCapture,
  interrupted: (t) => t.capture.notices.interrupted,
  serviceNotAllowed: (t) => t.capture.notices.serviceNotAllowed,
  backgrounded: (t) => t.capture.notices.backgrounded,
  maxDuration: (t) => t.capture.notices.maxDuration,
  startFailed: (t) => t.capture.notices.startFailed,
  generic: (t) => t.capture.notices.generic,
  needsModel: (t) => t.capture.needsModel,
  refineFailed: (t) => t.capture.notices.refineFailed,
  storageReadError: (t) => t.capture.notices.storageReadError,
  storageWriteError: (t) => t.capture.notices.storageWriteError,
};

/**
 * The storage notice Library and Settings show. While some saved notes are
 * unread, the read error stays until a launch reads them; a write error
 * shows first, until dismissed. Otherwise the current storage notice, which
 * the user may dismiss.
 */
export function storageBanner(
  notice: Notice | null,
  storageDegraded: boolean,
): { notice: Notice; dismissable: boolean } | null {
  if (notice?.kind === "storageWriteError") {
    return { notice, dismissable: true };
  }
  if (storageDegraded) {
    return { notice: noticeFor("storageReadError"), dismissable: false };
  }
  return notice && isStorageNotice(notice.kind)
    ? { notice, dismissable: true }
    : null;
}

/** A change of the Capture screen's notice. */
export interface NoticeChange {
  notice: Notice | null;
  /** The capture's 'error' status goes back to idle. */
  resetStatus: boolean;
}

/**
 * Shows `next` in place of the current notice, or clears it (null), for a
 * notice that is not the current dictation's own: a download outcome, a
 * refinement's, a dismissal. An 'error' status refers to the notice being
 * replaced, so it goes back to idle: ATTENTION never stays without its
 * explanation. A running dictation keeps its status.
 */
export function replaceNotice(
  status: CaptureStatus,
  next: Notice | null,
): NoticeChange {
  return { notice: next, resetStatus: status === "error" };
}

/**
 * How a dictation that kept no text ends. It reads ATTENTION ('error') only
 * when the dictation raised an error notice, which stays shown, or what
 * replaced it (such as the permission notice found after 'not-allowed').
 * Otherwise it is an empty dictation, not an error: 'noSpeech', unless a
 * storage notice shows, which is never dropped.
 */
export function emptyEndOutcome(
  raised: Notice | null,
  current: Notice | null,
): { status: "error" | "idle"; notice: Notice } {
  if (raised) return { status: "error", notice: current ?? raised };
  if (current && isStorageNotice(current.kind)) {
    return { status: "idle", notice: current };
  }
  return { status: "idle", notice: noticeFor("noSpeech") };
}

/** The notices a refinement shows; it clears only these. */
const REFINE_NOTICE_KINDS: readonly NoticeKind[] = [
  "needsModel",
  "refineFailed",
];

/**
 * What a refinement does to the notice: it shows its own (`next`), or
 * clears an earlier one of its own. Any other notice, such as a dictation's
 * error, stays with its status. Null: nothing changes.
 */
export function refineNoticeChange(
  current: Notice | null,
  status: CaptureStatus,
  next: Notice | null,
): NoticeChange | null {
  if (next) return replaceNotice(status, next);
  if (current && REFINE_NOTICE_KINDS.includes(current.kind)) {
    return replaceNotice(status, null);
  }
  return null;
}

export function noticeText(t: Strings, notice: Notice): string {
  const language = notice.language ? t.languageNames[notice.language] : "";
  return TEXT[notice.kind](t, language);
}

const ACTION_LABELS: Record<NoticeAction, (t: Strings) => string> = {
  downloadModel: (t) => t.capture.actions.downloadModel,
  useServiceOnce: (t) => t.capture.actions.useServiceOnce,
  alwaysAllow: (t) => t.capture.actions.alwaysAllow,
  openSettings: (t) => t.capture.actions.openSettings,
  typeInstead: (t) => t.capture.typeInstead,
  dismiss: (t) => t.capture.actions.dismiss,
};

export function actionLabel(t: Strings, action: NoticeAction): string {
  return ACTION_LABELS[action](t);
}
