import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Settings' Sync section (SyncSection.tsx) needs React Native, so these
 * read its source: the pairing code, which gives full access to every
 * synced note, must not stay on screen once the user leaves it.
 */
const source = readFileSync(path.join(__dirname, "SyncSection.tsx"), "utf8");

describe("the pairing code in Settings", () => {
  it("goes away when Settings loses focus", () => {
    assert.match(
      source,
      /const leave = useCallback\(\(\) => \{\s*leaves\.current \+= 1;\s*setPairing\(null\);\s*\}, \[\]\);/,
    );
    assert.match(
      source,
      /useFocusEffect\(useCallback\(\(\) => leave, \[leave\]\)\);/,
    );
  });

  it("goes away when the app leaves the screen", () => {
    assert.match(
      source,
      /AppState\.addEventListener\("change", \(state\) => \{\s*if \(state !== "active"\) leave\(\);/,
    );
  });

  it("is not shown when it arrives after the user left", () => {
    // Turning sync on and reading the key take time: a code read after a
    // leave would show the next time Settings or the app opens.
    assert.match(
      source,
      /const showPairing = \(at: number, next: Pairing \| null\) => \{\s*if \(leaves\.current === at\) setPairing\(next\);/,
    );
    const sets = source.match(/setPairing\([^)]*\)/g) ?? [];
    assert.deepEqual([...new Set(sets)].sort(), [
      "setPairing(next)",
      "setPairing(null)",
    ]);
    for (const action of ["turnOn", "showCode"]) {
      const body = source.slice(source.indexOf(`const ${action} = () =>`));
      assert.match(
        body,
        /act\(async \(\) => \{\s*const at = leaves\.current;[\s\S]*?showPairing\(at, await sync\.pairing\(\)\);/,
        action,
      );
    }
  });
});
