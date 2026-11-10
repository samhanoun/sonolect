import type { DictationLanguage } from "./domain";
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
  "startFailed",
  "generic",
  // Dormant API refine path (Rewrite/Reply without the API).
  "needsModel",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

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
  startFailed: ["dismiss"],
  generic: ["dismiss"],
  needsModel: ["dismiss"],
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
  startFailed: (t) => t.capture.notices.startFailed,
  generic: (t) => t.capture.notices.generic,
  needsModel: (t) => t.capture.needsModel,
};

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
