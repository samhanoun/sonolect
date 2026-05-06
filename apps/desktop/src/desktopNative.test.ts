import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  DEFAULT_PUSH_TO_TALK_SHORTCUT,
  DEFAULT_TOGGLE_SHORTCUT,
  isTauriRuntime,
  normalizeShortcutAccelerator,
} from "./desktopNative";

describe("desktop native integration helpers", () => {
  it("normalizes shortcut aliases into Tauri global-shortcut accelerators", () => {
    assert.equal(
      normalizeShortcutAccelerator("cmd + shift + m"),
      DEFAULT_TOGGLE_SHORTCUT,
    );
    assert.equal(
      normalizeShortcutAccelerator("control+shift+v"),
      DEFAULT_PUSH_TO_TALK_SHORTCUT,
    );
    assert.equal(normalizeShortcutAccelerator("option + space"), "Alt+Space");
  });

  it("detects packaged Tauri runtime without assuming browser tests are native", () => {
    assert.equal(isTauriRuntime({}), false);
    assert.equal(isTauriRuntime({ __TAURI_INTERNALS__: {} }), true);
  });
});
