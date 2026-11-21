import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MAX_STYLE_PRESET_CHARS, type AiProviders } from "./ai.js";
import { createAuthenticatedTestApp } from "./test-app.js";

/**
 * The presets the mobile app sends to /v1/polish, read from its source so the
 * test always uses the real strings. The desktop app sends no preset
 * (cloudPolish in apps/desktop/src/voiceApi.ts sends the transcript and the
 * locale only).
 */
const readMobilePresets = async (): Promise<string[]> => {
  const source = await readFile(
    new URL("../../../apps/mobile/src/refine.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export function stylePresetForMode(");
  assert.notEqual(start, -1, "stylePresetForMode not found in refine.ts");
  const end = source.indexOf("\n}\n", start);
  const body = source.slice(start, end);
  return [...body.matchAll(/return\s+("(?:[^"\\]|\\.)*")/g)].map(
    (match) => JSON.parse(match[1]!) as string,
  );
};

type PolishCall = Parameters<AiProviders["polish"]>[0];

const createPolishApp = async () => {
  const calls: PolishCall[] = [];
  const app = await createAuthenticatedTestApp({
    logger: false,
    aiProviders: {
      configured: () => true,
      polish: async (opts) => {
        calls.push(opts);
        return { polished: `polished: ${opts.transcript}`, model: "test" };
      },
    },
  });
  const polish = (payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: "/v1/polish",
      headers: { authorization: "Bearer user-a" },
      payload,
    });
  return { app, calls, polish };
};

describe("POST /v1/polish style presets", () => {
  it("finds every mobile preset, each within the cap", async () => {
    const presets = await readMobilePresets();
    // rewrite, reply, summarize, task_creation and dictate.
    assert.ok(presets.length >= 5, `found ${presets.length} presets`);
    for (const preset of presets) {
      assert.ok(
        preset.length <= MAX_STYLE_PRESET_CHARS,
        `"${preset}" is ${preset.length} characters; the API accepts ${MAX_STYLE_PRESET_CHARS}`,
      );
    }
  });

  it("passes each mobile preset to the model unchanged", async () => {
    const presets = await readMobilePresets();
    const { app, calls, polish } = await createPolishApp();
    try {
      for (const stylePreset of presets) {
        const response = await polish({
          transcript: "so the meeting moved to tuesday",
          stylePreset,
          locale: "en-US",
          dictionary: [{ spoken: "sonolect", written: "Sonolect" }],
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(calls.at(-1)?.stylePreset, stylePreset);
      }
      assert.equal(calls.length, presets.length);
    } finally {
      await app.close();
    }
  });

  it("keeps the desktop request, which sends no preset", async () => {
    const { app, calls, polish } = await createPolishApp();
    try {
      const response = await polish({
        transcript: "the meeting moved to tuesday",
        locale: "en-US",
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(
        response.json().polished,
        "polished: the meeting moved to tuesday",
      );
      assert.equal(calls[0]?.stylePreset, undefined);
      assert.equal(calls[0]?.locale, "en-US");
    } finally {
      await app.close();
    }
  });

  it("accepts a preset at the cap and treats a blank one as none", async () => {
    const { app, calls, polish } = await createPolishApp();
    try {
      const atCap = "a".repeat(MAX_STYLE_PRESET_CHARS);
      assert.equal(
        (await polish({ transcript: "hello", stylePreset: atCap })).statusCode,
        200,
      );
      assert.equal(calls[0]?.stylePreset, atCap);
      for (const stylePreset of ["", "   ", null]) {
        const response = await polish({ transcript: "hello", stylePreset });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(calls.at(-1)?.stylePreset, undefined);
      }
    } finally {
      await app.close();
    }
  });

  it("refuses an over-long or malformed preset with 422 and calls no model", async () => {
    const { app, calls, polish } = await createPolishApp();
    try {
      for (const stylePreset of [
        "a".repeat(MAX_STYLE_PRESET_CHARS + 1),
        42,
        ["Rewrite"],
        { text: "Rewrite" },
      ]) {
        const response = await polish({ transcript: "hello", stylePreset });
        assert.equal(response.statusCode, 422, response.body);
        assert.equal(response.json().error.code, "invalid_style_preset");
      }
      assert.equal(calls.length, 0);
    } finally {
      await app.close();
    }
  });
});
