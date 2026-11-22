import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp, type TranscriptRepository } from "./index.js";
import type { ListResponse, Transcript } from "@sonolect/types";

const list = async (
  app: Awaited<ReturnType<typeof createApp>>,
  query: string,
) => {
  const response = await app.inject({
    method: "GET",
    url: `/transcripts?${query}`,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<ListResponse<Transcript>>();
};

describe("GET /transcripts", () => {
  it("leaves deleted transcripts out for includeDeleted=false", async () => {
    const app = await createApp({ logger: false });
    try {
      const kept = await app.inject({
        method: "POST",
        url: "/transcripts",
        payload: { title: "Kept" },
      });
      const gone = await app.inject({
        method: "POST",
        url: "/transcripts",
        payload: { title: "Gone" },
      });
      await app.inject({
        method: "DELETE",
        url: `/transcripts/${gone.json<Transcript>().id}`,
      });
      const keptId = kept.json<Transcript>().id;
      for (const query of ["includeDeleted=false", "includeDeleted=0", ""])
        assert.deepEqual(
          (await list(app, query)).items.map((item) => item.id),
          [keptId],
          query,
        );
      assert.equal((await list(app, "includeDeleted=true")).items.length, 2);
      for (const word of ["maybe", "yes", "off"]) {
        const invalid = await app.inject({
          method: "GET",
          url: `/transcripts?includeDeleted=${word}`,
        });
        assert.equal(invalid.statusCode, 400, `${word}: ${invalid.body}`);
      }
    } finally {
      await app.close();
    }
  });

  it("continues after the cursor even when that transcript was deleted", async () => {
    const app = await createApp({ logger: false });
    try {
      for (const title of ["One", "Two", "Three", "Four"])
        await app.inject({
          method: "POST",
          url: "/transcripts",
          payload: { title },
        });
      const all = (await list(app, "limit=10")).items.map((item) => item.id);
      assert.equal(all.length, 4);

      const firstPage = await list(app, "limit=2");
      assert.deepEqual(
        firstPage.items.map((item) => item.id),
        all.slice(0, 2),
      );
      assert.equal(firstPage.nextCursor, all[1]);

      // The last item of the page is deleted before the next page is asked for.
      await app.inject({ method: "DELETE", url: `/transcripts/${all[1]}` });
      const secondPage = await list(
        app,
        `limit=2&cursor=${firstPage.nextCursor}`,
      );
      assert.deepEqual(
        secondPage.items.map((item) => item.id),
        all.slice(2, 4),
      );
      assert.equal(secondPage.nextCursor, undefined);

      const unknown = await app.inject({
        method: "GET",
        url: "/transcripts?cursor=not-a-transcript",
      });
      assert.equal(unknown.statusCode, 400, unknown.body);
      assert.equal(unknown.json().error, "invalid_cursor");
    } finally {
      await app.close();
    }
  });

  it("does not accept another user's transcript as a cursor", async () => {
    const app = await createApp({
      logger: false,
      nodeEnv: "test",
      authRequired: true,
      verifyToken: async (token) => ({ uid: token }),
    });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/transcripts",
        headers: { authorization: "Bearer alice" },
        payload: { title: "Alice's" },
      });
      const response = await app.inject({
        method: "GET",
        url: `/transcripts?cursor=${created.json<Transcript>().id}`,
        headers: { authorization: "Bearer bob" },
      });
      assert.equal(response.statusCode, 400, response.body);
    } finally {
      await app.close();
    }
  });
});

describe("server errors", () => {
  it("are logged but never return the error's message", async () => {
    const failing = async () => {
      throw Object.assign(
        new Error("EACCES: permission denied, open '/srv/sonolect/store.json'"),
        { code: "EACCES" },
      );
    };
    const transcriptRepository: TranscriptRepository = {
      listForUser: failing,
      listChangedForUser: failing,
      countActiveForUser: failing,
      getById: failing,
      save: failing,
    };
    const logged: string[] = [];
    const app = await createApp({
      transcriptRepository,
      logger: {
        level: "error",
        stream: { write: (line: string) => logged.push(line) },
      },
    });
    try {
      for (const url of ["/transcripts", "/transcripts/some-id"]) {
        const response = await app.inject({ method: "GET", url });
        assert.equal(response.statusCode, 500, url);
        assert.deepEqual(response.json(), {
          error: "internal_error",
          message: "Internal server error",
        });
      }
      assert.ok(logged.some((line) => line.includes("/srv/sonolect")));
    } finally {
      await app.close();
    }
  });

  it("keep Fastify's answer for client errors", async () => {
    const app = await createApp({ logger: false });
    try {
      const malformed = await app.inject({
        method: "POST",
        url: "/transcripts",
        headers: { "content-type": "application/json" },
        payload: "{not json",
      });
      assert.equal(malformed.statusCode, 400, malformed.body);
      assert.equal(malformed.json().code, "FST_ERR_CTP_INVALID_JSON_BODY");
    } finally {
      await app.close();
    }
  });
});
