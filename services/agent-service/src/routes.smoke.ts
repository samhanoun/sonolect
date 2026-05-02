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
} finally {
  await app.close();
}

console.log("Agent service smoke test passed");
