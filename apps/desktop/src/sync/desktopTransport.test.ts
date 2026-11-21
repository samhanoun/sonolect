import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  SyncError,
  deriveVaultKeys,
  generateRootKey,
} from "@sonolect/sync-core";
import { createMemoryVaultServer } from "@sonolect/sync-core/testing";

import { createDesktopTransport, desktopRequester } from "./desktopTransport";
import type { Invoke } from "./platform";

const keys = deriveVaultKeys(
  generateRootKey((n) => crypto.getRandomValues(new Uint8Array(n))),
);

function recordingInvoke(answer: (args: Record<string, unknown>) => unknown) {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const invoke: Invoke = async <T>(
    command: string,
    args: Record<string, unknown> = {},
  ) => {
    calls.push({ command, args });
    return (await answer(args)) as T;
  };
  return { invoke, calls };
}

describe("the desktop sync transport", () => {
  it("sends the token as its own argument, and none to create the vault", async () => {
    const server = createMemoryVaultServer();
    const { invoke, calls } = recordingInvoke(async (args) => {
      const response = await server.request({
        method: args.method as "GET" | "POST" | "DELETE",
        path: args.path as string,
        headers: args.bearer
          ? { authorization: `Bearer ${args.bearer as string}` }
          : {},
        ...(args.body !== null ? { body: args.body as string } : {}),
      });
      return { status: response.status, body: response.body };
    });
    const transport = createDesktopTransport(invoke, keys, Date.now);
    const { created } = await transport.createVault();
    assert.equal(created, true);
    const page = await transport.changes(0, 200);
    assert.deepEqual(page.records, []);
    await transport.deleteVault();

    assert.deepEqual(
      calls.map(({ args }) => [args.method, args.path, args.bearer]),
      [
        ["POST", "/v1/vaults", null],
        [
          "GET",
          `/v1/vaults/${keys.vaultId}/changes?since=0&limit=200`,
          keys.authToken,
        ],
        ["DELETE", `/v1/vaults/${keys.vaultId}`, keys.authToken],
      ],
    );
    // The vault is created with its verifier only; GET and DELETE carry no body.
    assert.deepEqual(JSON.parse(calls[0]!.args.body as string), {
      vaultId: keys.vaultId,
      authVerifier: keys.authVerifier,
    });
    assert.equal(calls[1]!.args.body, null);
    // The root key, the encryption key and the id key never cross over.
    const sent = JSON.stringify(calls);
    for (const secret of [keys.encKey, keys.idKey])
      assert.ok(!sent.includes(Buffer.from(secret).toString("base64url")));
  });

  it("passes the server's answer on, Retry-After included", async () => {
    const request = desktopRequester(async <T>() => {
      return {
        status: 429,
        body: '{"error":"rate_limited"}',
        retryAfter: "7",
      } as T;
    });
    const response = await request({
      method: "GET",
      path: "/v1/x",
      headers: {},
    });
    assert.deepEqual(response, {
      status: 429,
      body: '{"error":"rate_limited"}',
      retryAfter: "7",
    });
    const transport = createDesktopTransport(
      async <T>() =>
        ({
          status: 429,
          body: '{"error":"rate_limited"}',
          retryAfter: "7",
        }) as T,
      keys,
      () => 0,
    );
    await assert.rejects(
      transport.changes(0, 200),
      (error: unknown) =>
        error instanceof SyncError &&
        error.kind === "rateLimited" &&
        error.retryAfterMs === 7_000,
    );
  });

  it("turns a request without an answer into the engine's errors", async () => {
    const failing = (reason: unknown) =>
      createDesktopTransport(
        async () => {
          throw reason;
        },
        keys,
        () => 0,
      );
    const kind = async (reason: unknown) => {
      try {
        await failing(reason).changes(0, 200);
      } catch (error) {
        return error instanceof SyncError ? error.kind : "not a SyncError";
      }
      return "no error";
    };
    assert.equal(await kind({ kind: "network", message: "x" }), "network");
    assert.equal(await kind({ kind: "tooLarge", message: "x" }), "tooLarge");
    assert.equal(
      await kind({ kind: "responseTooLarge", message: "x" }),
      "server",
    );
    assert.equal(await kind({ kind: "invalid", message: "x" }), "server");
    assert.equal(await kind({ kind: "unavailable", message: "x" }), "server");
    assert.equal(await kind("IPC failed"), "network");
  });
});
