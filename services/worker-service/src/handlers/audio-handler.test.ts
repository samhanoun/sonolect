import { strict as assert } from "node:assert";
import {
  buildWhisperArgs,
  getWhisperCommand,
  parseWhisperOutput,
  processAudioTask,
  type AudioHandlerDeps,
  type AudioTask,
} from "./audio-handler.js";

// ---------------------------------------------------------------------------
// getWhisperCommand
// ---------------------------------------------------------------------------

{
  // Without env override, returns default candidate
  const original = process.env.SONOLECT_WHISPER_COMMAND;
  delete process.env.SONOLECT_WHISPER_COMMAND;
  const cmd = getWhisperCommand();
  assert.equal(cmd, "whisper-cli");
  if (original !== undefined) process.env.SONOLECT_WHISPER_COMMAND = original;
}

{
  // With env override
  const original = process.env.SONOLECT_WHISPER_COMMAND;
  process.env.SONOLECT_WHISPER_COMMAND = "/usr/local/bin/faster-whisper";
  const cmd = getWhisperCommand();
  assert.equal(cmd, "/usr/local/bin/faster-whisper");
  if (original !== undefined) {
    process.env.SONOLECT_WHISPER_COMMAND = original;
  } else {
    delete process.env.SONOLECT_WHISPER_COMMAND;
  }
}

console.log("  getWhisperCommand tests passed");

// ---------------------------------------------------------------------------
// buildWhisperArgs
// ---------------------------------------------------------------------------

{
  const args = buildWhisperArgs("/tmp/audio.wav");
  assert.deepEqual(args, ["--file", "/tmp/audio.wav", "--output-json"]);
}

{
  const args = buildWhisperArgs("/tmp/audio.wav", "fr");
  assert.ok(args.includes("--language"));
  assert.ok(args.includes("fr"));
}

{
  // "auto" language should NOT add --language flag
  const args = buildWhisperArgs("/tmp/audio.wav", "auto");
  assert.ok(!args.includes("--language"));
}

{
  // Model from env
  const original = process.env.SONOLECT_WHISPER_MODEL;
  process.env.SONOLECT_WHISPER_MODEL = "/models/ggml-base.en.bin";
  const args = buildWhisperArgs("/tmp/audio.wav");
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("/models/ggml-base.en.bin"));
  if (original !== undefined) {
    process.env.SONOLECT_WHISPER_MODEL = original;
  } else {
    delete process.env.SONOLECT_WHISPER_MODEL;
  }
}

console.log("  buildWhisperArgs tests passed");

// ---------------------------------------------------------------------------
// parseWhisperOutput
// ---------------------------------------------------------------------------

{
  // Valid JSON output with segments
  const output = parseWhisperOutput(
    JSON.stringify({
      text: "Hello world",
      language: "en",
      segments: [
        { text: "Hello", start: 0.0, end: 0.5 },
        { text: "world", start: 0.5, end: 1.0 },
      ],
    }),
  );
  assert.equal(output.text, "Hello world");
  assert.equal(output.language, "en");
  assert.equal(output.segments.length, 2);
  assert.equal(output.segments[0]!.text, "Hello");
}

{
  // JSON with preamble text
  const output = parseWhisperOutput(
    'whisper_init: loading model...\n{"text":"test output","language":"fr","segments":[]}',
  );
  assert.equal(output.text, "test output");
  assert.equal(output.language, "fr");
}

{
  // Plain text (no JSON)
  const output = parseWhisperOutput("This is a plain transcript");
  assert.equal(output.text, "This is a plain transcript");
  assert.equal(output.language, "en");
  assert.equal(output.segments.length, 0);
}

{
  // Empty output should throw
  assert.throws(() => parseWhisperOutput(""), /no output/);
}

{
  // Text assembled from segments when top-level text is empty
  const output = parseWhisperOutput(
    JSON.stringify({
      text: "",
      language: "de",
      segments: [
        { text: "Hallo", start: 0.0, end: 0.3 },
        { text: "Welt", start: 0.3, end: 0.6 },
      ],
    }),
  );
  assert.equal(output.text, "Hallo Welt");
  assert.equal(output.language, "de");
}

console.log("  parseWhisperOutput tests passed");

// ---------------------------------------------------------------------------
// processAudioTask (with mocked dependencies)
// ---------------------------------------------------------------------------

{
  // Successful processing
  const mockDeps: AudioHandlerDeps = {
    execFile: async () => ({
      stdout: JSON.stringify({
        text: "Transcribed audio",
        language: "en",
        segments: [{ text: "Transcribed audio", start: 0, end: 2 }],
      }),
      stderr: "",
    }),
    fileExists: async () => true,
    removeFile: async () => {},
  };

  const task: AudioTask = {
    jobId: "job-1",
    audioPath: "/tmp/test.wav",
    language: "en",
    userId: "user-1",
  };

  const result = await processAudioTask(task, mockDeps);
  assert.equal(result.success, true);
  assert.equal(result.text, "Transcribed audio");
  assert.equal(result.language, "en");
  assert.ok(result.transcriptId?.startsWith("tr-"));
  assert.ok(result.durationMs >= 0);
}

{
  // File not found
  const mockDeps: AudioHandlerDeps = {
    fileExists: async () => false,
    execFile: async () => ({ stdout: "", stderr: "" }),
    removeFile: async () => {},
  };

  const task: AudioTask = {
    jobId: "job-2",
    audioPath: "/tmp/nonexistent.wav",
    userId: "user-1",
  };

  const result = await processAudioTask(task, mockDeps);
  assert.equal(result.success, false);
  assert.ok(result.error?.includes("not found"));
}

{
  // Whisper process error
  const mockDeps: AudioHandlerDeps = {
    fileExists: async () => true,
    execFile: async () => {
      throw new Error("Whisper process failed: model not found");
    },
    removeFile: async () => {},
  };

  const task: AudioTask = {
    jobId: "job-3",
    audioPath: "/tmp/test.wav",
    userId: "user-1",
  };

  const result = await processAudioTask(task, mockDeps);
  assert.equal(result.success, false);
  assert.ok(result.error?.includes("model not found"));
}

console.log("  processAudioTask tests passed");

console.log("Audio handler tests passed");
