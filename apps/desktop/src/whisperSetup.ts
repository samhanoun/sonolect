export type WhisperConfig = {
  command: string[];
  modelPath: string;
  modelName: string;
};

export type WhisperValidationCode =
  | "missing-command"
  | "command-not-argv"
  | "missing-audio-placeholder"
  | "missing-model";

export type WhisperValidationError = {
  code: WhisperValidationCode;
  message: string;
};

export type WhisperSetupStatus = {
  ready: boolean;
  code: "ready" | WhisperValidationCode;
  message: string;
};

export const DEFAULT_WHISPER_CONFIG: WhisperConfig = {
  command: [],
  modelPath: "",
  modelName: "",
};

const AUDIO_PLACEHOLDERS = ["{audioPath}", "{audio}"];

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

export function validateWhisperConfig(
  input: Partial<WhisperConfig>,
): WhisperValidationError[] {
  const config = normalizeWhisperConfig(input);
  const errors: WhisperValidationError[] = [];

  if (config.command.length === 0) {
    errors.push({
      code: "missing-command",
      message:
        "Add a Whisper command as a JSON argv array, starting with the executable.",
    });
  }

  if (
    config.command.some((arg) => /\s/.test(arg) && arg === config.command[0])
  ) {
    errors.push({
      code: "command-not-argv",
      message:
        'Use a JSON argv array instead of one shell command string, for example ["whisper-cli", "--file", "{audioPath}"].',
    });
  }

  if (
    config.command.length > 0 &&
    !config.command.some((arg) =>
      AUDIO_PLACEHOLDERS.some((placeholder) => arg.includes(placeholder)),
    )
  ) {
    errors.push({
      code: "missing-audio-placeholder",
      message:
        "Include {audioPath} where Sonolect should pass the recorded audio file.",
    });
  }

  const referencesModelPlaceholder = config.command.some((arg) =>
    arg.includes("{model}"),
  );
  if (referencesModelPlaceholder && !config.modelPath) {
    errors.push({
      code: "missing-model",
      message: "Choose a local model path or name for the {model} placeholder.",
    });
  }

  return errors;
}

export function getWhisperSetupStatus(
  input: Partial<WhisperConfig>,
): WhisperSetupStatus {
  const [firstError] = validateWhisperConfig(input);
  if (firstError) {
    return { ready: false, code: firstError.code, message: firstError.message };
  }
  return {
    ready: true,
    code: "ready",
    message: "Whisper command is ready to test with a local recording.",
  };
}

function replaceToken(
  value: string,
  token: string,
  replacement: string,
): string {
  return value.split(token).join(replacement);
}

export function buildWhisperCommandPreview(
  input: Partial<WhisperConfig>,
): string {
  const config = normalizeWhisperConfig(input);
  const model = config.modelPath || config.modelName || "/path/to/model.bin";
  return config.command
    .map((arg) =>
      replaceToken(
        replaceToken(
          replaceToken(
            replaceToken(
              replaceToken(arg, "{audioPath}", "/tmp/sonolect-sample.wav"),
              "{audio}",
              "/tmp/sonolect-sample.wav",
            ),
            "{model}",
            model,
          ),
          "{language}",
          "auto",
        ),
        "{durationMs}",
        "1000",
      ),
    )
    .join(" ");
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

export function commandArgsJsonForEnv(input: Partial<WhisperConfig>): string {
  const config = normalizeWhisperConfig(input);
  const model = config.modelPath || config.modelName || "";
  return JSON.stringify(
    config.command.map((arg) =>
      replaceToken(
        replaceToken(arg, "{model}", model),
        "{audio}",
        "{audioPath}",
      ),
    ),
  );
}
