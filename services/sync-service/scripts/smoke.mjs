#!/usr/bin/env node
// Starts the built service (dist/index.js) and does one vault round trip over
// HTTP: create, write, read, delete. CI runs it on Firestore inside the
// emulator; it works on any store:
//
//   SONOLECT_SYNC_STORE=firestore node scripts/smoke.mjs
//   SONOLECT_SYNC_STORE=sqlite:/tmp/sonolect-sync.db node scripts/smoke.mjs
//
// The service runs with NODE_ENV=production and a random service token, as
// in a deployment. PORT picks the port (default 8712).
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serviceDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 8712);
const base = `http://127.0.0.1:${port}`;
const b64 = (bytes) => Buffer.from(bytes).toString("base64url");

if (!process.env.SONOLECT_SYNC_STORE) {
  console.error("smoke: set SONOLECT_SYNC_STORE (firestore or sqlite:<path>)");
  process.exit(2);
}

const server = spawn(process.execPath, ["dist/index.js"], {
  cwd: serviceDir,
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    SONOLECT_SERVICE_TOKENS: b64(randomBytes(32)),
  },
  stdio: ["ignore", "inherit", "inherit"],
});
const exited = new Promise((resolve) => server.once("exit", resolve));

const check = (condition, message) => {
  if (!condition) throw new Error(`smoke: ${message}`);
};

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    if (server.exitCode !== null) throw new Error("smoke: the service exited");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("smoke: the service did not answer /health");
}

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined };
}

try {
  await waitForHealth();
  const token = randomBytes(32);
  const vaultId = b64(randomBytes(16));
  const authToken = b64(token);
  const authVerifier = b64(createHash("sha256").update(token).digest());
  const rid = b64(randomBytes(18));
  const ct = b64(randomBytes(512));

  const created = await call("POST", "/v1/vaults", {
    body: { vaultId, authVerifier },
  });
  check(created.status === 201, `create answered ${created.status}`);
  const written = await call("POST", `/v1/vaults/${vaultId}/records`, {
    token: authToken,
    body: { writes: [{ rid, baseRev: 0, deleted: false, ct }] },
  });
  check(written.status === 200, `write answered ${written.status}`);
  check(written.json.results[0].status === "ok", "the write was not accepted");
  const page = await call(
    "GET",
    `/v1/vaults/${vaultId}/changes?since=0&limit=200`,
    {
      token: authToken,
    },
  );
  check(page.status === 200, `changes answered ${page.status}`);
  check(page.json.records.length === 1, "changes did not return the record");
  check(page.json.records[0].ct === ct, "the record came back changed");
  check(
    page.json.head === 1 && page.json.epoch === created.json.epoch,
    "head or epoch is wrong",
  );
  const deleted = await call("DELETE", `/v1/vaults/${vaultId}`, {
    token: authToken,
  });
  check(deleted.status === 204, `delete answered ${deleted.status}`);
  const gone = await call("GET", `/v1/vaults/${vaultId}/changes?since=0`, {
    token: authToken,
  });
  check(
    gone.status === 410 && gone.json.error === "vault_deleted",
    "the deleted vault still answers",
  );
  console.log(
    `smoke: create, write, read and delete passed on ${process.env.SONOLECT_SYNC_STORE}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await exited;
}
