import type { CaptureStatus, DictationLanguage, PrivacyLevel } from "./domain";
import type { NoticeKind } from "./notices";

/**
 * Speech routing rules, kept free of react-native and expo imports so tests
 * can run them. speech.ts reads the device (the environment) and this module
 * decides what a dictation may use.
 *
 * Privacy rule: while privacy is not Standard, audio only goes to the system
 * speech service (Google's or Apple's recognizer) after the user allowed it,
 * for one dictation or always (`allowSystemService`).
 */

export type RecognitionPlatform = "ios" | "android" | "web";
export type RecognitionRoute = "on-device" | "system-service" | "blocked";
export type BlockedReason = "unavailable" | "model-missing" | "needs-consent";
export type RecognitionBadge = "on-device" | "system-service" | "apple-service";

/** What the device reports; see getRecognitionEnvironment in speech.ts. */
export interface RecognitionEnvironment {
  platform: RecognitionPlatform;
  /** Android API level, iOS major version, or 0 on web. */
  osVersion: number;
  recognitionAvailable: boolean;
  /** supportsOnDeviceRecognition(): an on-device service exists. */
  onDeviceService: boolean;
  /** Android 13+: on-device language packs; null when unknown. */
  installedLocales: readonly string[] | null;
  /** iOS: the dictation locale can run on the device; null when unknown. */
  localeOnDevice: boolean | null;
}

export interface PlanInput extends RecognitionEnvironment {
  privacyLevel: PrivacyLevel;
  language: DictationLanguage;
  /** Settings: use the system speech service when on-device isn't possible. */
  allowSystemService: boolean;
  /** The user allowed the system speech service for this dictation only. */
  consentOnce: boolean;
}

export interface RecognitionPlan {
  route: RecognitionRoute;
  /** Sent as requiresOnDeviceRecognition; true only for the on-device route. */
  requiresOnDevice: boolean;
  blockedReason?: BlockedReason;
  canDownloadModel: boolean;
  badge: RecognitionBadge;
  /**
   * The recognizer ends on its own before the user is done, so the capture
   * loop starts it again (see captureLoop.ts and restartsOnEnd).
   */
  restartOnEnd: boolean;
}

/** getSupportedLocales has no timeout on Android, and some services hang. */
export const LOCALES_TIMEOUT_MS = 1_500;
/** After this, a language pack download is reported as scheduled. */
export const DOWNLOAD_TIMEOUT_MS = 120_000;
/**
 * expo-speech-recognition creates the strict on-device recognizer only from
 * API 33. On API 31/32 requiresOnDeviceRecognition only adds
 * EXTRA_PREFER_OFFLINE, which the service may ignore.
 */
export const ANDROID_ON_DEVICE_MIN_API = 33;
/**
 * expo-speech-recognition runs continuous Android sessions only from API 33
 * (supportsRecording()). Below it 'continuous' is ignored and the recognizer
 * ends at the first pause.
 */
export const ANDROID_CONTINUOUS_MIN_API = 33;

export function serviceBadge(platform: RecognitionPlatform): RecognitionBadge {
  return platform === "ios" ? "apple-service" : "system-service";
}

/**
 * Whether a session on this route ends before the user is done, so the
 * capture loop starts it again: below Android 13 (no continuous mode), and
 * with Apple's server recognizer, which ends after about a minute. On-device
 * iOS sessions and Android 13+ sessions keep going on their own.
 */
export function restartsOnEnd(
  platform: RecognitionPlatform,
  osVersion: number,
  route: RecognitionRoute,
): boolean {
  if (route === "blocked") return false;
  if (platform === "android") return osVersion < ANDROID_CONTINUOUS_MIN_API;
  if (platform === "ios") return route === "system-service";
  return false;
}

/** The plan for a dictation that uses the system speech service. */
export function systemServicePlan(
  platform: RecognitionPlatform,
  osVersion: number,
): RecognitionPlan {
  return {
    route: "system-service",
    requiresOnDevice: false,
    canDownloadModel: false,
    badge: serviceBadge(platform),
    restartOnEnd: restartsOnEnd(platform, osVersion, "system-service"),
  };
}

function onDevicePlan(
  platform: RecognitionPlatform,
  osVersion: number,
): RecognitionPlan {
  return {
    route: "on-device",
    requiresOnDevice: true,
    canDownloadModel: false,
    badge: "on-device",
    restartOnEnd: restartsOnEnd(platform, osVersion, "on-device"),
  };
}

/**
 * A blocked plan shows the service badge: the system speech service is the
 * only way this phone can dictate this language now, and it is not used
 * until the user allows it.
 */
