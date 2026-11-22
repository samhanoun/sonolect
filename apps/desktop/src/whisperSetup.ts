/**
 * The saved speech engine settings. The engine is built into the app, which
 * passes it the model path.
 */
export type WhisperConfig = {
  command: string[];
  modelPath: string;
  modelName: string;
};

export const DEFAULT_WHISPER_CONFIG: WhisperConfig = {
  command: [],
  modelPath: "",
  modelName: "",
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeWhisperConfig(
  config: Partial<WhisperConfig> | null | undefined,
): WhisperConfig {
  return {
    command: Array.isArray(config?.command)
      ? config.command.map(cleanString).filter(Boolean)
      : [],
    modelPath: cleanString(config?.modelPath),
    modelName: cleanString(config?.modelName),
  };
}

export function serializeWhisperConfig(input: Partial<WhisperConfig>): string {
  return JSON.stringify(normalizeWhisperConfig(input));
}

export function parseWhisperConfig(raw: string | null): WhisperConfig {
  if (!raw) return DEFAULT_WHISPER_CONFIG;
  try {
    return normalizeWhisperConfig(JSON.parse(raw) as Partial<WhisperConfig>);
  } catch {
    return DEFAULT_WHISPER_CONFIG;
  }
}
