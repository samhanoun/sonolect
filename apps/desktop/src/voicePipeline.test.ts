import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { preprocessAudio, AUDIO_PRESETS } from "./audioPreprocessing";
import {
  extractProperNouns,
  extractTechnicalTerms,
  buildWhisperPrompt,
} from "./contextSpelling";
import {
  matchVoiceCommand,
  applyVoiceCommand,
  VOICE_COMMANDS,
} from "./voiceCommands";
import { processTranscriptWithCommands } from "./voiceCommandIntegration";
import {
  createStreamingState,
  processStreamWindow,
  type StreamConfig,
} from "./streamingTranscription";

describe("voice pipeline integration", () => {
  describe("audioPreprocessing with presets", () => {
    it("normal preset produces valid Float32Array with normalized values", () => {
      const raw = new Float32Array([0.05, -0.1, 0.3, -0.5, 0.002]);
      const result = preprocessAudio(raw, AUDIO_PRESETS.normal);
      assert.ok(result instanceof Float32Array);
      assert.equal(result.length, raw.length);
      for (let i = 0; i < result.length; i++) {
        assert.ok(result[i]! >= -1 && result[i]! <= 1);
      }
    });

    it("whisper preset amplifies quiet audio", () => {
      const raw = new Float32Array([0.01, 0.02, 0.03, 0.1, -0.1]);
      const result = preprocessAudio(raw, AUDIO_PRESETS.whisper);
      assert.ok(result instanceof Float32Array);
      const maxVal = Math.max(...Array.from(result).map(Math.abs));
      assert.ok(maxVal > 0);
    });

    it("noisy preset gates low-energy samples to zero", () => {
      const raw = new Float32Array([0.01, 0.02, 0.04, 0.8, -0.9]);
      const result = preprocessAudio(raw, AUDIO_PRESETS.noisy);
      assert.ok(result instanceof Float32Array);
      assert.equal(result.length, raw.length);
    });
  });

  describe("contextSpelling extraction and prompt building", () => {
    const sampleText =
      "John Smith met with Alice Johnson to discuss the TensorFlow migration. " +
      "They reviewed the apiGateway config and the AWS_SECRET_KEY variable. " +
      "The app.config.json file needs updating for the React.Component refactor.";

    it("extracts proper nouns from sample text", () => {
      const nouns = extractProperNouns(sampleText);
      assert.ok(nouns.length > 0);
      assert.ok(nouns.includes("John Smith"));
      assert.ok(nouns.includes("Alice Johnson"));
    });

    it("extracts technical terms from sample text", () => {
      const terms = extractTechnicalTerms(sampleText);
      assert.ok(terms.length > 0);
      assert.ok(terms.includes("apiGateway"));
      assert.ok(terms.includes("AWS_SECRET_KEY"));
      assert.ok(terms.some((t) => t.includes("app.config")));
    });

    it("builds whisper prompt from extracted terms", () => {
      const nouns = extractProperNouns(sampleText);
      const terms = extractTechnicalTerms(sampleText);
      const prompt = buildWhisperPrompt({
        properNouns: nouns,
        technicalTerms: terms,
      });
      assert.ok(prompt.length > 0);
      assert.ok(prompt.length <= 800);
      assert.ok(prompt.includes("John Smith"));
      assert.ok(prompt.includes("apiGateway"));
    });

    it("builds prompt with custom terms added", () => {
      const prompt = buildWhisperPrompt({
        properNouns: ["Kubernetes"],
        technicalTerms: ["kubectl"],
        customTerms: ["Sonolect", "Whisper"],
      });
      assert.ok(prompt.includes("Kubernetes"));
      assert.ok(prompt.includes("kubectl"));
      assert.ok(prompt.includes("Sonolect"));
      assert.ok(prompt.includes("Whisper"));
    });
  });

  describe("voiceCommands matching and application", () => {
    it("matches and applies delete that", () => {
      const cmd = matchVoiceCommand("some text delete that");
      assert.ok(cmd);
      assert.equal(cmd!.name, "delete that");
      const result = applyVoiceCommand("first sentence. some text", cmd!);
      assert.equal(result, "first sentence. ");
    });

    it("matches and applies new line", () => {
      const cmd = matchVoiceCommand("first line new line");
      assert.ok(cmd);
      assert.equal(cmd!.action, "insert_newline");
      const result = applyVoiceCommand("first line", cmd!);
      assert.equal(result, "first line\n");
    });

    it("matches and applies bold that", () => {
      const cmd = matchVoiceCommand("important bold that");
      assert.ok(cmd);
      assert.equal(cmd!.action, "bold");
      const result = applyVoiceCommand("important", cmd!);
      assert.equal(result, "**important**");
    });

    it("matches and applies italic that", () => {
      const cmd = matchVoiceCommand("emphasis italic that");
      assert.ok(cmd);
      assert.equal(cmd!.action, "italic");
      const result = applyVoiceCommand("emphasis", cmd!);
      assert.equal(result, "*emphasis*");
    });

    it("matches and applies uppercase that", () => {
      const cmd = matchVoiceCommand("warning uppercase that");
      assert.ok(cmd);
      const result = applyVoiceCommand("warning", cmd!);
      assert.equal(result, "WARNING");
    });

    it("matches and applies punctuation commands", () => {
      const period = matchVoiceCommand("end period");
      assert.ok(period);
      assert.equal(applyVoiceCommand("end", period!), "end.");

      const comma = matchVoiceCommand("pause comma");
      assert.ok(comma);
      assert.equal(applyVoiceCommand("pause", comma!), "pause,");

      const question = matchVoiceCommand("really question mark");
      assert.ok(question);
      assert.equal(applyVoiceCommand("really", question!), "really?");

      const exclamation = matchVoiceCommand("wow exclamation mark");
      assert.ok(exclamation);
      assert.equal(applyVoiceCommand("wow", exclamation!), "wow!");
    });

    it("returns null for non-command text", () => {
      const cmd = matchVoiceCommand("just a normal sentence");
      assert.equal(cmd, null);
    });

    it("covers all defined command types", () => {
      for (const vc of VOICE_COMMANDS) {
        const testText = `some text ${vc.name}`;
        const matched = matchVoiceCommand(testText);
        assert.ok(matched, `should match command: ${vc.name}`);
        assert.equal(matched!.action, vc.action);
      }
    });
  });

  describe("voiceCommandIntegration with multiple commands", () => {
    it("processes text with period command", () => {
      const { cleanText, appliedCommands } =
        processTranscriptWithCommands("hello world period");
      assert.equal(cleanText, "hello world.");
      assert.deepEqual(appliedCommands, ["period"]);
    });

    it("processes text with bold that", () => {
      const { cleanText, appliedCommands } = processTranscriptWithCommands(
        "context here. important bold that",
      );
      assert.equal(cleanText, "context here. **important**");
      assert.deepEqual(appliedCommands, ["bold that"]);
    });

    it("processes text with uppercase and period", () => {
      const { cleanText, appliedCommands } = processTranscriptWithCommands(
        "alert uppercase that",
      );
      assert.equal(cleanText, "ALERT");
      assert.ok(appliedCommands.includes("uppercase that"));
    });

    it("leaves non-command text unchanged", () => {
      const { cleanText, appliedCommands } = processTranscriptWithCommands(
        "this is just a normal sentence without commands",
      );
      assert.equal(
        cleanText,
        "this is just a normal sentence without commands",
      );
      assert.deepEqual(appliedCommands, []);
    });
  });

  describe("streamingTranscription processStreamWindow", () => {
    function makeConfig(overrides?: Partial<StreamConfig>): StreamConfig {
      return {
        windowSizeMs: 5000,
        overlapMs: 500,
        language: "auto",
        vadEnabled: false,
        onPartialResult: () => {},
        onFinalResult: () => {},
        ...overrides,
      };
    }

    it("buffers audio until window is full", () => {
      const state = createStreamingState();
      const chunk = new Float32Array(16000);
      const config = makeConfig();
      const { state: s1, action } = processStreamWindow(
        state,
        chunk,
        0,
        config,
      );
      assert.equal(action, "wait");
      assert.ok(s1.isStreaming);
      assert.equal(s1.buffer.length, 1);
    });

    it("returns transcribe when window size reached with VAD disabled", () => {
      let state = createStreamingState();
      const config = makeConfig({ windowSizeMs: 2000, vadEnabled: false });
      const chunkSize = 16000;
      const chunk = new Float32Array(chunkSize);
      for (let i = 0; i < chunkSize; i++) {
        chunk[i] = Math.sin(i * 0.1) * 0.5;
      }

      const r1 = processStreamWindow(state, chunk, 0, config);
      state = r1.state;

      const r2 = processStreamWindow(state, chunk, 1000, config);
      assert.equal(r2.action, "transcribe");
      assert.ok(r2.state.windowIndex > 0);
    });

    it("increments window index after processing", () => {
      let state = createStreamingState();
      const config = makeConfig({ windowSizeMs: 1000, vadEnabled: false });
      const chunk = new Float32Array(16000);
      for (let i = 0; i < 16000; i++) {
        chunk[i] = Math.sin(i * 0.1) * 0.3;
      }
      const { state: s1 } = processStreamWindow(state, chunk, 0, config);
      assert.ok(s1.windowIndex >= 1);
    });
  });

  describe("end-to-end: raw audio → preprocess → voice commands → clean text", () => {
    it("full pipeline from audio samples to cleaned transcript", () => {
      const rawSamples = new Float32Array(4800);
      for (let i = 0; i < rawSamples.length; i++) {
        rawSamples[i] = Math.sin(i * 0.05) * 0.4 + (Math.random() - 0.5) * 0.02;
      }

      const processed = preprocessAudio(rawSamples, AUDIO_PRESETS.normal);
      assert.ok(processed instanceof Float32Array);
      assert.equal(processed.length, rawSamples.length);
      const peak = Math.max(...Array.from(processed).map(Math.abs));
      assert.ok(peak <= 1.0);
      assert.ok(peak > 0);

      const simulatedTranscript =
        "The meeting with John Smith about apiGateway went well period";

      const properNouns = extractProperNouns(simulatedTranscript);
      const technicalTerms = extractTechnicalTerms(simulatedTranscript);
      const prompt = buildWhisperPrompt({
        properNouns,
        technicalTerms,
      });
      assert.ok(prompt.length > 0);

      const { cleanText, appliedCommands } =
        processTranscriptWithCommands(simulatedTranscript);
      assert.equal(
        cleanText,
        "The meeting with John Smith about apiGateway went well.",
      );
      assert.deepEqual(appliedCommands, ["period"]);
    });

    it("pipeline handles transcript with formatting commands", () => {
      const rawSamples = new Float32Array(3200);
      for (let i = 0; i < rawSamples.length; i++) {
        rawSamples[i] = Math.sin(i * 0.1) * 0.6;
      }
      const processed = preprocessAudio(rawSamples, AUDIO_PRESETS.whisper);
      assert.ok(processed instanceof Float32Array);

      const simulatedTranscript =
        "heading. deploy the TensorFlow model bold that";

      const terms = extractTechnicalTerms(simulatedTranscript);
      assert.ok(terms.includes("TensorFlow"));

      const { cleanText, appliedCommands } =
        processTranscriptWithCommands(simulatedTranscript);
      assert.equal(cleanText, "heading. **deploy the TensorFlow model**");
      assert.deepEqual(appliedCommands, ["bold that"]);
    });

    it("pipeline with noisy preset and multiple extractions", () => {
      const rawSamples = new Float32Array(6400);
      for (let i = 0; i < rawSamples.length; i++) {
        rawSamples[i] = (Math.random() - 0.5) * 0.03;
      }
      rawSamples[3000] = 0.8;
      rawSamples[3001] = -0.7;

      const processed = preprocessAudio(rawSamples, AUDIO_PRESETS.noisy);
      assert.ok(processed instanceof Float32Array);

      const simulatedTranscript =
        "Alice Johnson mentioned the MAX_RETRY_COUNT and process.env settings";
      const nouns = extractProperNouns(simulatedTranscript);
      const terms = extractTechnicalTerms(simulatedTranscript);
      assert.ok(nouns.includes("Alice Johnson"));
      assert.ok(terms.includes("MAX_RETRY_COUNT"));
      assert.ok(terms.some((t) => t.includes("process.env")));

      const prompt = buildWhisperPrompt({
        properNouns: nouns,
        technicalTerms: terms,
        customTerms: ["Sonolect"],
      });
      assert.ok(prompt.includes("Alice Johnson"));
      assert.ok(prompt.includes("Sonolect"));
    });
  });
});
