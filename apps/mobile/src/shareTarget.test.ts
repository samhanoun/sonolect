import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shareTarget } from "./shareTarget";

describe("shareTarget", () => {
  it("opens the share sheet on phones", () => {
    assert.equal(shareTarget("ios", undefined), "sheet");
    assert.equal(shareTarget("android", {}), "sheet");
  });

  it("opens the browser's share dialog where it exists", () => {
    assert.equal(shareTarget("web", { share: async () => undefined }), "sheet");
  });

  it("downloads the note in a browser without a share dialog", () => {
    assert.equal(shareTarget("web", {}), "download");
    assert.equal(shareTarget("web", { share: "not a function" }), "download");
    assert.equal(shareTarget("web", undefined), "download");
  });
});
