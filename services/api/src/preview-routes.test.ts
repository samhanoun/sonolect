import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InjectOptions } from "fastify";
import {
  createApp,
  directRunNodeEnv,
  PREVIEW_ROUTES,
  type CreateAppOptions,
} from "./index.js";

const audioDir = await mkdtemp(join(tmpdir(), "sonolect-preview-routes-"));
after(() => rm(audioDir, { recursive: true, force: true }));

const auth = { authorization: "Bearer alice" };

const productionApp = (options: CreateAppOptions = {}) =>
  createApp({
    nodeEnv: "production",
    verifyToken: async (token) => ({ uid: token }),
    audioDir,
    logger: false,
    aiProviders: {
      configured: () => true,
      transcribe: async () => ({ transcript: "hello", language: "en-US" }),
      polish: async (opts) => ({ polished: opts.transcript, model: "test" }),
    },
    ...options,
  });

const splitRoute = (route: string) => {
  const [method, url] = route.split(" ") as [
    "GET" | "POST" | "PATCH" | "DELETE",
    string,
  ];
  return { method, url };
};

/** A request for each preview route, with an id filled in where needed. */
const requestFor = (route: string): InjectOptions => {
  const { method, url } = splitRoute(route);
  const concrete = url.replace(":id", "some-id");
  if (route === "POST /audio/jobs/:id/audio")
    return {
      method,
      url: concrete,
      headers: { ...auth, "content-type": "audio/webm" },
      payload: Buffer.from([1, 2, 3]),
    };
  return method === "POST" || method === "PATCH"
    ? { method, url: concrete, headers: auth, payload: {} }
    : { method, url: concrete, headers: auth };
};

const captureLogs = () => {
  const lines: { level: number; msg: string; routes?: string[] }[] = [];
  return {
    lines,
    logger: {
      level: "info",
      stream: { write: (line: string) => lines.push(JSON.parse(line)) },
    },
  };
};

