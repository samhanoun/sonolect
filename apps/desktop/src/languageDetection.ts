import { STT_LANGUAGES, type STTLanguage } from "./sttLanguages";
import type { WhisperConfig } from "./whisperSetup";

/** Detected language from Whisper JSON output. */
export type DetectedLanguage = {
  code: string;
  name: string;
  confidence: number;
};

/** A record of a language switch within a session. */
export type LanguageSwitchEvent = {
  from: string;
  to: string;
  timestamp: number;
};

/**
 * Parse the "language" field from Whisper JSON output and return a
 * DetectedLanguage, or null when the output contains no language info.
 */
export function detectLanguageFromWhisperOutput(
  whisperResult: { language?: string; text?: string } | null | undefined,
): DetectedLanguage | null {
  if (!whisperResult) return null;
  const raw = whisperResult.language?.trim();
  if (!raw) return null;

  const code = raw.toLowerCase();
  const name = getLanguageDisplayName(code);
  // Whisper does not emit a numeric confidence for language detection in its
  // standard JSON output, so we use a reasonable heuristic: if the language
  // field is present and non-empty we assign a high default confidence (0.85).
  // Callers that have access to the logprob-based score can override this.
  const confidence = 0.85;

  return { code, name, confidence };
}

/**
 * Map an ISO 639-1 code to a human-readable display name.
 * Falls back to the raw code if the language is not in STT_LANGUAGES.
 */
export function getLanguageDisplayName(code: string): string {
  const normalizedCode = code.toLowerCase().trim();
  const entry: STTLanguage | undefined = STT_LANGUAGES.find(
    (lang) => lang.code === normalizedCode,
  );
  if (!entry) return code;
  if (entry.code === "auto") return "Auto";
  return entry.name;
}

/**
 * Return a copy of the given WhisperConfig with the language forced to "auto"
 * so Whisper performs automatic language detection.
 */
export function buildAutoDetectConfig(
  whisperConfig: WhisperConfig,
): WhisperConfig {
  // Replace any existing {language} placeholder value with "auto" by ensuring
  // the config command array contains the literal "auto" in place of the
  // language token.  The command-template expansion in whisperSetup already
  // substitutes {language} at runtime, so we only need to ensure the
  // upstream caller passes language="auto".
  return {
    ...whisperConfig,
    command: whisperConfig.command.map((arg) =>
      arg === "{language}" ? "auto" : arg,
    ),
  };
}

/**
 * Given an array of recent detections, suggest locking the language if the
 * same code has appeared 5 or more consecutive times.
 */
export function shouldSuggestLanguageLock(detections: DetectedLanguage[]): {
  suggest: boolean;
  language: string;
} {
  const THRESHOLD = 5;
  if (detections.length < THRESHOLD) {
    return { suggest: false, language: "" };
  }

  // Check the last THRESHOLD detections for a unanimous language.
  const recent = detections.slice(-THRESHOLD);
  const firstCode = recent[0]?.code;
  if (!firstCode) return { suggest: false, language: "" };

  const allSame = recent.every((d) => d.code === firstCode);
  if (allSame && firstCode !== "auto") {
    return { suggest: true, language: firstCode };
  }

  return { suggest: false, language: "" };
}

/**
 * Detect when a user switches languages mid-session.
 * Returns a LanguageSwitchEvent when `detected` differs from `current`,
 * or null if the languages match (or either is missing / "auto").
 */
export function trackLanguageSwitch(
  current: string | null | undefined,
  detected: string | null | undefined,
): LanguageSwitchEvent | null {
  const cur = current?.trim().toLowerCase();
  const det = detected?.trim().toLowerCase();

  if (!cur || !det) return null;
  if (cur === "auto" || det === "auto") return null;
  if (cur === det) return null;

  return {
    from: cur,
    to: det,
    timestamp: Date.now(),
  };
}
