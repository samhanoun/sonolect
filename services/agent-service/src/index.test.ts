import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { createApp } from "./index.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

describe("POST /llm/rewrite", () => {
  beforeEach(async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    app = await createApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("rewrites text using local fallback when no API key is set", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/llm/rewrite",
      payload: { text: "hello world.  this is  a test.", style: "formal" },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json<{
      original: string;
      rewritten: string;
      provider: string;
    }>();
    assert.equal(body.original, "hello world.  this is  a test.");
    assert.equal(body.provider, "local");
    // Local rewrite should fix double spaces
    assert.ok(
      !body.rewritten.includes("  "),
      "Double spaces should be removed",
    );
  });

  it("returns 400 when text is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/llm/rewrite",
      payload: { style: "formal" },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = res.json<{ error: string }>();
    assert.equal(body.error, "validation_error");
  });

  it("returns 400 when style is invalid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/llm/rewrite",
      payload: { text: "hello", style: "poetic" },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = res.json<{ error: string }>();
    assert.equal(body.error, "validation_error");
  });

  it("returns 429 after exceeding 30 requests per minute", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/llm/rewrite",
        payload: { text: "hi", style: "concise" },
      });
      assert.equal(res.statusCode, 200, `Request ${i + 1} failed: ${res.body}`);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/llm/rewrite",
      payload: { text: "hi", style: "concise" },
    });
    assert.equal(limited.statusCode, 429, limited.body);
    const body = limited.json<{ error: string }>();
    assert.equal(body.error, "rate_limit");
  });
});

describe("POST /llm/summarize", () => {
  beforeEach(async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    app = await createApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("summarizes text using local fallback with brief style", async () => {
    const text =
      "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.";
    const res = await app.inject({
      method: "POST",
      url: "/llm/summarize",
      payload: { text, style: "brief" },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json<{
      summary: string;
      style: string;
      provider: string;
    }>();
    assert.equal(body.style, "brief");
    assert.equal(body.provider, "local");
    // Brief should contain at most first 3 sentences
    assert.ok(body.summary.includes("First sentence."));
    assert.ok(body.summary.includes("Third sentence."));
    assert.ok(!body.summary.includes("Fourth sentence."));
  });

  it("summarizes text using local fallback with bullets style", async () => {
    const text = "First point. Second point. Third point.";
    const res = await app.inject({
      method: "POST",
      url: "/llm/summarize",
      payload: { text, style: "bullets" },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json<{
      summary: string;
      style: string;
      provider: string;
    }>();
    assert.equal(body.style, "bullets");
    assert.equal(body.provider, "local");
    assert.ok(body.summary.includes("- First point."));
    assert.ok(body.summary.includes("- Third point."));
  });

  it("summarizes text using local fallback with action-items style", async () => {
    const text = "Do this task. Complete that work. Review the code.";
    const res = await app.inject({
      method: "POST",
      url: "/llm/summarize",
      payload: { text, style: "action-items" },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json<{
      summary: string;
      style: string;
      provider: string;
    }>();
    assert.equal(body.style, "action-items");
    assert.ok(body.summary.includes("[ ] Do this task."));
  });

  it("returns 400 when text is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/llm/summarize",
      payload: { style: "brief" },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = res.json<{ error: string }>();
    assert.equal(body.error, "validation_error");
  });

  it("returns 400 when style is invalid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/llm/summarize",
      payload: { text: "hello", style: "executive" },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = res.json<{ error: string }>();
    assert.equal(body.error, "validation_error");
  });

  it("returns 429 after exceeding 30 requests per minute", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/llm/summarize",
        payload: { text: "some text here.", style: "brief" },
      });
      assert.equal(res.statusCode, 200, `Request ${i + 1} failed: ${res.body}`);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/llm/summarize",
      payload: { text: "some text here.", style: "brief" },
    });
    assert.equal(limited.statusCode, 429, limited.body);
    const body = limited.json<{ error: string }>();
    assert.equal(body.error, "rate_limit");
  });
});
