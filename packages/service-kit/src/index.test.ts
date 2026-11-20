import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import {
  BoundedMap,
  ServiceHttpError,
  getServiceUserId,
  parseServiceTokens,
  registerServiceSecurity,
  resolveListenOptions,
  resolveRequestUserId,
  type ServiceEnv,
} from "./index.js";

const token = "a".repeat(40);
const otherToken = "b".repeat(40);

const buildApp = (
  env: ServiceEnv,
  publicRoutes: string[] = [],
): FastifyInstance => {
  const app = Fastify({ logger: false });
  registerServiceSecurity(app, {
    serviceName: "test-service",
    env,
    publicRoutes,
  });
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/whoami", async (request) => ({
    userId: getServiceUserId(request),
  }));
  app.post<{ Body: { userId?: string } }>("/claim", async (request) => ({
    userId: resolveRequestUserId(request, request.body?.userId),
  }));
  app.post("/public-hook", async () => ({ received: true }));
  app.get("/boom", async () => {
    throw new Error("database password is hunter2");
  });
  app.get("/upstream", async () => {
    throw new ServiceHttpError(502, "upstream_error", "Provider failed");
  });
  return app;
};

describe("registerServiceSecurity", () => {
  it("refuses to start in production without service tokens", () => {
    assert.throws(
      () => buildApp({ NODE_ENV: "production" }),
      /SONOLECT_SERVICE_TOKENS must be set in production/,
    );
  });

  it("refuses short tokens in production", () => {
    assert.throws(
      () =>
        buildApp({ NODE_ENV: "production", SONOLECT_SERVICE_TOKENS: "short" }),
      /at least 32 characters/,
    );
  });

  it("stays open for local development when no token is configured", async () => {
    const app = buildApp({ NODE_ENV: "development" });
    const res = await app.inject({ method: "GET", url: "/whoami" });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json<{ userId: string }>().userId, "local-user");
    await app.close();
  });

  it("requires a valid bearer token once tokens are configured", async () => {
    const app = buildApp({
      NODE_ENV: "production",
      SONOLECT_SERVICE_TOKENS: `${token}, ${otherToken}`,
    });
    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);

    const missing = await app.inject({ method: "GET", url: "/whoami" });
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.json<{ error: string }>().error, "unauthorized");

    const wrong = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { authorization: `Bearer ${"c".repeat(40)}`, "x-user-id": "u1" },
    });
    assert.equal(wrong.statusCode, 401);

    for (const valid of [token, otherToken]) {
      const ok = await app.inject({
        method: "GET",
        url: "/whoami",
        headers: { authorization: `Bearer ${valid}`, "x-user-id": "user-1" },
      });
      assert.equal(ok.statusCode, 200, ok.body);
      assert.equal(ok.json<{ userId: string }>().userId, "user-1");
    }

    const unknown = await app.inject({ method: "GET", url: "/nope" });
    assert.equal(unknown.statusCode, 401);
    await app.close();
  });

  it("reads the bearer scheme leniently and the token strictly", async () => {
    const app = buildApp({
      NODE_ENV: "production",
      SONOLECT_SERVICE_TOKENS: token,
    });
    const call = (authorization: string) =>
      app.inject({
        method: "GET",
        url: "/whoami",
        headers: { authorization, "x-user-id": "user-1" },
      });

    for (const accepted of [
      `bearer ${token}`,
      `BEARER   ${token}`,
      `Bearer\t${token}`,
      `  Bearer ${token}  `,
    ]) {
      assert.equal((await call(accepted)).statusCode, 200, accepted);
    }
    for (const rejected of [
      token,
      `Bearer${token}`,
      `Basic ${token}`,
      "Bearer",
      "Bearer    ",
      `Bearer ${token} extra`,
      `Token Bearer ${token}`,
    ]) {
      assert.equal((await call(rejected)).statusCode, 401, rejected);
    }

    // A header built to stall a backtracking parser is rejected at once.
    const started = performance.now();
    const hostile = await call(`Bearer\t${"\t\t".repeat(50_000)}`);
    assert.equal(hostile.statusCode, 401);
    assert.ok(performance.now() - started < 1_000);
    await app.close();
  });

  it("requires and validates x-user-id when tokens are enforced", async () => {
    const app = buildApp({ SONOLECT_SERVICE_TOKENS: token });
    const headers = { authorization: `Bearer ${token}` };

    const missing = await app.inject({
      method: "GET",
      url: "/whoami",
      headers,
    });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json<{ error: string }>().error, "user_id_required");

    const malformed = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { ...headers, "x-user-id": "../../etc/passwd" },
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.json<{ error: string }>().error, "invalid_user_id");
    await app.close();
  });

  it("rejects a body userId that differs from the authenticated user", async () => {
    const app = buildApp({ SONOLECT_SERVICE_TOKENS: token });
    const headers = { authorization: `Bearer ${token}`, "x-user-id": "alice" };

    const own = await app.inject({
      method: "POST",
      url: "/claim",
      headers,
      payload: { userId: "alice" },
    });
    assert.equal(own.statusCode, 200, own.body);

    const other = await app.inject({
      method: "POST",
      url: "/claim",
      headers,
      payload: { userId: "bob" },
    });
    assert.equal(other.statusCode, 403);
    assert.equal(other.json<{ error: string }>().error, "user_mismatch");
    await app.close();
  });

  it("lets declared public routes through without a token", async () => {
    const app = buildApp({ SONOLECT_SERVICE_TOKENS: token }, [
      "POST /public-hook",
    ]);
    const res = await app.inject({ method: "POST", url: "/public-hook" });
    assert.equal(res.statusCode, 200, res.body);
    await app.close();
  });

  it("hides internal error details and keeps deliberate ones", async () => {
    const app = buildApp({});
    const boom = await app.inject({ method: "GET", url: "/boom" });
    assert.equal(boom.statusCode, 500);
    assert.ok(!boom.body.includes("hunter2"));
    assert.equal(boom.json<{ error: string }>().error, "internal_error");

    const upstream = await app.inject({ method: "GET", url: "/upstream" });
    assert.equal(upstream.statusCode, 502);
    assert.deepEqual(upstream.json(), {
      error: "upstream_error",
      message: "Provider failed",
    });

    const badJson = await app.inject({
      method: "POST",
      url: "/claim",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    assert.equal(badJson.statusCode, 400);
    await app.close();
  });
});

describe("helpers", () => {
  it("parses comma-separated tokens", () => {
    assert.deepEqual(parseServiceTokens(" a , ,b "), ["a", "b"]);
    assert.deepEqual(parseServiceTokens(undefined), []);
  });

  it("binds to loopback outside production", () => {
    assert.deepEqual(resolveListenOptions({}), {
      host: "127.0.0.1",
      port: 8080,
    });
    assert.deepEqual(
      resolveListenOptions({ NODE_ENV: "production", PORT: "9000" }),
      {
        host: "0.0.0.0",
        port: 9000,
      },
    );
    assert.deepEqual(resolveListenOptions({ HOST: "0.0.0.0" }).host, "0.0.0.0");
    assert.throws(() => resolveListenOptions({ PORT: "abc" }), /Invalid PORT/);
  });

  it("evicts the oldest entry at capacity", () => {
    const map = new BoundedMap<string, number>(2, [["a", 1]]);
    map.set("b", 2);
    map.set("a", 10);
    assert.equal(map.size, 2);
    map.set("c", 3);
    assert.deepEqual([...map.keys()], ["b", "c"]);
  });
});
