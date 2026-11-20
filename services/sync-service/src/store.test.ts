import { defineStoreTests } from "./store-suite.js";
import { memoryStores, sqliteStores } from "./test-support.js";

defineStoreTests(memoryStores);
defineStoreTests(sqliteStores());
