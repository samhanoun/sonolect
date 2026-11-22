import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { afterShareFailure, shareTarget } from "./shareTarget";

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

describe("afterShareFailure", () => {
  const abort = new Error("Share canceled");
  abort.name = "AbortError";
  const refused = new Error("Permission denied");
  refused.name = "NotAllowedError";

  it("does nothing when the user dismissed the dialog", () => {
    assert.equal(afterShareFailure("web", abort), "dismissed");
    assert.equal(afterShareFailure("ios", abort), "dismissed");
  });

  it("does nothing when a second click comes while the dialog is open", () => {
    const busy = new Error("An earlier share has not yet completed.");
    busy.name = "InvalidStateError";
    assert.equal(afterShareFailure("web", busy), "dismissed");
  });

  it("saves the note in a browser that would not open its dialog", () => {
    assert.equal(afterShareFailure("web", refused), "download");
    assert.equal(afterShareFailure("web", new Error("boom")), "download");
  });

  it("says so on a phone", () => {
    assert.equal(afterShareFailure("android", refused), "alert");
    assert.equal(afterShareFailure("ios", undefined), "alert");
  });
});
