import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TranscriptTurn } from "./domain";
import {
  fetchLocalTranscriptHistory,
  isLocalApiConfigured,
  mergeTranscriptHistory,
  resolveMobileLocalApiConfig,
  syncQueuedTranscriptTurns,
} from "./localApi";

const baseTurn: TranscriptTurn = {
  id: "local-1",
  rawText: "notes brutes",
  refinedText: "notes propres",
  mode: "dictate",
  language: "fr-FR",
  privacyMode: false,
  createdAt: "2026-05-05T07:00:00.000Z",
  durationMs: 1234,
  source: "microphone",
  syncState: "queued",
};

describe("mobile local API client", () => {
  it("stays unconfigured without a local API URL", () => {
    assert.equal(isLocalApiConfigured({}), false);
    assert.equal(isLocalApiConfigured({ apiUrl: "   " }), false);
  });

  it("fetches transcript history from the configured local API", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push(String(url));
      assert.deepEqual(init?.headers, { accept: "application/json" });
      return Response.json({
        items: [
          {
            id: "api-1",
            rawText: "raw api",
            finalText: "final api",
            language: "en-US",
            mode: "summarize",
            privacyMode: true,
            createdAt: "2026-05-04T12:00:00.000Z",
            updatedAt: "2026-05-04T12:01:00.000Z",
            durationMs: 4500,
            tags: ["mobile"],
            status: "completed",
          },
        ],
      });
    };

    const turns = await fetchLocalTranscriptHistory({
      apiUrl: "http://localhost:8787",
      fetchImpl,
      limit: 10,
    });

    assert.deepEqual(seen, ["http://localhost:8787/transcripts?limit=10"]);
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.id, "api-1");
    assert.equal(turns[0]?.refinedText, "final api");
    assert.equal(turns[0]?.syncState, "synced");
  });

  it("posts queued local turns and marks successful uploads as synced", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ id: "api-created-1" }, { status: 201 });
    };

    const result = await syncQueuedTranscriptTurns([baseTurn], {
      apiUrl: "http://localhost:8787/",
      fetchImpl,
    });

    assert.equal(result[0]?.syncState, "synced");
    assert.equal(result[0]?.id, "api-created-1");
    assert.equal(requests[0]?.url, "http://localhost:8787/transcripts");
    assert.equal(requests[0]?.init?.method, "POST");
    assert.deepEqual(requests[0]?.init?.headers, {
      accept: "application/json",
      "content-type": "application/json",
    });
    assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
      title: "notes propres",
      rawText: "notes brutes",
      finalText: "notes propres",
      language: "fr-FR",
      mode: "dictate",
      privacyMode: false,
      durationMs: 1234,
      tags: ["mobile", "microphone"],
      status: "completed",
    });
  });

  it("keeps queued turns queued when the configured API rejects sync", async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ error: "offline" }, { status: 503 });

    const result = await syncQueuedTranscriptTurns([baseTurn], {
      apiUrl: "http://localhost:8787",
      fetchImpl,
    });

    assert.equal(result[0]?.syncState, "queued");
  });

  it("deduplicates uploaded turns after pulling server history by using the server id", async () => {
    const synced = await syncQueuedTranscriptTurns([baseTurn], {
      apiUrl: "http://localhost:8787",
      fetchImpl: async () =>
        Response.json({ id: "api-created-1" }, { status: 201 }),
    });
    const remote = [
      { ...baseTurn, id: "api-created-1", syncState: "synced" as const },
    ];

    const merged = mergeTranscriptHistory(synced, remote);

    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.id, "api-created-1");
    assert.equal(merged[0]?.syncState, "synced");
  });

  it("does not configure local API sync when history is disabled or ephemeral", () => {
    const baseSettings = {
      cloudSyncEnabled: true,
      localApiUrl: "http://localhost:8787",
      privacyLevel: "local_first" as const,
      saveHistory: true,
    };

    assert.deepEqual(resolveMobileLocalApiConfig(baseSettings), {
      apiUrl: "http://localhost:8787",
    });
    assert.deepEqual(
      resolveMobileLocalApiConfig({ ...baseSettings, saveHistory: false }),
      {},
    );
    assert.deepEqual(
      resolveMobileLocalApiConfig({
        ...baseSettings,
        privacyLevel: "ephemeral",
      }),
      {},
    );
  });
});