describe("preview routes in production", () => {
  it("are not registered without the opt-in and answer 404", async () => {
    const app = await productionApp();
    try {
      for (const route of PREVIEW_ROUTES) {
        assert.equal(app.hasRoute(splitRoute(route)), false, route);
        const response = await app.inject(requestFor(route));
        assert.equal(response.statusCode, 404, `${route}: ${response.body}`);
        // Without a token the caller learns nothing: 401, like every route but /health.
        const anonymous = await app.inject({
          ...requestFor(route),
          headers: {},
        });
        assert.equal(anonymous.statusCode, 401, route);
      }
    } finally {
      await app.close();
    }
  });

  it("keep /health, /v1/polish and /v1/transcribe", async () => {
    const app = await productionApp();
    try {
      const health = await app.inject({ method: "GET", url: "/health" });
      assert.equal(health.statusCode, 200);

      const polish = await app.inject({
        method: "POST",
        url: "/v1/polish",
        headers: auth,
        payload: { transcript: "hello there" },
      });
      assert.equal(polish.statusCode, 200, polish.body);
      assert.equal(polish.json().polished, "hello there");

      const transcribe = await app.inject({
        method: "POST",
        url: "/v1/transcribe",
        headers: { ...auth, "content-type": "audio/webm" },
        payload: Buffer.from([1, 2, 3]),
      });
      assert.equal(transcribe.statusCode, 200, transcribe.body);
      assert.equal(transcribe.json().transcript, "hello");

      const anonymous = await app.inject({
        method: "POST",
        url: "/v1/polish",
        payload: { transcript: "hello" },
      });
      assert.equal(anonymous.statusCode, 401);
    } finally {
      await app.close();
    }
  });

  it("behave as today with previewRoutes: true", async () => {
    const app = await productionApp({ previewRoutes: true });
    try {
      for (const route of PREVIEW_ROUTES)
        assert.equal(app.hasRoute(splitRoute(route)), true, route);

      const profile = await app.inject({
        method: "GET",
        url: "/users/profile",
        headers: auth,
      });
      assert.equal(profile.statusCode, 200, profile.body);
      assert.equal(profile.json().id, "alice");

      const created = await app.inject({
        method: "POST",
        url: "/transcripts",
        headers: auth,
        payload: { language: "en", mode: "dictate", rawText: "Hello." },
      });
      assert.equal(created.statusCode, 201, created.body);

      const list = await app.inject({
        method: "GET",
        url: "/transcripts",
        headers: auth,
      });
      assert.equal(list.json().items.length, 1);

      const job = await app.inject({
        method: "POST",
        url: "/audio/jobs",
        headers: auth,
        payload: {
          mimeType: "audio/webm",
          sizeBytes: 3,
          durationMs: 1000,
          source: "desktop",
        },
      });
      assert.equal(job.statusCode, 201, job.body);

      const command = await app.inject({
        method: "POST",
        url: "/commands/execute",
        headers: auth,
        payload: { command: "copy_to_clipboard", dryRun: true },
      });
      assert.equal(command.statusCode, 202, command.body);

      for (const url of ["/usage/quota", "/sync/manifest"]) {
        const response = await app.inject({
          method: "GET",
          url,
          headers: auth,
        });
        assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
      }
    } finally {
      await app.close();
    }
  });

  it("are on with SONOLECT_API_PREVIEW_ROUTES=1 and off for other values", async () => {
    const previous = process.env.SONOLECT_API_PREVIEW_ROUTES;
    try {
      for (const [value, on] of [
        ["1", true],
        ["true", true],
        ["0", false],
        ["yes", false],
        ["", false],
      ] as const) {
        process.env.SONOLECT_API_PREVIEW_ROUTES = value;
        const app = await productionApp();
        try {
          assert.equal(
            app.hasRoute({ method: "POST", url: "/transcripts" }),
            on,
            `SONOLECT_API_PREVIEW_ROUTES=${value}`,
          );
        } finally {
          await app.close();
        }
      }
    } finally {
      if (previous === undefined)
        delete process.env.SONOLECT_API_PREVIEW_ROUTES;
      else process.env.SONOLECT_API_PREVIEW_ROUTES = previous;
    }
  });

  it("logs once at start which routes are off, or that they are on", async () => {
    const off = captureLogs();
    const offApp = await productionApp({ logger: off.logger });
    await offApp.close();
    const offLines = off.lines.filter((line) => line.routes);
    assert.equal(offLines.length, 1);
    assert.deepEqual(offLines[0]?.routes, [...PREVIEW_ROUTES]);
    assert.match(offLines[0]!.msg, /off in production/);

    const on = captureLogs();
    const onApp = await productionApp({
      logger: on.logger,
      previewRoutes: true,
    });
    await onApp.close();
    const onLines = on.lines.filter((line) => line.routes);
    assert.equal(onLines.length, 1);
    assert.equal(onLines[0]?.level, 40);
    assert.match(onLines[0]!.msg, /SONOLECT_API_PREVIEW_ROUTES is on/);
  });
});

describe("preview routes outside production", () => {
  it("are always registered and log nothing about it", async () => {
    for (const nodeEnv of ["development", "test"]) {
      const logs = captureLogs();
      const app = await createApp({ nodeEnv, audioDir, logger: logs.logger });
      try {
        for (const route of PREVIEW_ROUTES)
          assert.equal(app.hasRoute(splitRoute(route)), true, route);
        assert.equal(logs.lines.filter((line) => line.routes).length, 0);
      } finally {
        await app.close();
      }
    }
  });
});

describe("direct run", () => {
  it("treats an unset or empty NODE_ENV as production", () => {
    assert.equal(directRunNodeEnv({}), "production");
    assert.equal(directRunNodeEnv({ NODE_ENV: "" }), "production");
    assert.equal(directRunNodeEnv({ NODE_ENV: "  " }), "production");
    assert.equal(directRunNodeEnv({ NODE_ENV: "production" }), "production");
    assert.equal(directRunNodeEnv({ NODE_ENV: "development" }), "development");
    assert.equal(directRunNodeEnv({ NODE_ENV: "test" }), "test");
  });

  it("treats every value but development and test as production", () => {
    for (const value of [
      "Production",
      "PRODUCTION",
      " production ",
      "prod",
      "staging",
      "dev",
    ])
      assert.equal(directRunNodeEnv({ NODE_ENV: value }), "production", value);
  });

  it("reads development and test in any case", () => {
    assert.equal(directRunNodeEnv({ NODE_ENV: "Development" }), "development");
    assert.equal(
      directRunNodeEnv({ NODE_ENV: " DEVELOPMENT " }),
      "development",
    );
    assert.equal(directRunNodeEnv({ NODE_ENV: "Test" }), "test");
  });
});
