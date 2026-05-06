import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  rewriteWithLocalRules,
  buildRewritePrompt,
  rewriteWithLlm,
  rewrite,
} from "./llmRewriter";
import type { RewriteRequest, LlmRewriterConfig } from "./llmRewriter";

describe("llmRewriter", () => {
  describe("rewriteWithLocalRules", () => {
    it("removes filler words and cleans up text", () => {
      const request: RewriteRequest = {
        text: "um so like I wanted to uh tell you something you know",
      };
      const result = rewriteWithLocalRules(request);
      assert.equal(result.method, "local");
      assert.equal(result.original, request.text);
      // Filler words should be removed
      assert.ok(!result.rewritten.includes("um "));
      assert.ok(!result.rewritten.includes("uh "));
      assert.ok(!result.rewritten.includes("like "));
      assert.ok(result.rewritten.length > 0);
    });

    it("applies a style preset when specified", () => {
      const request: RewriteRequest = {
        text: "I can't believe it's that simple",
        style: "professional",
      };
      const result = rewriteWithLocalRules(request);
      assert.equal(result.method, "local");
      // Professional should expand contractions
      assert.ok(result.rewritten.includes("cannot"));
      assert.ok(result.changes.length > 0);
    });

    it("skips style transform for custom preset", () => {
      const raw = "Hello world.";
      const request: RewriteRequest = { text: raw, style: "custom" };
      const result = rewriteWithLocalRules(request);
      // custom is pass-through; polishDictation will capitalize + punctuate
      assert.equal(result.method, "local");
      assert.ok(result.rewritten.includes("Hello"));
    });

    it("reports no changes when text is already clean", () => {
      const request: RewriteRequest = { text: "Hello world." };
      const result = rewriteWithLocalRules(request);
      assert.equal(result.changes.length, 0);
    });

    it("returns latencyMs as a non-negative number", () => {
      const result = rewriteWithLocalRules({ text: "testing latency" });
      assert.ok(result.latencyMs >= 0);
    });

    it("handles empty text", () => {
      const result = rewriteWithLocalRules({ text: "" });
      assert.equal(result.rewritten, "");
    });
  });

  describe("buildRewritePrompt", () => {
    it("includes the source text", () => {
      const prompt = buildRewritePrompt({ text: "Hello world" });
      assert.ok(prompt.includes("Hello world"));
    });

    it("includes professional style guidance", () => {
      const prompt = buildRewritePrompt({
        text: "test",
        style: "professional",
      });
      assert.ok(prompt.includes("professional"));
      assert.ok(prompt.includes("formal"));
    });

    it("includes concise style guidance", () => {
      const prompt = buildRewritePrompt({ text: "test", style: "concise" });
      assert.ok(prompt.toLowerCase().includes("concise"));
    });

    it("includes custom instruction when provided", () => {
      const prompt = buildRewritePrompt({
        text: "test",
        instruction: "Make it rhyme",
      });
      assert.ok(prompt.includes("Make it rhyme"));
    });

    it("includes context when provided", () => {
      const prompt = buildRewritePrompt({
        text: "test",
        context: "Medical report",
      });
      assert.ok(prompt.includes("Medical report"));
    });

    it("asks for only rewritten text, no commentary", () => {
      const prompt = buildRewritePrompt({ text: "test" });
      assert.ok(prompt.includes("ONLY the rewritten text"));
    });

    it("does not include style guide for custom preset", () => {
      const prompt = buildRewritePrompt({ text: "test", style: "custom" });
      // custom has empty style guide, should not crash
      assert.ok(prompt.includes("test"));
    });
  });

  describe("rewriteWithLlm", () => {
    it("falls back to local rules when provider is local", async () => {
      const config: LlmRewriterConfig = { provider: "local" };
      const result = await rewriteWithLlm({ text: "um hello" }, config);
      assert.equal(result.method, "local");
      assert.ok(!result.rewritten.includes("um "));
    });

    it("falls back to local rules on network error (openai)", async () => {
      // No real API key, so fetch will fail -> fallback
      const config: LlmRewriterConfig = {
        provider: "openai",
        apiKey: "fake-key-for-test",
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error("Network unavailable");
      };
      try {
        const result = await rewriteWithLlm({ text: "um hello" }, config);
        assert.equal(result.method, "local");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("falls back to local rules on network error (anthropic)", async () => {
      const config: LlmRewriterConfig = {
        provider: "anthropic",
        apiKey: "fake-key-for-test",
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error("Network unavailable");
      };
      try {
        const result = await rewriteWithLlm({ text: "um hello" }, config);
        assert.equal(result.method, "local");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("falls back on non-ok HTTP response", async () => {
      const config: LlmRewriterConfig = {
        provider: "openai",
        apiKey: "fake-key",
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response("Unauthorized", { status: 401 });
      try {
        const result = await rewriteWithLlm({ text: "um hello" }, config);
        assert.equal(result.method, "local");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns cloud result on successful OpenAI response", async () => {
      const config: LlmRewriterConfig = {
        provider: "openai",
        apiKey: "test-key",
        model: "gpt-4o-mini",
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Hello there." } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      try {
        const result = await rewriteWithLlm({ text: "um hello there" }, config);
        assert.equal(result.method, "cloud");
        assert.equal(result.rewritten, "Hello there.");
        assert.ok(result.changes.includes("LLM-powered rewrite"));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns cloud result on successful Anthropic response", async () => {
      const config: LlmRewriterConfig = {
        provider: "anthropic",
        apiKey: "test-key",
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "Polished text here." }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      try {
        const result = await rewriteWithLlm({ text: "raw input" }, config);
        assert.equal(result.method, "cloud");
        assert.equal(result.rewritten, "Polished text here.");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("rewrite (smart dispatcher)", () => {
    it("uses local rules when no config provided", async () => {
      const result = await rewrite({ text: "um hello" });
      assert.equal(result.method, "local");
    });

    it("uses local rules when provider is local", async () => {
      const result = await rewrite({ text: "um hello" }, { provider: "local" });
      assert.equal(result.method, "local");
    });

    it("uses local rules when api key is missing", async () => {
      const result = await rewrite(
        { text: "um hello" },
        { provider: "openai" },
      );
      assert.equal(result.method, "local");
    });

    it("attempts cloud when config has provider and key", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Clean text." } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      try {
        const result = await rewrite(
          { text: "um hello" },
          { provider: "openai", apiKey: "key" },
        );
        assert.equal(result.method, "cloud");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
