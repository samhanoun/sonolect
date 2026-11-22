import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FixedWindowLimiter, clientKey } from "./rate-limit.js";

describe("rate limits", () => {
  it("count an IPv6 client by its /64 and an IPv4 client by its address", () => {
    assert.equal(clientKey("203.0.113.9"), "203.0.113.9");
    assert.equal(clientKey("2001:db8:1:2::1"), "2001:db8:1:2::/64");
    assert.equal(
      clientKey("2001:0DB8:0001:0002:ffff:ffff:ffff:42"),
      "2001:db8:1:2::/64",
    );
    assert.equal(clientKey("2001:db8:1:3::1"), "2001:db8:1:3::/64");
    assert.equal(clientKey("fe80::1%eth0"), "fe80:0:0:0::/64");
    assert.equal(clientKey("::1"), "0:0:0:0::/64");
    // An IPv4 address mapped into IPv6 is that IPv4 address.
    assert.equal(clientKey("::ffff:203.0.113.9"), "203.0.113.9");
    assert.equal(clientKey("::ffff:cb00:7109"), "203.0.113.9");
    assert.equal(clientKey("64:ff9b::203.0.113.9"), "64:ff9b:0:0::/64");
    // Anything else is counted as it is.
    for (const other of ["", "unknown", "1:2:3", "1::2::3", "::ffff:300.1.1.1"])
      assert.equal(clientKey(other), other);
  });

  it("give back a slot that did not count", () => {
    const limiter = new FixedWindowLimiter(2, 1000);
    assert.equal(limiter.hit("a", 0), 0);
    assert.equal(limiter.hit("a", 0), 0);
    assert.ok(limiter.hit("a", 0) > 0);
    limiter.release("a", 0);
    assert.equal(limiter.hit("a", 0), 0);
    assert.ok(limiter.check("a", 0) > 0);
    // Nothing to give back once the window is over.
    limiter.release("a", 2000);
    assert.equal(limiter.check("a", 2000), 0);
  });
});
