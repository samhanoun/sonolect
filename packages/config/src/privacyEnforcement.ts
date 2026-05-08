/**
 * Privacy enforcement configuration for Sonolect.
 *
 * Provides privacy mode presets (standard / enhanced / maximum) and
 * pure functions to check what operations are permissible under a
 * given configuration — supports SOC 2, HIPAA, and GDPR compliance.
 */

/* ── Types ─────────────────────────────────────────────────────────── */

export type PrivacyMode = "standard" | "enhanced" | "maximum";

export interface PrivacyConfig {
  mode: PrivacyMode;
  localOnly: boolean;
  audioRetention: "none" | "session" | "persistent";
  transcriptRetention: "none" | "session" | "persistent";
  telemetryEnabled: boolean;
  crashReportingEnabled: boolean;
}

/* ── Presets ───────────────────────────────────────────────────────── */

export const PRIVACY_PRESETS: Record<PrivacyMode, PrivacyConfig> = {
  standard: {
    mode: "standard",
    localOnly: false,
    audioRetention: "persistent",
    transcriptRetention: "persistent",
    telemetryEnabled: true,
    crashReportingEnabled: true,
  },
  enhanced: {
    mode: "enhanced",
    localOnly: false,
    audioRetention: "session",
    transcriptRetention: "persistent",
    telemetryEnabled: false,
    crashReportingEnabled: true,
  },
  maximum: {
    mode: "maximum",
    localOnly: true,
    audioRetention: "none",
    transcriptRetention: "session",
    telemetryEnabled: false,
    crashReportingEnabled: false,
  },
};

/* ── Accessors ────────────────────────────────────────────────────── */

/**
 * Retrieve the full privacy configuration for a given mode.
 */
export function getPrivacyConfig(mode: PrivacyMode): PrivacyConfig {
  return PRIVACY_PRESETS[mode];
}

/* ── Query helpers ────────────────────────────────────────────────── */

/**
 * Whether the configuration permits cloud processing.
 */
export function isCloudAllowed(config: PrivacyConfig): boolean {
  return !config.localOnly;
}

/**
 * Whether the configuration permits storing audio files beyond the
 * current session.
 */
export function isAudioStorageAllowed(config: PrivacyConfig): boolean {
  return config.audioRetention !== "none";
}

/**
 * Whether data should be redacted before being sent to cloud services.
 * True when the mode is "enhanced" or higher (i.e. not "standard").
 */
export function shouldRedactBeforeCloud(config: PrivacyConfig): boolean {
  return config.mode !== "standard";
}

/* ── Compliance validator ─────────────────────────────────────────── */

export type PrivacyOperation =
  | "cloud_transcription"
  | "cloud_storage"
  | "audio_persist"
  | "telemetry_send"
  | "crash_report"
  | "data_export";

export interface PrivacyComplianceResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check whether a specific operation is allowed under the given
 * privacy configuration.
 */
export function validatePrivacyCompliance(
  config: PrivacyConfig,
  operation: PrivacyOperation,
): PrivacyComplianceResult {
  switch (operation) {
    case "cloud_transcription":
    case "cloud_storage":
      if (config.localOnly) {
        return {
          allowed: false,
          reason: `Cloud operations are disabled in ${config.mode} privacy mode`,
        };
      }
      return { allowed: true };

    case "audio_persist":
      if (config.audioRetention === "none") {
        return {
          allowed: false,
          reason: `Audio persistence is disabled in ${config.mode} privacy mode`,
        };
      }
      return { allowed: true };

    case "telemetry_send":
      if (!config.telemetryEnabled) {
        return {
          allowed: false,
          reason: `Telemetry is disabled in ${config.mode} privacy mode`,
        };
      }
      return { allowed: true };

    case "crash_report":
      if (!config.crashReportingEnabled) {
        return {
          allowed: false,
          reason: `Crash reporting is disabled in ${config.mode} privacy mode`,
        };
      }
      return { allowed: true };

    case "data_export":
      // Data export (GDPR) is always allowed regardless of privacy mode.
      return { allowed: true };

    default: {
      // Exhaustiveness guard — if a new operation is added without a
      // handler, TypeScript will flag it at compile time.
      const _exhaustive: never = operation;
      return {
        allowed: false,
        reason: `Unknown operation: ${_exhaustive as string}`,
      };
    }
  }
}
