import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ClientError, GoogleApiError } from "@google-cloud/vertexai";
import {
  classifyProviderError,
  DEFAULT_GEMINI_MODEL,
  resolveGeminiModel,
} from "./ai.js";

describe("resolveGeminiModel", () => {
  it("uses DEFAULT_GEMINI_MODEL when the variable is unset or blank", () => {
    assert.equal(DEFAULT_GEMINI_MODEL, "gemini-2.5-flash");
    assert.equal(resolveGeminiModel({}), "gemini-2.5-flash");
    assert.equal(
      resolveGeminiModel({ SONOLECT_GEMINI_MODEL: "  " }),
      "gemini-2.5-flash",
    );
  });

  it("uses SONOLECT_GEMINI_MODEL when it is set", () => {
    assert.equal(
      resolveGeminiModel({ SONOLECT_GEMINI_MODEL: " gemini-2.5-pro " }),
      "gemini-2.5-pro",
    );
  });
});

describe("classifyProviderError", () => {
  const grpc = (code: number) =>
    Object.assign(new Error(`${code} gRPC error`), { code });
  const vertex = (code: number, status: string) =>
    new ClientError(
      `got status: ${code}`,
      new GoogleApiError("Vertex error", code, status),
    );

  it("finds a missing model in Speech-to-Text and Vertex AI errors", () => {
    assert.equal(classifyProviderError(grpc(5)), "not_found");
    assert.equal(classifyProviderError(vertex(404, "NOT_FOUND")), "not_found");
    assert.equal(
      classifyProviderError(new Error("wrapped", { cause: grpc(5) })),
      "not_found",
    );
  });

  it("reads the HTTP code of a Vertex AI answer that was not JSON", () => {
    // The SDK then puts the HTTP status text where the status name goes.
    assert.equal(classifyProviderError(vertex(404, "Not Found")), "not_found");
    assert.equal(classifyProviderError(vertex(404, "")), "not_found");
    assert.equal(
      classifyProviderError(vertex(400, "Bad Request")),
      "invalid_argument",
    );
    assert.equal(
      classifyProviderError(vertex(429, "Too Many Requests")),
      undefined,
    );
  });

  it("finds input that Google refused", () => {
    assert.equal(classifyProviderError(grpc(3)), "invalid_argument");
    assert.equal(
      classifyProviderError(vertex(400, "INVALID_ARGUMENT")),
      "invalid_argument",
    );
  });

  it("leaves every other error retryable", () => {
    for (const error of [
      grpc(8),
      grpc(14),
      vertex(429, "RESOURCE_EXHAUSTED"),
      vertex(400, "FAILED_PRECONDITION"),
      Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
      new Error("socket hang up"),
      "not an error",
      undefined,
    ])
      assert.equal(classifyProviderError(error), undefined, String(error));
  });

  it("stops on an error that is its own cause", () => {
    const loop = new Error("loop") as Error & { cause?: unknown };
    loop.cause = loop;
    assert.equal(classifyProviderError(loop), undefined);
  });
});
