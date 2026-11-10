import { it } from "node:test";
import assert from "node:assert/strict";
import {
  parseProviderPreferences,
  serializeProviderPreferences,
  modelsForTask,
} from "./providerSettings";

it("defaults to local transcription and never persists API keys with preferences", () => {
  const preferences = parseProviderPreferences(
    '{"apiKey":"secret","stt":{"provider":"evil","model":"bad"}}',
  );
  assert.equal(preferences.stt.provider, "local");
  assert.ok(!serializeProviderPreferences(preferences).includes("secret"));
  assert.ok(!serializeProviderPreferences(preferences).includes("apiKey"));
});
it("restores independent transcription speech and editing models", () => {
  const saved = {
    stt: { provider: "openrouter", model: "vendor/stt" },
    tts: { provider: "openrouter", model: "vendor/tts" },
    text: { provider: "opencode", model: "gpt-5" },
    voice: "alloy",
  };
  assert.deepEqual(parseProviderPreferences(JSON.stringify(saved)), saved);
});
it("does not offer text-only models for speech tasks", () => {
  const models = [
    { id: "a", name: "A", capabilities: ["text"], voices: [] },
    { id: "b", name: "B", capabilities: ["stt"], voices: [] },
  ];
  assert.deepEqual(
    modelsForTask(models, "stt").map((model) => model.id),
    ["b"],
  );
});
it("does not restore unsupported Zen speech selections", () => {
  const result = parseProviderPreferences(
    '{"tts":{"provider":"opencode","model":"gpt-5"}}',
  );
  assert.equal(result.tts.provider, "openrouter");
  assert.equal(result.tts.model, "");
});
