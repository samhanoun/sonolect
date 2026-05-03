import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Transcript } from "@sonolect/types";
import {
  fetchTranscriptDetail,
  fetchTranscriptHistory,
  formatTranscriptDuration,
  normalizeTranscriptRecord,
} from "./transcriptHistory";

const baseTranscript = {
  id: "tr-1",
  userId: "local-user",
  title: "Daily standup",
  rawText: "Raw notes from the call",
  finalText: "Final notes from the call",
  language: "en",
  mode: "summarize",
  privacyMode: false,
  status: "completed",
  tags: ["audio"],
  durationMs: 125_000,
  createdAt: "2026-05-02T09:42:00.000Z",
  updatedAt: "2026-05-02T09:45:00.000Z",
} satisfies Transcript;

describe("transcript history helpers", () => {
  it("normalizes API transcripts into desktop history rows", () => {
    const row = normalizeTranscriptRecord(baseTranscript);

    assert.deepEqual(row, {
      id: "tr-1",
      title: "Daily standup",
      preview: "Final notes from the call",
      transcript: "Final notes from the call",
      timestamp: "2 mai 2026, 09:42",
      duration: "2m 05s",
      mode: "summarize",
      status: "completed",
      metadata: "completed · en · audio",
      updatedAt: "2026-05-02T09:45:00.000Z",
    });
  });

  it("falls back to raw text, generated titles, and missing duration metadata", () => {
    const processingTranscript: Transcript = {
      ...baseTranscript,
      id: "tr-2",
      rawText:
        "A very long raw transcript that should be used as the preview and title when the API did not provide one.",
      tags: [],
      status: "processing",
    };
    delete processingTranscript.title;
    delete processingTranscript.finalText;
    delete processingTranscript.durationMs;

    const row = normalizeTranscriptRecord(processingTranscript);

    assert.equal(
      row.title,
      "A very long raw transcript that should be used as…",
    );
    assert.equal(
      row.preview,
      "A very long raw transcript that should be used as the preview and title when the API did not provide one.",
    );
    assert.equal(row.duration, "Durée inconnue");
    assert.equal(row.metadata, "processing · en");
  });

  it("formats transcript durations", () => {
    assert.equal(formatTranscriptDuration(0), "0s");
    assert.equal(formatTranscriptDuration(59_500), "60s");
    assert.equal(formatTranscriptDuration(61_000), "1m 01s");
  });
});

describe("transcript history API client", () => {
  it("keeps offline fallback when no API URL is configured", async () => {
    const history = await fetchTranscriptHistory({
      apiUrl: "",
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      },
    });

    assert.equal(history.source, "offline");
    assert.equal(history.items.length, 3);
  });

  it("fetches and normalizes transcript list from the local API", async () => {
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const history = await fetchTranscriptHistory({
      apiUrl: "http://localhost:8787",
      token: "secret",
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), init });
        return new Response(
          JSON.stringify({ items: [baseTranscript], nextCursor: "next" }),
          { status: 200 },
        );
      },
    });

    assert.equal(seen[0]?.url, "http://localhost:8787/transcripts?limit=20");
    assert.equal(
      (seen[0]?.init?.headers as Record<string, string>).authorization,
      "Bearer secret",
    );
    assert.equal(history.source, "api");
    assert.equal(history.nextCursor, "next");
    assert.equal(history.items[0]?.id, "tr-1");
  });

  it("fetches transcript detail by id", async () => {
    const detail = await fetchTranscriptDetail("tr-1", {
      apiUrl: "http://localhost:8787/",
      fetchImpl: async (url) => {
        assert.equal(String(url), "http://localhost:8787/transcripts/tr-1");
        return new Response(JSON.stringify(baseTranscript), { status: 200 });
      },
    });

    assert.equal(detail?.id, "tr-1");
    assert.equal(detail?.transcript, "Final notes from the call");
  });
});
