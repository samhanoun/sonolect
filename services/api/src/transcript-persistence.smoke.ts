import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "./index.js";
import type { ListResponse, Transcript } from "@sonolect/types";

const tempDir = await mkdtemp(join(tmpdir(), "sonolect-api-store-"));
const storePath = join(tempDir, "api-store.json");

try {
  const firstApp = await createApp({ logger: false, storePath });
  let transcriptId: string;

  try {
    const created = await firstApp.inject({
      method: "POST",
      url: "/transcripts",
      payload: {
        title: "Persisted smoke transcript",
        rawText: "persist me",
        finalText: "Persist me.",
        language: "en",
        mode: "dictate",
        privacyMode: true,
        tags: ["persistence"],
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const transcript = created.json<Transcript>();
    transcriptId = transcript.id;
  } finally {
    await firstApp.close();
  }

  const persistedRaw = await readFile(storePath, "utf8");
  assert.match(persistedRaw, /Persisted smoke transcript/);

  const secondApp = await createApp({ logger: false, storePath });
  try {
    const fetched = await secondApp.inject({
      method: "GET",
      url: `/transcripts/${transcriptId}`,
    });
    assert.equal(fetched.statusCode, 200, fetched.body);
    assert.equal(
      fetched.json<Transcript>().title,
      "Persisted smoke transcript",
    );

    const list = await secondApp.inject({
      method: "GET",
      url: "/transcripts?limit=10",
    });
    assert.equal(list.statusCode, 200, list.body);
    assert.deepEqual(
      list.json<ListResponse<Transcript>>().items.map((item) => item.id),
      [transcriptId],
    );
  } finally {
    await secondApp.close();
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("API file transcript persistence smoke test passed");
