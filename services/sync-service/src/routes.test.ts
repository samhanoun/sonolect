import { defineRouteTests } from "./route-suite.js";
import { memoryStores, sqliteStores } from "./test-support.js";

defineRouteTests(memoryStores);
defineRouteTests(sqliteStores());
