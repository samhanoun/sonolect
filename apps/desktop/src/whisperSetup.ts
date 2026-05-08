export type WhisperConfig = {
  command: string[];
  modelPath: string;
  modelName: string;
};

export type WhisperModelCatalogEntry = {
  id: "tiny.en" | "base.en" | "small.en";
  label: string;
  filename: string;
  sizeBytes: number;
  downloadUrl: string;
  recommended?: boolean;
  description: string;
};

export type WhisperInstallPlatform = "darwin" | "linux" | "win32";

export type WhisperInstallGuide = {
  platform: WhisperInstallPlatform;
  whisperCppUrl: string;
  modelDownloadUrl: string;
  installCommands: string[];
  verifyCommand: string;
};

export type WhisperModelValidation = {
  exists: boolean;
  sizeOk: boolean;
  formatOk: boolean;
};

export type WhisperInstallPlanInput = {
  platform: WhisperInstallPlatform;
  homeDir: string;
  appDataDir?: string;
  modelId?: WhisperModelCatalogEntry["id"];
};

export type WhisperInstallPlan = {
  platform: WhisperInstallPlatform;
  rootDir: string;
  binDir: string;
  modelsDir: string;
  binaryPath: string;
  modelPath: string;
  model: WhisperModelCatalogEntry;
  config: WhisperConfig;
};

export type WhisperAssetStatusState =
  | "not-installed"
  | "downloading"
  | "ready"
  | "invalid";

export type WhisperAssetStatusInput = {
  binaryExists?: boolean;
  modelExists?: boolean;
  downloading?: boolean;
  invalidReason?: string;
};

export type WhisperAssetStatus = {
  state: WhisperAssetStatusState;
  ready: boolean;
  message: string;
};

export type WhisperInstallerGuidance = {
  summary: string;
  steps: string[];
  commandPreview: string;
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

export const WHISPER_MODEL_CATALOG: WhisperModelCatalogEntry[] = [
  {
    id: "tiny.en",
    label: "Tiny English",
    filename: "ggml-tiny.en.bin",
    sizeBytes: 77_681_171,
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    description:
      "Fastest local onboarding model for smoke tests and short notes.",
  },
  {
    id: "base.en",
    label: "Base English",
    filename: "ggml-base.en.bin",
    sizeBytes: 147_951_465,
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    recommended: true,
    description:
      "Recommended desktop default: good quality with a modest download.",
  },
  {
    id: "small.en",
    label: "Small English",
    filename: "ggml-small.en.bin",
    sizeBytes: 487_601_967,
    downloadUrl:
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    description:
      "Higher quality local transcription for users with more disk/CPU budget.",
  },
];

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

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => {
      const normalized = part.replace(/\\/g, "/");
      if (index === 0) return normalized.replace(/\/+$/g, "");
      return normalized.replace(/^\/+|\/+$/g, "");
    })
    .filter(Boolean)
    .join("/");
}

export function recommendedWhisperModel(): WhisperModelCatalogEntry {
  const model =
    WHISPER_MODEL_CATALOG.find((entry) => entry.recommended) ??
    WHISPER_MODEL_CATALOG[0];
  if (!model) {
    throw new Error("Whisper model catalog is empty.");
  }
  return model;
}

export function getDefaultWhisperInstallPlan(
  input: WhisperInstallPlanInput,
): WhisperInstallPlan {
  const model =
    WHISPER_MODEL_CATALOG.find((entry) => entry.id === input.modelId) ??
    recommendedWhisperModel();
  const homeDir = input.homeDir.replace(/\\/g, "/").replace(/\/+$/g, "");
  const appDataDir = input.appDataDir?.replace(/\\/g, "/").replace(/\/+$/g, "");
  const rootDir =
    input.platform === "darwin"
      ? joinPath(
          homeDir,
          "Library",
          "Application Support",
          "Sonolect",
          "whisper",
        )
      : input.platform === "win32"
        ? joinPath(
            appDataDir || joinPath(homeDir, "AppData", "Roaming"),
            "Sonolect",
            "whisper",
          )
        : joinPath(homeDir, ".local", "share", "sonolect", "whisper");
  const binDir = joinPath(rootDir, "bin");
  const modelsDir = joinPath(rootDir, "models");
  const binaryPath = joinPath(
    binDir,
    input.platform === "win32" ? "whisper-cli.exe" : "whisper-cli",
  );
  const modelPath = joinPath(modelsDir, model.filename);
  const config: WhisperConfig = {
    command: [
      binaryPath,
      "--model",
      "{model}",
      "--file",
      "{audioPath}",
      "--output-json",
    ],
    modelPath,
    modelName: model.id,
  };

  return {
    platform: input.platform,
    rootDir,
    binDir,
    modelsDir,
    binaryPath,
    modelPath,
    model,
    config,
  };
}

