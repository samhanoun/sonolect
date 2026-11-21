import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import {
  PairingError,
  base64urlEncode,
  pairingLink,
} from "@sonolect/sync-core";

import { joinPlanForLink, joinScreenFor } from "./joinLink";

/**
 * The join route (app/sync/join.tsx): a pairing link, as the camera app
 * hands it to the phone, through the installed Expo Router's own parsing
 * of a native deep link, to the parameters the screen reads.
 */

const URL = "https://sync.example.com";
const root = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);
const key = base64urlEncode(root);

type Params = Record<string, string | string[] | undefined>;

/**
 * Expo Router's native deep-link path (fork/extractPathFromURL.js) and its
 * path-to-state parser (fork/getStateFromPath.js), loaded from the app's
 * installed expo-router. expo-linking needs React Native: only its
 * unwrapDevLaunchURL is used, which leaves a link without `__expo_` params
 * as it is.
 */
function loadExpoRouterLinking() {
  const appRequire = createRequire(__filename);
  const routerDir = path.dirname(
    appRequire.resolve("expo-router/package.json"),
  );
  const routerRequire = createRequire(path.join(routerDir, "package.json"));
  const linking = routerRequire.resolve("expo-linking");
  routerRequire.cache[linking] ??= {
    id: linking,
    filename: linking,
    loaded: true,
    exports: { unwrapDevLaunchURL: (url: string) => url },
  } as unknown as NodeJS.Module;
  const { extractExpoPathFromURL } = routerRequire(
    path.join(routerDir, "build/fork/extractPathFromURL.js"),
  ) as { extractExpoPathFromURL(prefixes: string[], url: string): string };
  const { getStateFromPath } = routerRequire(
    path.join(routerDir, "build/fork/getStateFromPath.js"),
  ) as {
    getStateFromPath(
      path: string,
      options: { screens: Record<string, string> },
    ): { routes: { name: string; params?: Params }[] } | undefined;
  };
  /** The route and parameters the app opens for a link. */
  return (url: string) => {
    const state = getStateFromPath(extractExpoPathFromURL([], url), {
      screens: { index: "", settings: "settings", "sync/join": "sync/join" },
    });
    const route = state?.routes[0];
    return { name: route?.name, params: route?.params ?? {} };
  };
}

const open = loadExpoRouterLinking();

describe("join route", () => {
  it("receives the key of the link sync-core builds", () => {
    const link = pairingLink(root);
    assert.match(link, /^sonolect:\/\/sync\/join\?v=1&k=/);
    const { name, params } = open(link);
    assert.equal(name, "sync/join");
    assert.deepEqual(joinPlanForLink(URL, params), { kind: "confirm", root });
  });

  it("receives the three-slash and upper-case scheme forms, ignoring unknown parameters", () => {
    for (const link of [
      `sonolect:///sync/join?v=1&k=${key}`,
      `SONOLECT://sync/join?v=1&k=${key}`,
      `sonolect://sync/join?k=${key}&v=1&s=https://elsewhere.example`,
    ]) {
      const { name, params } = open(link);
      assert.equal(name, "sync/join", link);
      assert.deepEqual(joinPlanForLink(URL, params), { kind: "confirm", root });
    }
  });

  it("loses a fragment, which is why the link puts the key in the query", () => {
    const { name, params } = open(`sonolect://sync/join#v=1&k=${key}`);
    assert.equal(name, "sync/join");
    assert.equal(params.k, undefined);
    const plan = joinPlanForLink(URL, params);
    assert.equal(plan.kind, "invalid");
  });
});

describe("join screen", () => {
  const confirm = joinPlanForLink(URL, { v: "1", k: key });
  const none = () => null;

  it("asks before joining, once the phone's key has been read", () => {
    assert.deepEqual(joinScreenFor(confirm, "off", none), {
      kind: "confirm",
      root,
      ready: true,
    });
    assert.deepEqual(joinScreenFor(confirm, "loading", none), {
      kind: "confirm",
      root,
      ready: false,
    });
  });

  it("says when this phone already syncs, with this key or another", () => {
    assert.deepEqual(
      joinScreenFor(confirm, "on", () => "alreadyJoined"),
      { kind: "alreadyJoined" },
    );
    assert.deepEqual(
      joinScreenFor(confirm, "on", () => "otherVaultOn"),
      { kind: "otherVaultOn" },
    );
  });

  it("says why a link is refused", () => {
    const screen = joinScreenFor(
      joinPlanForLink(URL, { v: "2", k: key }),
      "off",
      none,
    );
    assert.equal(screen.kind, "invalid");
    assert.ok(
      screen.kind === "invalid" && screen.error instanceof PairingError,
    );
  });

  it("goes to Capture in a build without sync", () => {
    assert.deepEqual(
      joinScreenFor(joinPlanForLink(null, { v: "1", k: key }), null, none),
      { kind: "leave" },
    );
    assert.deepEqual(joinScreenFor(confirm, null, none), { kind: "leave" });
  });
});
