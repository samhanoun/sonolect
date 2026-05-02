import { strict as assert } from "node:assert";
import { createApp } from "./index.js";
import type {
  CommandExecutionResult,
  ListResponse,
  SyncManifest,
  Transcript,
  UsageQuotaSummary,
  User,
} from "@sonolect/types";

const app = await createApp({ logger: false });

try {
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json<{ status: string }>().status, "ok");

  const profile = await app.inject({ method: "GET", url: "/users/profile" });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json<User>().id, "local-user");

  const created = await app.inject({
    method: "POST",
    url: "/transcripts",
    payload: {
      title: "Smoke transcript",
      rawText: "hello world",
      finalText: "Hello world.",
      language: "en",
      mode: "dictate",
      privacyMode: true,
      tags: ["smoke"],
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const transcript = created.json<Transcript>();
  assert.equal(transcript.title, "Smoke transcript");

  const list = await app.inject({
    method: "GET",
    url: "/transcripts?limit=10",
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json<ListResponse<Transcript>>().items.length, 1);

  const fetched = await app.inject({
    method: "GET",
    url: `/transcripts/${transcript.id}`,
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json<Transcript>().id, transcript.id);

  const patched = await app.inject({
    method: "PATCH",
    url: `/transcripts/${transcript.id}`,
    payload: { finalText: "Updated text." },
  });
  assert.equal(patched.statusCode, 200, patched.body);
  assert.equal(patched.json<Transcript>().finalText, "Updated text.");

  const command = await app.inject({
    method: "POST",
    url: "/commands/execute",
    payload: {
      transcriptId: transcript.id,
      command: "copy_to_clipboard",
      dryRun: true,
    },
  });
  assert.equal(command.statusCode, 202, command.body);
  assert.equal(command.json<CommandExecutionResult>().status, "queued");

  const quota = await app.inject({ method: "GET", url: "/usage/quota" });
  assert.equal(quota.statusCode, 200);
  assert.equal(quota.json<UsageQuotaSummary>().transcripts.used, 1);

  const manifest = await app.inject({ method: "GET", url: "/sync/manifest" });
  assert.equal(manifest.statusCode, 200);
  assert.ok(manifest.json<SyncManifest>().items.length >= 2);

  const deleted = await app.inject({
    method: "DELETE",
    url: `/transcripts/${transcript.id}`,
  });
  assert.equal(deleted.statusCode, 204);
} finally {
  await app.close();
}

console.log("API route smoke test passed");