function blockedPlan(
  platform: RecognitionPlatform,
  blockedReason: BlockedReason,
): RecognitionPlan {
  return {
    route: "blocked",
    requiresOnDevice: false,
    blockedReason,
    canDownloadModel: blockedReason === "model-missing",
    badge: serviceBadge(platform),
    restartOnEnd: false,
  };
}

/**
 * Decides how a dictation runs. The rules apply in order:
 * 1. no recognizer: blocked, unavailable;
 * 2. Standard privacy: always the system speech service;
 * 3. Android 13+ with an on-device service: on-device when the language pack
 *    is installed or the installed list is unknown (a strict attempt; a
 *    missing pack is handled when its error arrives), otherwise the system
 *    service with consent, or blocked so the pack can be downloaded;
 * 4. iOS when the dictation locale itself supports on-device recognition;
 * 5. anything else: the system service with consent, otherwise blocked.
 * restartOnEnd follows the route (restartsOnEnd); a blocked plan never runs.
 */
export function planRecognition(input: PlanInput): RecognitionPlan {
  const { platform, osVersion } = input;
  const consented = input.allowSystemService || input.consentOnce;
  if (!input.recognitionAvailable) {
    return blockedPlan(platform, "unavailable");
  }
  if (input.privacyLevel === "standard") {
    return systemServicePlan(platform, osVersion);
  }
  if (
    platform === "android" &&
    osVersion >= ANDROID_ON_DEVICE_MIN_API &&
    input.onDeviceService
  ) {
    if (
      input.installedLocales === null ||
      localeMatches(input.language, input.installedLocales)
    ) {
      return onDevicePlan(platform, osVersion);
    }
    return consented
      ? systemServicePlan(platform, osVersion)
      : blockedPlan(platform, "model-missing");
  }
  if (platform === "ios" && input.localeOnDevice === true) {
    return onDevicePlan(platform, osVersion);
  }
  return consented
    ? systemServicePlan(platform, osVersion)
    : blockedPlan(platform, "needs-consent");
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/_/g, "-").toLowerCase();
}

/**
 * Whether an installed language pack covers the dictation language: an exact
 * match first ('fr_FR' and 'FR-fr' count as 'fr-FR'), then the same base
 * language ('fr' or 'fr-CA' for 'fr-FR').
 */
export function localeMatches(
  language: string,
  installed: readonly string[],
): boolean {
  const wanted = normalizeTag(language);
  const tags = installed.map(normalizeTag).filter(Boolean);
  if (tags.includes(wanted)) return true;
  const base = wanted.split("-")[0];
  return tags.some((tag) => tag.split("-")[0] === base);
}

/**
 * A known list of installed language packs that does not cover the
 * dictation language. speech.ts reads such a list again for the next plan:
 * a scheduled download, Android 13's download dialog or one that outlived
 * DOWNLOAD_TIMEOUT_MS installs the pack later, with no event.
 */
export function installedListLacks(
  language: string,
  installed: readonly string[] | null,
): boolean {
  return installed !== null && !localeMatches(language, installed);
}

export type SpeechErrorClass = NoticeKind | "benign" | "aborted";

/**
 * Maps an expo-speech-recognition error code (or the app's 'unsupported' and
 * 'start-failed') to a notice. The native message is never shown.
 */
export function classifySpeechError(
  code: string,
  context: { requiresOnDevice: boolean; platform: RecognitionPlatform },
): SpeechErrorClass {
  switch (code) {
    case "no-speech":
    case "speech-timeout":
      return "benign";
    case "aborted":
      return "aborted";
    case "language-not-supported":
      if (!context.requiresOnDevice) return "languageNotSupported";
      return context.platform === "android" ? "modelMissing" : "needsConsent";
    case "network":
      return "network";
    case "not-allowed":
      return "micDenied";
    case "service-not-allowed":
      return "serviceNotAllowed";
    case "busy":
      return "busy";
    case "audio-capture":
      return "audioCapture";
    case "interrupted":
      return "interrupted";
    case "start-failed":
      return "startFailed";
    case "unsupported":
      return "unavailable";
    default:
      return "generic";
  }
}

/**
 * Whether a session that asked for on-device recognition may switch to the
 * system speech service after the recognizer reported a missing language:
 * only with the user's consent, only once, and never after the user pressed
 * Done.
 */
export function shouldRetryWithSystemService(input: {
  code: string;
  requiresOnDevice: boolean;
  consented: boolean;
  alreadyRetried: boolean;
  stopRequested: boolean;
}): boolean {
  return (
    input.code === "language-not-supported" &&
    input.requiresOnDevice &&
    input.consented &&
    !input.alreadyRetried &&
    !input.stopRequested
  );
}

