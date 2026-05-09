import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractActionItems,
  extractKeyDecisions,
  localFallbackSummary,
  generateSummary,
} from "./aiSummary";
import type { SummaryStyle } from "./aiSummary";

describe("extractActionItems", () => {
  it("extracts 'need to' patterns", () => {
    const items = extractActionItems(
      "We need to update the docs. The API is stable.",
    );
    assert.ok(items.some((i) => i.includes("need to update the docs")));
  });

  it("extracts 'should' patterns", () => {
    const items = extractActionItems("We should review the PR before merging.");
    assert.ok(items.some((i) => i.includes("should review the PR")));
  });

  it("extracts 'will' patterns", () => {
    const items = extractActionItems("Alice will send the report by Friday.");
    assert.ok(items.some((i) => i.includes("will send the report")));
  });

  it("extracts 'must' patterns", () => {
    const items = extractActionItems("We must fix the security vulnerability.");
    assert.ok(items.some((i) => i.includes("must fix the security")));
  });

  it("extracts 'action item:' prefix", () => {
    const items = extractActionItems("action item: deploy staging environment");
    assert.ok(items.some((i) => i.includes("deploy staging environment")));
  });

  it("extracts 'TODO:' prefix", () => {
    const items = extractActionItems("TODO: write integration tests");
    assert.ok(items.some((i) => i.includes("write integration tests")));
  });

  it("extracts 'task:' prefix", () => {
    const items = extractActionItems("task: migrate the database schema");
    assert.ok(items.some((i) => i.includes("migrate the database schema")));
  });

  it("returns empty array when no patterns match", () => {
    const items = extractActionItems("The weather is nice today.");
    assert.deepStrictEqual(items, []);
  });

  it("deduplicates identical items", () => {
    const items = extractActionItems("We need to fix it. We need to fix it.");
    const fixItems = items.filter((i) => i.includes("need to fix it"));
    assert.strictEqual(fixItems.length, 1);
  });
});

describe("extractKeyDecisions", () => {
  it("extracts 'decided' patterns", () => {
    const decisions = extractKeyDecisions("The team decided to use React.");
    assert.ok(decisions.some((d) => d.includes("decided to use React")));
  });

  it("extracts 'agreed' patterns", () => {
    const decisions = extractKeyDecisions("Everyone agreed on the timeline.");
    assert.ok(decisions.some((d) => d.includes("agreed on the timeline")));
  });

  it("extracts 'conclusion' patterns", () => {
    const decisions = extractKeyDecisions(
      "The conclusion is that we ship next week.",
    );
    assert.ok(decisions.some((d) => d.includes("conclusion")));
  });

  it("extracts 'resolved' patterns", () => {
    const decisions = extractKeyDecisions("We resolved to adopt TypeScript.");
    assert.ok(decisions.some((d) => d.includes("resolved to adopt")));
  });

  it("extracts 'determined' patterns", () => {
    const decisions = extractKeyDecisions(
      "The committee determined the budget allocation.",
    );
    assert.ok(decisions.some((d) => d.includes("determined")));
  });

  it("returns empty array when no patterns match", () => {
    const decisions = extractKeyDecisions("We talked about the project.");
    assert.deepStrictEqual(decisions, []);
  });
});

describe("localFallbackSummary", () => {
  const transcript =
    "We discussed the roadmap. Alice will handle the frontend. " +
    "Bob decided to rewrite the API. The team agreed on a two-week sprint. " +
    "We need to update the CI pipeline.";

  it("brief returns first 3 sentences", () => {
    const result = localFallbackSummary(transcript, "brief");
    assert.strictEqual(result.style, "brief");
    const sentenceCount = result.text
      .split(/\.\s+|\.$/g)
      .filter(Boolean).length;
    assert.ok(
      sentenceCount <= 3,
      `Expected <= 3 sentences, got ${sentenceCount}`,
    );
  });

  it("detailed returns all sentences", () => {
    const result = localFallbackSummary(transcript, "detailed");
    assert.strictEqual(result.style, "detailed");
    assert.ok(result.text.length >= transcript.length * 0.5);
  });

  it("bullets returns dash-prefixed lines", () => {
    const result = localFallbackSummary(transcript, "bullets");
    assert.strictEqual(result.style, "bullets");
    const lines = result.text.split("\n").filter(Boolean);
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.ok(line.startsWith("- "), `Line doesn't start with "- ": ${line}`);
    }
  });

  it("action-items returns checkbox-prefixed lines", () => {
    const result = localFallbackSummary(transcript, "action-items");
    assert.strictEqual(result.style, "action-items");
    const lines = result.text.split("\n").filter(Boolean);
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.ok(
        line.startsWith("- [ ] "),
        `Line doesn't start with "- [ ] ": ${line}`,
      );
    }
  });

  it("meeting-notes includes summary, decisions, and action items sections", () => {
    const result = localFallbackSummary(transcript, "meeting-notes");
    assert.strictEqual(result.style, "meeting-notes");
    assert.ok(result.text.includes("## Summary"));
    assert.ok(result.text.includes("## Key Decisions"));
    assert.ok(result.text.includes("## Action Items"));
  });

  it("always includes generatedAt as ISO string", () => {
    const styles: SummaryStyle[] = [
      "brief",
      "detailed",
      "bullets",
      "action-items",
      "meeting-notes",
    ];
    for (const style of styles) {
      const result = localFallbackSummary(transcript, style);
      assert.ok(
        !isNaN(Date.parse(result.generatedAt)),
        `generatedAt is not a valid ISO date for style "${style}"`,
      );
    }
  });

  it("populates actionItems and keyDecisions arrays", () => {
    const result = localFallbackSummary(transcript, "brief");
    assert.ok(
      result.actionItems.length > 0,
      "Expected at least one action item",
    );
    assert.ok(
      result.keyDecisions.length > 0,
      "Expected at least one key decision",
    );
  });

  it("handles empty transcript", () => {
    const result = localFallbackSummary("", "brief");
    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.actionItems, []);
    assert.deepStrictEqual(result.keyDecisions, []);
  });
});

describe("generateSummary", () => {
  it("falls back to local summary when no API key is given", async () => {
    const transcript =
      "We decided to launch next month. Alice will prepare the demo.";
    const result = await generateSummary(transcript, "brief");
    assert.strictEqual(result.style, "brief");
    assert.ok(result.text.length > 0);
    assert.ok(result.actionItems.length > 0);
    assert.ok(result.keyDecisions.length > 0);
    assert.ok(!isNaN(Date.parse(result.generatedAt)));
  });

  it("falls back to local summary when API key is undefined in options", async () => {
    const transcript = "The team agreed to adopt Kubernetes.";
    const result = await generateSummary(transcript, "bullets", {});
    assert.strictEqual(result.style, "bullets");
    assert.ok(result.text.includes("- "));
  });

  it("returns correct structure for all styles without API key", async () => {
    const transcript = "We must ship the MVP. The team resolved to cut scope.";
    const styles: SummaryStyle[] = [
      "brief",
      "detailed",
      "bullets",
      "action-items",
      "meeting-notes",
    ];
    for (const style of styles) {
      const result = await generateSummary(transcript, style);
      assert.strictEqual(result.style, style);
      assert.ok(typeof result.text === "string");
      assert.ok(Array.isArray(result.actionItems));
      assert.ok(Array.isArray(result.keyDecisions));
      assert.ok(typeof result.generatedAt === "string");
    }
  });
});
