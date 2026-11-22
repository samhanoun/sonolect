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

describe("service security", () => {
  const token = "t".repeat(40);
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  it("refuses to start in production without a service token", async () => {
    await assert.rejects(
      createApp({ logger: false, env: { NODE_ENV: "production" } }),
      /SONOLECT_SERVICE_TOKENS/,
    );
    app = await createApp({ logger: false, env: {} });
  });

  it("requires the service token and keeps users apart", async () => {
    // Outside production a configured token is enforced the same way.
    // Production refuses commands outright (see "production" below).
    app = await createApp({
      logger: false,
      env: { SONOLECT_SERVICE_TOKENS: token },
    });
    const anonymous = await app.inject({
      method: "POST",
      url: "/llm/rewrite",
      headers: { "x-user-id": "victim" },
      payload: { text: "hello", style: "formal" },
    });
    assert.equal(anonymous.statusCode, 401, anonymous.body);

    const alice = { authorization: `Bearer ${token}`, "x-user-id": "alice" };
    const created = await app.inject({
      method: "POST",
      url: "/commands/execute",
      headers: alice,
      payload: { command: "copy this note", dryRun: false },
    });
    assert.equal(created.statusCode, 202, created.body);
    const command = created.json<{ id: string; status: string }>();
    // Nothing executes without an executor, so nothing may claim completion.
    assert.equal(command.status, "queued");

    const asBob = await app.inject({
      method: "GET",
      url: `/commands/${command.id}`,
      headers: { authorization: `Bearer ${token}`, "x-user-id": "bob" },
    });
    assert.equal(asBob.statusCode, 404);
  });

  it("rejects oversized text before calling a provider", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    app = await createApp({
      logger: false,
      env: { ANTHROPIC_API_KEY: "test-key" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/llm/summarize",
      payload: { text: "a".repeat(50_001), style: "brief" },
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(called, false);
  });

  it("sends the configured model and returns the text blocks", async () => {
    let requestBody: { model?: string } = {};
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as { model?: string };
      return new Response(
        JSON.stringify({
          content: [
            { type: "thinking", thinking: "" },
            { type: "text", text: "Rewritten." },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    app = await createApp({
      logger: false,
      env: { ANTHROPIC_API_KEY: "test-key" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/llm/rewrite",
      payload: { text: "hello", style: "formal", provider: "anthropic" },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json<{ rewritten: string }>().rewritten, "Rewritten.");
    assert.equal(requestBody.model, "claude-sonnet-5-5");
  });

  it("hides provider failures behind a generic 502", async () => {
    globalThis.fetch = (async () =>
      new Response("invalid x-api-key sk-secret-detail", {
        status: 401,
      })) as typeof fetch;
    app = await createApp({
      logger: false,
      env: { OPENAI_API_KEY: "test-key" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/llm/rewrite",
      payload: { text: "hello", style: "formal" },
    });
    assert.equal(res.statusCode, 502, res.body);
    assert.equal(res.json<{ error: string }>().error, "upstream_error");
    assert.ok(!res.body.includes("sk-secret-detail"));
  });
});

describe("production", () => {
  const token = "p".repeat(40);
  const headers = { authorization: `Bearer ${token}`, "x-user-id": "alice" };
  const originalFetch = globalThis.fetch;
  const productionApp = (env: Record<string, string> = {}) =>
    createApp({
      logger: false,
      env: { NODE_ENV: "production", SONOLECT_SERVICE_TOKENS: token, ...env },
    });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  it("answers 503 not_configured instead of a local rewrite or summary without a key", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    app = await productionApp();
    for (const [url, style] of [
      ["/llm/rewrite", "formal"],
      ["/llm/summarize", "brief"],
    ] as const) {
      const res = await app.inject({
        method: "POST",
        url,
        headers,
        payload: { text: "hello world.  this is  a test.", style },
      });
      assert.equal(res.statusCode, 503, res.body);
      const body = res.json<{ error: string; message: string }>();
      assert.equal(body.error, "not_configured");
      assert.match(body.message, /OPENAI_API_KEY or ANTHROPIC_API_KEY/);
      assert.ok(!res.body.includes("this is a test"));

      const anonymous = await app.inject({
        method: "POST",
        url,
        payload: { text: "hello", style },
      });
      assert.equal(anonymous.statusCode, 401);
    }
    assert.equal(called, false);
  });

  it("refuses a provider without a key when another one has a key", async () => {
    app = await productionApp({ OPENAI_API_KEY: "test-key" });
    const res = await app.inject({
      method: "POST",
      url: "/llm/rewrite",
      headers,
      payload: { text: "hello", style: "formal", provider: "anthropic" },
    });
    assert.equal(res.statusCode, 503, res.body);
    assert.equal(res.json<{ error: string }>().error, "not_configured");
    assert.match(res.json<{ message: string }>().message, /ANTHROPIC_API_KEY/);
  });

  it("still calls the provider when its key is set", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ content: [{ type: "text", text: "Summary." }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    app = await productionApp({ ANTHROPIC_API_KEY: "test-key" });
    const res = await app.inject({
      method: "POST",
      url: "/llm/summarize",
      headers,
      payload: { text: "One. Two. Three.", style: "brief" },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json<{ summary: string }>().summary, "Summary.");
    assert.equal(res.json<{ provider: string }>().provider, "anthropic");
  });

  it("answers 501 for commands and custom agents, and keeps the built-in agents", async () => {
    app = await productionApp({ OPENAI_API_KEY: "test-key" });
    for (const request of [
      {
        method: "POST",
        url: "/commands/execute",
        payload: { command: "copy this note", dryRun: true },
      },
      {
        method: "POST",
        url: "/commands/execute",
        payload: { command: "copy this note", dryRun: false },
      },
      { method: "GET", url: "/commands/any-id" },
      {
        method: "POST",
        url: "/agents",
        payload: { name: "Helper", type: "custom", systemPrompt: "Help." },
      },
    ] as const) {
      const res = await app.inject({ ...request, headers });
      assert.equal(res.statusCode, 501, `${request.url}: ${res.body}`);
      assert.equal(res.json<{ error: string }>().error, "not_implemented");
    }

    const agents = await app.inject({ method: "GET", url: "/agents", headers });
    assert.equal(agents.statusCode, 200, agents.body);
    assert.deepEqual(
      agents.json<{ items: { id: string }[] }>().items.map((agent) => agent.id),
      ["dictation", "command"],
    );
  });
});
