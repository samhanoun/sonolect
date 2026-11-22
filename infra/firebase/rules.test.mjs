#!/usr/bin/env node
// Checks firestore.rules and storage.rules on the Firebase emulators, with
// Node built-ins only (no Firebase SDK). CI runs it inside
//
//   npx firebase-tools emulators:exec --only firestore,storage \
//     --project demo-sonolect "node --test infra/firebase/rules.test.mjs"
//
// from the repository root, so the emulators load the rules from firebase.json.
// Requests carry unsigned ID tokens, which only the emulators accept; "owner"
// is the emulators' admin token, used to seed data past the rules.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

const project = process.env.GCLOUD_PROJECT ?? "demo-sonolect";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST?.replace(
  /^https?:\/\//,
  "",
);
if (!firestoreHost || !storageHost) {
  console.error(
    "rules.test: run inside emulators:exec --only firestore,storage",
  );
  process.exit(2);
}

const root = `projects/${project}/databases/(default)/documents`;
const firestore = `http://${firestoreHost}/v1/${root}`;
const bucket = `${project}.appspot.com`;
const storage = `http://${storageHost}/v0/b/${bucket}/o`;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** An unsigned Firebase ID token for `uid`, as the emulators accept. */
function token(uid) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    iss: `https://securetoken.google.com/${project}`,
    aud: project,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    sub: uid,
    user_id: uid,
    firebase: { sign_in_provider: "custom", identities: {} },
  })}.`;
}

const auth = (uid) =>
  uid
    ? { authorization: `Bearer ${uid === "owner" ? "owner" : token(uid)}` }
    : {};

function fields(data) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      { stringValue: String(value) },
    ]),
  );
}

/**
 * Commits writes in one batch as `uid` and returns the HTTP status. Each write
 * is { create | update | remove: path, data? }.
 */
async function commit(uid, writes) {
  const response = await fetch(`${firestore}:commit`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(uid) },
    body: JSON.stringify({
      writes: writes.map((write) => {
        const path = write.create ?? write.update ?? write.remove;
        const name = `${root}/${path}`;
        if (write.remove) return { delete: name };
        return {
          update: { name, fields: fields(write.data) },
          currentDocument: { exists: Boolean(write.update) },
        };
      }),
    }),
  });
  await response.arrayBuffer();
  return response.status;
}

async function read(uid, path) {
  const response = await fetch(`${firestore}/${path}`, { headers: auth(uid) });
  await response.arrayBuffer();
  return response.status;
}

const allowed = (status) => status === 200;
const denied = (status) => status === 403;

async function seed(writes) {
  assert.equal(await commit("owner", writes), 200, "seeding past the rules");
}

/** A tenant owned by alice, with bob as admin and carol as member. */
async function seedTenant() {
  await seed([
    { create: "tenants/t1", data: { ownerId: "alice" } },
    { create: "tenants/t1/members/alice", data: { role: "owner" } },
    { create: "tenants/t1/members/bob", data: { role: "admin" } },
    { create: "tenants/t1/members/carol", data: { role: "member" } },
  ]);
}

beforeEach(async () => {
  const cleared = await Promise.all([
    fetch(`http://${firestoreHost}/emulator/v1/${root}`, { method: "DELETE" }),
    fetch(`http://${storageHost}/internal/reset`, { method: "POST" }),
  ]);
  for (const response of cleared) {
    await response.arrayBuffer();
    assert.ok(response.ok, `reset failed: ${response.status}`);
  }
});

