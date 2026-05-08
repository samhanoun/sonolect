import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  isTrayAvailable,
  buildTrayMenu,
  trayMenuAction,
} from "./trayIntegration";
import type { TrayMenuItem } from "./trayIntegration";

describe("tray integration", () => {
  it("detects tray availability from Tauri runtime", () => {
    assert.equal(isTrayAvailable({}), false);
    assert.equal(isTrayAvailable({ __TAURI_INTERNALS__: {} }), true);
  });

  it("builds a tray menu with the expected items in order", () => {
    const menu = buildTrayMenu();
    const ids = menu
      .filter(
        (item): item is Extract<TrayMenuItem, { kind: "action" }> =>
          item.kind === "action",
      )
      .map((item) => item.id);
    assert.deepEqual(ids, [
      "start-dictation",
      "stop-dictation",
      "show-window",
      "quit",
    ]);
  });

  it("includes separator items between logical groups", () => {
    const menu = buildTrayMenu();
    const separatorCount = menu.filter(
      (item) => item.kind === "separator",
    ).length;
    assert.equal(separatorCount, 2);
  });

  it("disables Stop Dictation when not recording", () => {
    const menu = buildTrayMenu({ isRecording: false });
    const stopItem = menu.find(
      (item) => item.kind === "action" && item.id === "stop-dictation",
    );
    assert.ok(stopItem && stopItem.kind === "action");
    assert.equal(stopItem.enabled, false);
  });

  it("enables Stop Dictation and disables Start when recording", () => {
    const menu = buildTrayMenu({ isRecording: true });
    const startItem = menu.find(
      (item) => item.kind === "action" && item.id === "start-dictation",
    );
    const stopItem = menu.find(
      (item) => item.kind === "action" && item.id === "stop-dictation",
    );
    assert.ok(startItem && startItem.kind === "action");
    assert.ok(stopItem && stopItem.kind === "action");
    assert.equal(startItem.enabled, false);
    assert.equal(stopItem.enabled, true);
  });

  it("maps known menu item IDs to callbacks", () => {
    let called = "";
    const callbacks = {
      "start-dictation": () => {
        called = "start";
      },
      "show-window": () => {
        called = "show";
      },
      quit: () => {
        called = "quit";
      },
    };

    assert.equal(trayMenuAction("start-dictation", callbacks), true);
    assert.equal(called, "start");

    assert.equal(trayMenuAction("show-window", callbacks), true);
    assert.equal(called, "show");

    assert.equal(trayMenuAction("quit", callbacks), true);
    assert.equal(called, "quit");
  });

  it("returns false for unknown menu item IDs", () => {
    assert.equal(trayMenuAction("nonexistent", {}), false);
  });
});