export function getWhisperAssetStatus(
  input: WhisperAssetStatusInput,
): WhisperAssetStatus {
  if (input.invalidReason) {
    return {
      state: "invalid",
      ready: false,
      message: `Whisper assets need attention: ${input.invalidReason}`,
    };
  }
  if (input.downloading) {
    return {
      state: "downloading",
      ready: false,
      message: "Downloading Whisper assets…",
    };
  }
  if (input.binaryExists && input.modelExists) {
    return {
      state: "ready",
      ready: true,
      message: "Whisper binary and model are installed locally.",
    };
  }
  if (input.binaryExists) {
    return {
      state: "not-installed",
      ready: false,
      message: "Whisper model is missing.",
    };
  }
  if (input.modelExists) {
    return {
      state: "not-installed",
      ready: false,
      message: "Whisper binary is missing.",
    };
  }
  return {
    state: "not-installed",
    ready: false,
    message: "Whisper binary and model are not installed yet.",
  };
}

export function getDefaultModelPath(
  platform: WhisperInstallPlatform,
  homeDir: string,
): string {
  const home = homeDir.replace(/\\/g, "/").replace(/\/+$/g, "");
  switch (platform) {
    case "darwin":
      return joinPath(
        home,
        "Library",
        "Application Support",
        "sonolect",
        "models",
      );
    case "win32":
      return joinPath(home, "AppData", "Roaming", "sonolect", "models");
    case "linux":
    default:
      return joinPath(home, ".local", "share", "sonolect", "models");
  }
}

const WHISPER_CPP_URL = "https://github.com/ggerganov/whisper.cpp";
const MODEL_DOWNLOAD_BASE =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";

export function getWhisperInstallInstructions(
  platform: WhisperInstallPlatform,
): WhisperInstallGuide {
  const installCommands: string[] = [];
  let verifyCommand: string;

  switch (platform) {
    case "darwin":
      installCommands.push(
        "brew install whisper-cpp",
        "# Or build from source:",
        `git clone ${WHISPER_CPP_URL}`,
        "cd whisper.cpp && make",
      );
      verifyCommand = "whisper-cli --help";
      break;
    case "win32":
      installCommands.push(
        "winget install ggerganov.whisper-cpp",
        "# Or with scoop:",
        "scoop install whisper-cpp",
        "# Or build from source:",
        `git clone ${WHISPER_CPP_URL}`,
        "cd whisper.cpp && cmake -B build && cmake --build build --config Release",
      );
      verifyCommand = "whisper-cli.exe --help";
      break;
    case "linux":
    default:
      installCommands.push(
        "sudo apt install -y build-essential",
        `git clone ${WHISPER_CPP_URL}`,
        "cd whisper.cpp && make",
        "sudo cp main /usr/local/bin/whisper-cli",
      );
      verifyCommand = "whisper-cli --help";
      break;
  }

  return {
    platform,
    whisperCppUrl: WHISPER_CPP_URL,
    modelDownloadUrl: MODEL_DOWNLOAD_BASE,
    installCommands,
    verifyCommand,
  };
}

/** Minimum expected model file size in bytes (1 MB). */
const MIN_MODEL_SIZE = 1_000_000;

export function validateModelFile(
  fileStats: { exists: boolean; sizeBytes: number; path: string } | null,
): WhisperModelValidation {
  if (!fileStats || !fileStats.exists) {
    return { exists: false, sizeOk: false, formatOk: false };
  }
  const sizeOk = fileStats.sizeBytes >= MIN_MODEL_SIZE;
  const formatOk = /\.bin$/i.test(fileStats.path);
  return { exists: true, sizeOk, formatOk };
}

export function buildWhisperInstallerGuidance(
  plan: WhisperInstallPlan,
): WhisperInstallerGuidance {
  return {
    summary:
      "Sonolect uses local whisper.cpp-compatible assets only: a small CLI binary plus a GGML model stored in app data.",
    steps: [
      `Create ${plan.binDir} and ${plan.modelsDir}.`,
      `Install or copy a whisper.cpp CLI binary to ${plan.binaryPath}.`,
      `Download ${plan.model.filename} (${plan.model.label}) from ${plan.model.downloadUrl} into ${plan.modelsDir}.`,
      "No cloud speech-to-text is required; Sonolect passes recorded audio to the local command.",
    ],
    commandPreview: buildWhisperCommandPreview(plan.config),
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
  const model = config.modelPath || config.modelName || "<model-path>";
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
