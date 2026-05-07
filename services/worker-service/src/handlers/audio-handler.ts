import { execFile as execFileCb } from "node:child_process";
import { access, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AudioTask {
  jobId: string;
  audioPath: string;
  language?: string;
  userId: string;
}

export interface WhisperSegment {
  text: string;
  start: number;
  end: number;
}

export interface WhisperOutput {
  text: string;
  language: string;
  segments: WhisperSegment[];
}

export interface AudioTaskResult {
  success: boolean;
  transcriptId?: string;
  text?: string;
  language?: string;
  segments?: WhisperSegment[];
  error?: string;
  durationMs: number;
}

export interface AudioHandlerDeps {
  execFile?: typeof execFilePromise;
  fileExists?: (path: string) => Promise<boolean>;
  removeFile?: (path: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execFilePromise(
  file: string,
  args: string[],
  options?: { timeout?: number; maxBuffer?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb(
      file,
      args,
      {
        timeout: options?.timeout ?? 300_000,
        maxBuffer: options?.maxBuffer ?? 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || stdout?.trim() || error.message;
          reject(new Error(`Whisper process failed: ${detail}`));
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

async function defaultFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultRemoveFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Ignore removal errors — file may already be gone
  }
}

// ---------------------------------------------------------------------------
// Whisper binary detection
// ---------------------------------------------------------------------------

const WHISPER_CANDIDATES = [
  "whisper-cli",
  "whisper-cpp",
  "whisper",
  "faster-whisper",
] as const;

export function getWhisperCommand(): string {
  const envCommand = process.env.SONOLECT_WHISPER_COMMAND;
  if (envCommand?.trim()) {
    return envCommand.trim();
  }
  // Default to first candidate; the caller should verify it exists on PATH.
  return WHISPER_CANDIDATES[0];
}

// ---------------------------------------------------------------------------
// CLI argument construction
// ---------------------------------------------------------------------------

export function buildWhisperArgs(
  audioPath: string,
  language?: string,
): string[] {
  const args: string[] = ["--file", audioPath, "--output-json"];

  if (language && language !== "auto") {
    args.push("--language", language);
  }

  const modelPath = process.env.SONOLECT_WHISPER_MODEL;
  if (modelPath?.trim()) {
    args.push("--model", modelPath.trim());
  }

  return args;
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

export function parseWhisperOutput(stdout: string): WhisperOutput {
  // Whisper CLI may emit non-JSON preamble lines before the JSON payload.
  // Find the first '{' and last '}' to extract the JSON block.
  const jsonStart = stdout.indexOf("{");
  const jsonEnd = stdout.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    // Fallback: treat entire stdout as plain transcript text
    const text = stdout.trim();
    if (!text) {
      throw new Error("Whisper produced no output");
    }
    return { text, language: "en", segments: [] };
  }

  const raw = stdout.slice(jsonStart, jsonEnd + 1);
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const text =
    typeof parsed.text === "string"
      ? parsed.text.trim()
      : typeof parsed.transcription === "string"
        ? (parsed.transcription as string).trim()
        : "";

  const language = typeof parsed.language === "string" ? parsed.language : "en";

  const rawSegments = Array.isArray(parsed.segments)
    ? (parsed.segments as Record<string, unknown>[])
    : [];

  const segments: WhisperSegment[] = rawSegments
    .filter(
      (s) =>
        typeof s.text === "string" &&
        typeof s.start === "number" &&
        typeof s.end === "number",
    )
    .map((s) => ({
      text: (s.text as string).trim(),
      start: s.start as number,
      end: s.end as number,
    }));

  if (!text && segments.length > 0) {
    return {
      text: segments.map((s) => s.text).join(" "),
      language,
      segments,
    };
  }

  if (!text) {
    throw new Error("Whisper produced no transcript text");
  }

  return { text, language, segments };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function processAudioTask(
  task: AudioTask,
  deps: AudioHandlerDeps = {},
): Promise<AudioTaskResult> {
  const start = Date.now();
  const exec = deps.execFile ?? execFilePromise;
  const fileExists = deps.fileExists ?? defaultFileExists;
  const removeFile = deps.removeFile ?? defaultRemoveFile;

  try {
    // 1. Verify audio file exists
    const exists = await fileExists(task.audioPath);
    if (!exists) {
      return {
        success: false,
        error: `Audio file not found: ${task.audioPath}`,
        durationMs: Date.now() - start,
      };
    }

    // 2. Spawn Whisper CLI
    const command = getWhisperCommand();
    const args = buildWhisperArgs(task.audioPath, task.language);
    const { stdout } = await exec(command, args, {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    // 3. Parse JSON output
    const output = parseWhisperOutput(stdout);

    // 4. Generate transcript ID
    const transcriptId = `tr-${randomUUID()}`;

    // 5. Clean up temp audio file
    await removeFile(task.audioPath);

    // 6. Return success
    return {
      success: true,
      transcriptId,
      text: output.text,
      language: output.language,
      segments: output.segments,
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown audio processing error",
      durationMs: Date.now() - start,
    };
  }
}