describe("firestore.rules", () => {
  it("lets each user use their own documents only", async () => {
    assert.ok(
      allowed(
        await commit("alice", [{ create: "users/alice", data: { name: "A" } }]),
      ),
    );
    assert.ok(allowed(await read("alice", "users/alice")));
    assert.ok(denied(await read("bob", "users/alice")));
    assert.ok(denied(await read(null, "users/alice")));
  });

  it("lets a new tenant's creator add themself as its owner in the same batch", async () => {
    const created = await commit("alice", [
      { create: "tenants/t2", data: { ownerId: "alice" } },
      { create: "tenants/t2/members/alice", data: { role: "owner" } },
    ]);
    assert.ok(allowed(created), `status ${created}`);
    assert.ok(allowed(await read("alice", "tenants/t2")));
  });

  it("lets the creator add themself right after creating the tenant", async () => {
    assert.ok(
      allowed(
        await commit("alice", [
          { create: "tenants/t2", data: { ownerId: "alice" } },
        ]),
      ),
    );
    assert.ok(
      allowed(
        await commit("alice", [
          { create: "tenants/t2/members/alice", data: { role: "owner" } },
        ]),
      ),
    );
  });

  it("refuses a tenant made in someone else's name, and owning someone else's tenant", async () => {
    assert.ok(
      denied(
        await commit("mallory", [
          { create: "tenants/t2", data: { ownerId: "alice" } },
        ]),
      ),
    );
    await seedTenant();
    assert.ok(
      denied(
        await commit("mallory", [
          { create: "tenants/t1/members/mallory", data: { role: "owner" } },
        ]),
      ),
    );
    // A member cannot promote themself.
    assert.ok(
      denied(
        await commit("carol", [
          { update: "tenants/t1/members/carol", data: { role: "owner" } },
        ]),
      ),
    );
  });

  it("gives members their tenant's data and outsiders nothing", async () => {
    await seedTenant();
    await seed([{ create: "tenants/t1/projects/p1", data: { name: "P" } }]);
    for (const uid of ["alice", "bob", "carol"]) {
      assert.ok(allowed(await read(uid, "tenants/t1")), uid);
      assert.ok(allowed(await read(uid, "tenants/t1/projects/p1")), uid);
    }
    assert.ok(denied(await read("mallory", "tenants/t1")));
    assert.ok(denied(await read("mallory", "tenants/t1/projects/p1")));
    assert.ok(denied(await read(null, "tenants/t1")));
  });

  it("lets admins manage members but not owners", async () => {
    await seedTenant();
    assert.ok(
      allowed(
        await commit("bob", [
          { create: "tenants/t1/members/dan", data: { role: "member" } },
        ]),
      ),
    );
    assert.ok(
      denied(
        await commit("bob", [
          { create: "tenants/t1/members/eve", data: { role: "owner" } },
        ]),
      ),
    );
    assert.ok(
      denied(
        await commit("bob", [
          { update: "tenants/t1/members/bob", data: { role: "owner" } },
        ]),
      ),
    );
    assert.ok(
      denied(
        await commit("bob", [
          { update: "tenants/t1/members/alice", data: { role: "member" } },
        ]),
      ),
    );
    assert.ok(
      denied(await commit("bob", [{ remove: "tenants/t1/members/alice" }])),
    );
    assert.ok(
      allowed(await commit("bob", [{ remove: "tenants/t1/members/dan" }])),
    );
    assert.ok(
      denied(
        await commit("carol", [
          { create: "tenants/t1/members/dan", data: { role: "member" } },
        ]),
      ),
    );
    // The owner can hand out the owner role.
    assert.ok(
      allowed(
        await commit("alice", [
          { update: "tenants/t1/members/bob", data: { role: "owner" } },
        ]),
      ),
    );
  });

  it("keeps the tenant's owner and its deletion with the owner", async () => {
    await seedTenant();
    assert.ok(
      denied(
        await commit("bob", [
          { update: "tenants/t1", data: { ownerId: "bob" } },
        ]),
      ),
    );
    assert.ok(
      allowed(
        await commit("bob", [
          { update: "tenants/t1", data: { ownerId: "alice", name: "T" } },
        ]),
      ),
    );
    assert.ok(denied(await commit("bob", [{ remove: "tenants/t1" }])));
    assert.ok(allowed(await commit("alice", [{ remove: "tenants/t1" }])));
  });

  it("shows billing to admins only and lets no client write it", async () => {
    await seedTenant();
    await seed([{ create: "tenants/t1/billing/plan", data: { tier: "pro" } }]);
    assert.ok(allowed(await read("bob", "tenants/t1/billing/plan")));
    assert.ok(denied(await read("carol", "tenants/t1/billing/plan")));
    assert.ok(
      denied(
        await commit("alice", [
          { update: "tenants/t1/billing/plan", data: { tier: "free" } },
        ]),
      ),
    );
  });

  it("denies everything outside the listed paths", async () => {
    assert.ok(
      denied(await commit("alice", [{ create: "other/x", data: { a: 1 } }])),
    );
  });
});

async function upload(uid, path, bytes = 16) {
  const response = await fetch(`${storage}?name=${encodeURIComponent(path)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", ...auth(uid) },
    body: new Uint8Array(bytes),
  });
  await response.arrayBuffer();
  return response.status;
}

async function download(uid, path) {
  const response = await fetch(
    `${storage}/${encodeURIComponent(path)}?alt=media`,
    {
      headers: auth(uid),
    },
  );
  await response.arrayBuffer();
  return response.status;
}

async function remove(uid, path) {
  const response = await fetch(`${storage}/${encodeURIComponent(path)}`, {
    method: "DELETE",
    headers: auth(uid),
  });
  await response.arrayBuffer();
  return response.status;
}

const storageAllowed = (status) => status >= 200 && status < 300;

describe("storage.rules", () => {
  it("lets a user upload, read and delete their own files", async () => {
    assert.ok(storageAllowed(await upload("alice", "users/alice/a.opus")));
    assert.ok(storageAllowed(await download("alice", "users/alice/a.opus")));
    assert.ok(denied(await download("bob", "users/alice/a.opus")));
    assert.ok(denied(await remove("bob", "users/alice/a.opus")));
    assert.ok(storageAllowed(await remove("alice", "users/alice/a.opus")));
  });

  it("refuses uploads to someone else's folder", async () => {
    assert.ok(denied(await upload("bob", "users/alice/b.opus")));
    assert.ok(denied(await upload(null, "users/alice/b.opus")));
  });

  it("lets tenant members upload, read and delete the tenant's files", async () => {
    await seedTenant();
    assert.ok(storageAllowed(await upload("carol", "tenants/t1/a.opus")));
    assert.ok(storageAllowed(await download("bob", "tenants/t1/a.opus")));
    assert.ok(denied(await download("mallory", "tenants/t1/a.opus")));
    assert.ok(denied(await upload("mallory", "tenants/t1/b.opus")));
    assert.ok(denied(await remove("mallory", "tenants/t1/a.opus")));
    assert.ok(storageAllowed(await remove("carol", "tenants/t1/a.opus")));
  });

  it("lets nobody write the public folder or anything unlisted", async () => {
    assert.ok(denied(await upload("alice", "public/a.txt")));
    assert.ok(denied(await upload("alice", "other/a.txt")));
  });
});
