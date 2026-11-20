/**
 * The store contract and the routes on Firestore. Runs only against the
 * Firestore emulator (FIRESTORE_EMULATOR_HOST), as CI does:
 *
 *   npx --yes firebase-tools@15.37.0 emulators:exec --only firestore \
 *     --project demo-sonolect "pnpm --filter @sonolect/sync-service test:firestore"
 */
import { describe, it } from "node:test";

import { FirestoreStore } from "./firestore-store.js";
import { defineRouteTests } from "./route-suite.js";
import { defineStoreTests } from "./store-suite.js";
import { type StoreFactory, b64, randomBytes } from "./test-support.js";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;

/** Each store gets its own client and root collection, so runs never meet. */
const firestoreStores = (): StoreFactory => ({
  label: "firestore",
  open: () =>
    FirestoreStore.open({
      projectId:
        process.env.GCLOUD_PROJECT ??
        process.env.GOOGLE_CLOUD_PROJECT ??
        "demo-sonolect",
      collection: `syncVaults-test-${b64(randomBytes(6))}`,
    }),
});

if (emulator) {
  defineStoreTests(firestoreStores());
  defineRouteTests(firestoreStores());
} else {
  describe("firestore store", () => {
    it(
      "runs against the Firestore emulator",
      {
        skip: "FIRESTORE_EMULATOR_HOST is not set",
      },
      () => {},
    );
  });
}
