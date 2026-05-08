import { strict as assert } from "node:assert";
import { createApp } from "./index.js";
import type {
  AgentCommandExecutionResult,
  AgentDefinition,
  ListResponse,
} from "@sonolect/types";

const app = await createApp({ logger: false });

try {
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(
    health.json<{ service: string }>().service,
    "sonolect-agent-service",
  );

  const agents = await app.inject({ method: "GET", url: "/agents" });
  assert.equal(agents.statusCode, 200);
  assert.ok(agents.json<ListResponse<AgentDefinition>>().items.length >= 2);

  const createdAgent = await app.inject({
    method: "POST",
    url: "/agents",
    payload: {
      name: "Local Helper",
      type: "custom",
      systemPrompt: "Help safely.",
    },
  });
  assert.equal(createdAgent.statusCode, 201, createdAgent.body);
  assert.equal(createdAgent.json<AgentDefinition>().name, "Local Helper");

  const command = await app.inject({
    method: "POST",
    url: "/commands/execute",
    payload: { command: "copy this note", selectedText: "hello", dryRun: true },
  });
  assert.equal(command.statusCode, 202, command.body);
  const result = command.json<AgentCommandExecutionResult>();
  assert.equal(result.status, "queued");
  assert.equal(result.type, "copy_to_clipboard");

  const fetched = await app.inject({
    method: "GET",
    url: `/commands/${result.id}`,
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json<AgentCommandExecutionResult>().id, result.id);

  const blocked = await app.inject({
    method: "POST",
    url: "/commands/execute",
    payload: { command: "delete everything with token", dryRun: false },
  });
  assert.equal(blocked.statusCode, 202, blocked.body);
  assert.equal(blocked.json<AgentCommandExecutionResult>().status, "blocked");

  // -------------------------------------------------------------------------
  // LLM proxy routes — smoke tests (no API keys → local fallback)
  // -------------------------------------------------------------------------

  // POST /llm/rewrite — should return local fallback when no API keys set
  const rewrite = await app.inject({
    method: "POST",
    url: "/llm/rewrite",
    payload: { text: "Hello world." },
  });
  assert.equal(rewrite.statusCode, 200, rewrite.body);
  const rewriteResult = rewrite.json<{
    original: string;
    rewritten: string;
    method: string;
    latencyMs: number;
    changes: string[];
  }>();
  assert.equal(rewriteResult.original, "Hello world.");
  assert.equal(rewriteResult.method, "local");
  assert.ok(Array.isArray(rewriteResult.changes));

  // POST /llm/rewrite — validation error on empty text
  const rewriteBad = await app.inject({
    method: "POST",
    url: "/llm/rewrite",
    payload: { text: "" },
  });
  assert.equal(rewriteBad.statusCode, 400, rewriteBad.body);

  // POST /llm/summarize — should return local fallback when no API keys set
  const summarize = await app.inject({
    method: "POST",
    url: "/llm/summarize",
    payload: { transcript: "We decided to launch next month.", style: "brief" },
  });
  assert.equal(summarize.statusCode, 200, summarize.body);
  const summarizeResult = summarize.json<{
    summary: string;
    actionItems: unknown[];
    keyDecisions: string[];
    participants: string[];
    method: string;
    latencyMs: number;
  }>();
  assert.equal(summarizeResult.method, "local");
  assert.ok(Array.isArray(summarizeResult.actionItems));
  assert.ok(Array.isArray(summarizeResult.keyDecisions));
  assert.ok(Array.isArray(summarizeResult.participants));

  // POST /llm/summarize — validation error on empty transcript
  const summarizeBad = await app.inject({
    method: "POST",
    url: "/llm/summarize",
    payload: { transcript: "", style: "brief" },
  });
  assert.equal(summarizeBad.statusCode, 400, summarizeBad.body);

  // POST /llm/summarize — validation error on missing style
  const summarizeBad2 = await app.inject({
    method: "POST",
    url: "/llm/summarize",
    payload: { transcript: "Hello" },
  });
  assert.equal(summarizeBad2.statusCode, 400, summarizeBad2.body);
} finally {
  await app.close();
}

console.log("Agent service smoke test passed");
