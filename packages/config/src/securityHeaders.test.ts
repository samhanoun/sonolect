import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildCspDirectives,
  serializeCsp,
  buildSecurityHeaders,
  fastifySecurityConfig,
} from "./securityHeaders";

describe("buildCspDirectives", () => {
  it("returns all required directive keys", () => {
    const csp = buildCspDirectives();
    const requiredKeys = [
      "default-src",
      "script-src",
      "style-src",
      "img-src",
      "font-src",
      "connect-src",
      "media-src",
      "object-src",
      "frame-ancestors",
      "base-uri",
      "form-action",
    ];
    for (const key of requiredKeys) {
      assert.ok(key in csp, `Missing CSP directive: ${key}`);
    }
  });

  it("defaults to self for default-src", () => {
    const csp = buildCspDirectives();
    assert.deepStrictEqual(csp["default-src"], ["'self'"]);
  });

  it("blocks object-src and frame-ancestors", () => {
    const csp = buildCspDirectives();
    assert.deepStrictEqual(csp["object-src"], ["'none'"]);
    assert.deepStrictEqual(csp["frame-ancestors"], ["'none'"]);
  });

  it("includes upgrade-insecure-requests by default", () => {
    const csp = buildCspDirectives();
    assert.strictEqual(csp["upgrade-insecure-requests"], true);
  });

  it("omits upgrade-insecure-requests when disabled", () => {
    const csp = buildCspDirectives({ upgradeInsecureRequests: false });
    assert.strictEqual(csp["upgrade-insecure-requests"], undefined);
  });

  it("merges extraConnectSrc", () => {
    const csp = buildCspDirectives({
      extraConnectSrc: ["https://api.example.com"],
    });
    assert.ok(csp["connect-src"].includes("https://api.example.com"));
    assert.ok(csp["connect-src"].includes("'self'"));
  });

  it("merges extraScriptSrc", () => {
    const csp = buildCspDirectives({
      extraScriptSrc: ["https://cdn.example.com"],
    });
    assert.ok(csp["script-src"].includes("https://cdn.example.com"));
  });

  it("merges extraImgSrc", () => {
    const csp = buildCspDirectives({
      extraImgSrc: ["https://images.example.com"],
    });
    assert.ok(csp["img-src"].includes("https://images.example.com"));
  });
});

describe("serializeCsp", () => {
  it("serialises directives into a valid CSP string", () => {
    const csp = buildCspDirectives();
    const serialized = serializeCsp(csp);
    assert.ok(serialized.includes("default-src 'self'"));
    assert.ok(serialized.includes("object-src 'none'"));
    assert.ok(serialized.includes("upgrade-insecure-requests"));
    assert.ok(serialized.includes("; "), "Directives should be semicolon-separated");
  });

  it("produces no trailing semicolons", () => {
    const serialized = serializeCsp(buildCspDirectives());
    assert.ok(!serialized.endsWith(";"));
    assert.ok(!serialized.endsWith("; "));
  });
});

describe("buildSecurityHeaders", () => {
  it("includes all critical security headers", () => {
    const headers = buildSecurityHeaders();
    const expected = [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "X-XSS-Protection",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Embedder-Policy",
    ];
    for (const header of expected) {
      assert.ok(header in headers, `Missing header: ${header}`);
    }
  });

  it("sets X-Frame-Options to DENY", () => {
    const headers = buildSecurityHeaders();
    assert.strictEqual(headers["X-Frame-Options"], "DENY");
  });

  it("sets X-Content-Type-Options to nosniff", () => {
    const headers = buildSecurityHeaders();
    assert.strictEqual(headers["X-Content-Type-Options"], "nosniff");
  });

  it("disables X-XSS-Protection (CSP supersedes)", () => {
    const headers = buildSecurityHeaders();
    assert.strictEqual(headers["X-XSS-Protection"], "0");
  });

  it("sets HSTS with 2-year max-age by default", () => {
    const headers = buildSecurityHeaders();
    assert.ok(headers["Strict-Transport-Security"]!.includes("max-age=63072000"));
    assert.ok(headers["Strict-Transport-Security"]!.includes("includeSubDomains"));
    assert.ok(headers["Strict-Transport-Security"]!.includes("preload"));
  });

  it("allows customising HSTS max-age", () => {
    const headers = buildSecurityHeaders({ hstsMaxAge: 86400 });
    assert.ok(headers["Strict-Transport-Security"]!.includes("max-age=86400"));
  });

  it("respects hstsPreload = false", () => {
    const headers = buildSecurityHeaders({ hstsPreload: false });
    assert.ok(!headers["Strict-Transport-Security"]!.includes("preload"));
  });
});

describe("fastifySecurityConfig", () => {
  it("returns a valid config object", () => {
    const config = fastifySecurityConfig();
    assert.ok(config.contentSecurityPolicy);
    assert.ok(config.hsts);
    assert.strictEqual(config.frameguard.action, "deny");
    assert.strictEqual(config.noSniff, true);
    assert.strictEqual(config.xssFilter, false);
  });

  it("passes through custom options", () => {
    const config = fastifySecurityConfig({ hstsMaxAge: 3600 });
    assert.strictEqual(config.hsts.maxAge, 3600);
  });
});
