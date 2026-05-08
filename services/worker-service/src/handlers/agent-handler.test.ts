import { strict as assert } from "node:assert";
import {
  buildRewritePrompt,
  buildSummaryPrompt,
  buildActionExtractionPrompt,
  processAgentTask,
  type AgentTask,
  type AgentHandlerDeps,
} from "./agent-handler.js";

// ---------------------------------------------------------------------------
// buildRewritePrompt
// ---------------------------------------------------------------------------

{
  const prompt = buildRewritePrompt("Hello world");
  assert.ok(prompt.includes("professional editor"));
  assert.ok(prompt.includes("Hello world"));
  assert.ok(prompt.includes("Return ONLY the rewritten text"));
}

{
  const prompt = buildRewritePrompt("Some text", "concise");
  assert.ok(prompt.includes("concise"));
  assert.ok(prompt.includes("remove redundancy"));
}

{
  const prompt = buildRewritePrompt("Some text", "professional");
  assert.ok(prompt.includes("professional tone"));
}

{
  const prompt = buildRewritePrompt("Some text", "unknown-style");
  // Unknown style should not crash, just omit the style guide
  assert.ok(prompt.includes("Some text"));
}

console.log("  buildRewritePrompt tests passed");

// ---------------------------------------------------------------------------
// buildSummaryPrompt
// ---------------------------------------------------------------------------

{
  const prompt = buildSummaryPrompt("Meeting transcript here");
  assert.ok(prompt.includes("meeting assistant"));
  assert.ok(prompt.includes("Meeting transcript here"));
}

{
  const prompt = buildSummaryPrompt("Text", "brief");
  assert.ok(prompt.includes("2-3 sentence"));
}

{
  const prompt = buildSummaryPrompt("Text", "bullets");
  assert.ok(prompt.includes("bullet-point"));
}

{
  const prompt = buildSummaryPrompt("Text", "detailed");
  assert.ok(prompt.includes("detailed paragraph"));
}

console.log("  buildSummaryPrompt tests passed");

// ---------------------------------------------------------------------------
// buildActionExtractionPrompt
// ---------------------------------------------------------------------------

{
  const prompt = buildActionExtractionPrompt("We need to review the PR");
  assert.ok(prompt.includes("action items"));
  assert.ok(prompt.includes("We need to review the PR"));
}

console.log("  buildActionExtractionPrompt tests passed");

// ---------------------------------------------------------------------------
// processAgentTask — local fallback (no API keys)
// ---------------------------------------------------------------------------

{
  const noKeysDeps: AgentHandlerDeps = {
    getEnv: () => undefined,
  };

  // Rewrite with local fallback
  const rewriteTask: AgentTask = {
    taskType: "rewrite",
    text: "um like basically I think we should um do the thing",
    userId: "user-1",
  };

  const rewriteResult = await processAgentTask(rewriteTask, noKeysDeps);
  assert.equal(rewriteResult.success, true);
  assert.equal(rewriteResult.method, "local");
  assert.equal(rewriteResult.taskType, "rewrite");
  // Filler words should be removed
  assert.ok(!rewriteResult.output.includes("um"));
  assert.ok(!rewriteResult.output.includes("basically"));
}

{
  const noKeysDeps: AgentHandlerDeps = {
    getEnv: () => undefined,
  };

  // Summarize with local fallback
  const summarizeTask: AgentTask = {
    taskType: "summarize",
    text: "The team met today. They discussed the new feature. It was decided to launch next week. Everyone agreed on the timeline.",
    userId: "user-1",
  };

  const summarizeResult = await processAgentTask(summarizeTask, noKeysDeps);
  assert.equal(summarizeResult.success, true);
  assert.equal(summarizeResult.method, "local");
  assert.equal(summarizeResult.taskType, "summarize");
  assert.ok(summarizeResult.output.length > 0);
}

{
  const noKeysDeps: AgentHandlerDeps = {
    getEnv: () => undefined,
  };

  // Extract actions with local fallback
  const actionsTask: AgentTask = {
    taskType: "extract-actions",
    text: "We need to update the documentation. John should review the PR. Please schedule a follow-up meeting.",
    userId: "user-1",
  };

  const actionsResult = await processAgentTask(actionsTask, noKeysDeps);
  assert.equal(actionsResult.success, true);
  assert.equal(actionsResult.method, "local");
  assert.equal(actionsResult.taskType, "extract-actions");
  assert.ok(actionsResult.output.includes("- "));
}

{
  const noKeysDeps: AgentHandlerDeps = {
    getEnv: () => undefined,
  };

  // No action items found
  const noActionsTask: AgentTask = {
    taskType: "extract-actions",
    text: "The weather was nice today.",
    userId: "user-1",
  };

  const noActionsResult = await processAgentTask(noActionsTask, noKeysDeps);
  assert.equal(noActionsResult.success, true);
  assert.ok(noActionsResult.output.includes("No action items"));
}

console.log("  processAgentTask local fallback tests passed");

// ---------------------------------------------------------------------------
// processAgentTask — cloud call with mock fetch
// ---------------------------------------------------------------------------

{
  const mockResponse = {
    choices: [
      { message: { content: "Rewritten by LLM: The text is clean now." } },
    ],
  };

  const mockFetch = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    return new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const cloudDeps: AgentHandlerDeps = {
    getEnv: (key: string) =>
      key === "OPENAI_API_KEY" ? "sk-test-key" : undefined,
    fetchFn: mockFetch as typeof globalThis.fetch,
  };

  const task: AgentTask = {
    taskType: "rewrite",
    text: "Test text",
    userId: "user-1",
  };

  const result = await processAgentTask(task, cloudDeps);
  assert.equal(result.success, true);
  assert.equal(result.method, "cloud");
  assert.equal(result.output, "Rewritten by LLM: The text is clean now.");
}

{
  // Cloud failure falls back to local
  const mockFetch = async (): Promise<Response> => {
    return new Response("Internal Server Error", { status: 500 });
  };

  const cloudFailDeps: AgentHandlerDeps = {
    getEnv: (key: string) =>
      key === "OPENAI_API_KEY" ? "sk-test-key" : undefined,
    fetchFn: mockFetch as typeof globalThis.fetch,
  };

  const task: AgentTask = {
    taskType: "rewrite",
    text: "Fallback text to rewrite",
    userId: "user-1",
  };

  const result = await processAgentTask(task, cloudFailDeps);
  assert.equal(result.success, true);
  assert.equal(result.method, "local");
}

{
  // Anthropic provider
  const mockResponse = {
    content: [{ type: "text", text: "Anthropic rewrite result" }],
  };

  const mockFetch = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    return new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const anthropicDeps: AgentHandlerDeps = {
    getEnv: (key: string) =>
      key === "ANTHROPIC_API_KEY" ? "sk-ant-test" : undefined,
    fetchFn: mockFetch as typeof globalThis.fetch,
  };

  const task: AgentTask = {
    taskType: "summarize",
    text: "Long text to summarize",
    userId: "user-1",
  };

  const result = await processAgentTask(task, anthropicDeps);
  assert.equal(result.success, true);
  assert.equal(result.method, "cloud");
  assert.equal(result.output, "Anthropic rewrite result");
}

console.log("  processAgentTask cloud tests passed");

console.log("Agent handler tests passed");
