const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const withAsyncStorageSize = require("./withAsyncStorageSize");

const { setGradleProperty, DB_SIZE_PROPERTY, DB_SIZE_MB } =
  withAsyncStorageSize;

const BASE = [
  { type: "comment", value: " Project-wide Gradle settings." },
  { type: "property", key: "org.gradle.jvmargs", value: "-Xmx2048m" },
  { type: "empty" },
  { type: "property", key: "newArchEnabled", value: "true" },
];

describe("setGradleProperty", () => {
  it("appends a new key", () => {
    assert.deepEqual(
      setGradleProperty(BASE, "AsyncStorage_db_size_in_MB", "64"),
      [
        ...BASE,
        { type: "property", key: "AsyncStorage_db_size_in_MB", value: "64" },
      ],
    );
  });

  it("replaces the value of an existing key in place", () => {
    const withOld = [
      ...BASE.slice(0, 2),
      { type: "property", key: "AsyncStorage_db_size_in_MB", value: "6" },
      ...BASE.slice(2),
    ];
    assert.deepEqual(
      setGradleProperty(withOld, "AsyncStorage_db_size_in_MB", "64"),
      [
        ...BASE.slice(0, 2),
        { type: "property", key: "AsyncStorage_db_size_in_MB", value: "64" },
        ...BASE.slice(2),
      ],
    );
  });

  it("is idempotent and leaves its input alone", () => {
    const before = structuredClone(BASE);
    const once = setGradleProperty(BASE, "AsyncStorage_db_size_in_MB", "64");
    const twice = setGradleProperty(once, "AsyncStorage_db_size_in_MB", "64");
    assert.deepEqual(twice, once);
    assert.deepEqual(BASE, before);
  });

  it("never takes a comment for a property", () => {
    const items = [{ type: "comment", value: "AsyncStorage_db_size_in_MB" }];
    assert.deepEqual(
      setGradleProperty(items, "AsyncStorage_db_size_in_MB", "64"),
      [
        ...items,
        { type: "property", key: "AsyncStorage_db_size_in_MB", value: "64" },
      ],
    );
  });
});

describe("withAsyncStorageSize", () => {
  it("sets AsyncStorage_db_size_in_MB=64 in gradle.properties", async () => {
    assert.equal(DB_SIZE_PROPERTY, "AsyncStorage_db_size_in_MB");
    assert.equal(DB_SIZE_MB, "64");
    const config = withAsyncStorageSize({ name: "Sonolect", slug: "sonolect" });
    const mod = config.mods.android.gradleProperties;
    const result = await mod({
      modRequest: {
        platform: "android",
        modName: "gradleProperties",
        projectRoot: "/project",
        platformProjectRoot: "/project/android",
        introspect: false,
      },
      modResults: structuredClone(BASE),
    });
    assert.deepEqual(result.modResults, [
      ...BASE,
      { type: "property", key: "AsyncStorage_db_size_in_MB", value: "64" },
    ]);
  });
});
