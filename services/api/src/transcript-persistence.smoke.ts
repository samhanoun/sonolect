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

  // Saves and reads at the same time must not lose an acknowledged save.
  const concurrentPath = join(tempDir, "concurrent-store.json");
  const concurrentApp = await createApp({
    logger: false,
    storePath: concurrentPath,
  });
  try {
    const responses = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        index % 3 === 2
          ? concurrentApp.inject({
              method: "GET",
              url: "/transcripts?limit=100",
            })
          : concurrentApp.inject({
              method: "POST",
              url: "/transcripts",
              payload: { title: `Concurrent ${index}`, rawText: `${index}` },
            }),
      ),
    );
    const createdIds = responses
      .filter((response) => response.statusCode === 201)
      .map((response) => response.json<Transcript>().id);
    for (const response of responses)
      assert.ok([200, 201].includes(response.statusCode), response.body);
    assert.equal(createdIds.length, 16);
    const stored = JSON.parse(await readFile(concurrentPath, "utf8")) as {
      transcripts: Transcript[];
    };
    assert.deepEqual(
      stored.transcripts.map((item) => item.id).sort(),
      [...createdIds].sort(),
    );
  } finally {
    await concurrentApp.close();
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("API file transcript persistence smoke test passed");