export type DownloadOutcome =
  "installed" | "dialog-opened" | "scheduled" | "not-supported" | "failed";

/**
 * What androidTriggerOfflineModelDownload did: its result, its rejection, or
 * 'timeout' when it did not settle within DOWNLOAD_TIMEOUT_MS.
 */
export type DownloadAttempt =
  { status: string; message?: string } | { error: unknown } | "timeout";

function isNotSupported(error: unknown): boolean {
  if (typeof error === "string") return error.includes("not_supported");
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === "not_supported" ||
    (typeof message === "string" && message.includes("not_supported"))
  );
}

/**
 * expo-speech-recognition 58.0.1: Android 13 resolves 'opened_dialog' at
 * once; Android 14+ resolves 'download_success' or 'download_scheduled', or
 * rejects 'error_N'. Below Android 13 it rejects 'not_supported'.
 */
export function mapDownloadOutcome(attempt: DownloadAttempt): DownloadOutcome {
  if (attempt === "timeout") return "scheduled";
  if ("error" in attempt) {
    return isNotSupported(attempt.error) ? "not-supported" : "failed";
  }
  switch (attempt.status) {
    case "download_success":
      return "installed";
    case "opened_dialog":
      return "dialog-opened";
    case "download_scheduled":
      return "scheduled";
    default:
      return "failed";
  }
}

export type PermissionOutcome =
  | { status: "granted" }
  | { status: "unsupported" }
  | {
      status: "denied";
      which: "microphone" | "speech";
      canAskAgain: boolean;
      /** iOS: Speech Recognition is restricted (Screen Time or a profile). */
      restricted?: boolean;
    };

/** The notice for a permission outcome, or null when it was granted. */
export function permissionNoticeKind(
  outcome: PermissionOutcome,
): NoticeKind | null {
  switch (outcome.status) {
    case "granted":
      return null;
    case "unsupported":
      return "unavailable";
    case "denied":
      if (outcome.which === "speech") {
        return outcome.restricted === true
          ? "speechRestricted"
          : "speechDenied";
      }
      return outcome.canAskAgain ? "micDenied" : "micBlocked";
  }
}

const BLOCKED_NOTICES: Record<BlockedReason, NoticeKind> = {
  unavailable: "unavailable",
  "model-missing": "modelMissing",
  "needs-consent": "needsConsent",
};

export function blockedNoticeKind(reason: BlockedReason): NoticeKind {
  return BLOCKED_NOTICES[reason];
}

const DOWNLOAD_NOTICES: Record<DownloadOutcome, NoticeKind> = {
  installed: "modelInstalled",
  "dialog-opened": "modelDialogOpened",
  scheduled: "modelScheduled",
  "not-supported": "modelNotSupported",
  failed: "modelFailed",
};

export function downloadNoticeKind(outcome: DownloadOutcome): NoticeKind {
  return DOWNLOAD_NOTICES[outcome];
}

/**
 * Whether a download's outcome may replace the notice once it settles, which
 * can take minutes on Android 14+. Never while a dictation listens or is
 * processed, and never over a notice that a dictation started since the tap
 * left: the outcome would read as that dictation's.
 */
export function downloadNoticeAllowed(input: {
  status: CaptureStatus;
  /** A dictation started listening after Download was tapped. */
  dictationStartedSince: boolean;
  hasNotice: boolean;
}): boolean {
  if (input.status === "listening" || input.status === "processing") {
    return false;
  }
  return !(input.dictationStartedSince && input.hasNotice);
}

/** Accumulates continuous-mode results: finalised segments plus the live one. */
export class TranscriptAccumulator {
  private committed: string[] = [];
  private interim = "";

  push(text: string, isFinal: boolean): string {
    const clean = text.trim();
    if (isFinal) {
      if (clean) this.committed.push(clean);
      this.interim = "";
    } else {
      this.interim = clean;
    }
    return this.text();
  }

  /**
   * Keeps the live text as a finalised segment. Called before the recognizer
   * starts again: a session that ended without a final result would
   * otherwise lose it to the next session's first result.
   */
  commitInterim(): string {
    if (this.interim) this.committed.push(this.interim);
    this.interim = "";
    return this.text();
  }

  text(): string {
    return [...this.committed, this.interim].filter(Boolean).join(" ");
  }
}

export function levelFromVolume(value: number): number {
  // expo-speech-recognition reports roughly -2 (silent) to 10 (loud).
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / 10));
}
