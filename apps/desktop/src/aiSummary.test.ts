import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  extractActionItems,
  extractKeyDecisions,
  extractParticipants,
  buildSummaryPrompt,
  summarizeLocally,
  summarize,
} from "./aiSummary";
import type {
  SummaryRequest,
  SummaryResult,
  ActionItem,
  SummaryStyle,
} from "./aiSummary";
import type { TranscriptSegment } from "./segmentEditor";
import type { LlmRewriterConfig } from "./llmRewriter";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_TRANSCRIPT = [
  "Good morning everyone, let's get started with the project update.",
  "We need to review the budget before the end of the week.",
  "Sarah will prepare the marketing report by Friday.",
  "The team decided to launch the new feature next month.",
  "We agreed that the design phase should take two weeks.",
  "John should coordinate with the engineering team on the API changes.",
  "Please make sure to update the documentation before release.",
  "The conclusion is that we need more testing before deployment.",
  "Action item: complete the security audit by next Tuesday.",
  "We must finalize the pricing strategy this sprint.",
].join(" ");

const SAMPLE_SEGMENTS: TranscriptSegment[] = [
  {
    id: "seg-1",
    text: "Good morning everyone, let's get started.",
    startMs: 0,
    endMs: 3000,
    speaker: "Alice",
  },
  {
    id: "seg-2",
    text: "We need to review the budget before Friday.",
    startMs: 3200,
    endMs: 6000,
    speaker: "Bob",
  },
  {
    id: "seg-3",
    text: "I will prepare the marketing report.",
    startMs: 6200,
    endMs: 9000,
    speaker: "Sarah",
  },
  {
    id: "seg-4",
    text: "The team decided to launch next month.",
    startMs: 9200,
    endMs: 12000,
    speaker: "Alice",
  },
  {
    id: "seg-5",
    text: "We agreed the design phase takes two weeks.",
    startMs: 12200,
    endMs: 15000,
    speaker: "Bob",
  },
];

// ---------------------------------------------------------------------------
// extractParticipants
// ---------------------------------------------------------------------------

describe("extractParticipants", () => {
  it("extracts unique speakers from segments", () => {
    const participants = extractParticipants(SAMPLE_SEGMENTS);
    assert.deepEqual(participants, ["Alice", "Bob", "Sarah"]);
  });

  it("returns empty array for segments without speakers", () => {
    const noSpeakers: TranscriptSegment[] = [
      { id: "seg-1", text: "Hello.", startMs: 0, endMs: 1000 },
      { id: "seg-2", text: "World.", startMs: 1200, endMs: 2000 },
    ];
    const participants = extractParticipants(noSpeakers);
    assert.deepEqual(participants, []);
  });

  it("returns empty array for empty segments", () => {
    assert.deepEqual(extractParticipants([]), []);
  });

  it("deduplicates speakers", () => {
    const segments: TranscriptSegment[] = [
      { id: "s1", text: "Hi.", startMs: 0, endMs: 1000, speaker: "Alice" },
      { id: "s2", text: "Hey.", startMs: 1200, endMs: 2000, speaker: "Alice" },
      { id: "s3", text: "Hi.", startMs: 2200, endMs: 3000, speaker: "Bob" },
    ];
    const participants = extractParticipants(segments);
    assert.deepEqual(participants, ["Alice", "Bob"]);
  });

  it("sorts participants alphabetically", () => {
    const segments: TranscriptSegment[] = [
      { id: "s1", text: "Hi.", startMs: 0, endMs: 1000, speaker: "Zara" },
      { id: "s2", text: "Hey.", startMs: 1200, endMs: 2000, speaker: "Alice" },
      { id: "s3", text: "Ho.", startMs: 2200, endMs: 3000, speaker: "Mike" },
    ];
    const participants = extractParticipants(segments);
    assert.deepEqual(participants, ["Alice", "Mike", "Zara"]);
  });
});

// ---------------------------------------------------------------------------
// extractActionItems
// ---------------------------------------------------------------------------

describe("extractActionItems", () => {
  it("extracts 'need to' action items", () => {
    const items = extractActionItems("We need to review the budget.");
    assert.ok(items.length >= 1);
    assert.ok(
      items.some((i) => i.text.toLowerCase().includes("review the budget")),
    );
  });

  it("extracts 'should' action items", () => {
    const items = extractActionItems(
      "John should coordinate with the engineering team.",
    );
    assert.ok(items.length >= 1);
  });

  it("extracts 'will' action items", () => {
    const items = extractActionItems(
      "Sarah will prepare the marketing report by Friday.",
    );
    assert.ok(items.length >= 1);
  });

  it("extracts 'action item:' prefixed items", () => {
    const items = extractActionItems(
      "Action item: complete the security audit.",
    );
    assert.ok(items.length >= 1);
    assert.ok(
      items.some((i) => i.text.toLowerCase().includes("complete the security")),
    );
  });

  it("extracts 'please' action items", () => {
    const items = extractActionItems(
      "Please update the documentation before release.",
    );
    assert.ok(items.length >= 1);
  });

  it("extracts 'must' action items", () => {
    const items = extractActionItems("We must finalize the pricing strategy.");
    assert.ok(items.length >= 1);
  });

  it("extracts 'make sure' action items", () => {
    const items = extractActionItems(
      "Make sure to run the tests before merging.",
    );
    assert.ok(items.length >= 1);
  });

  it("assigns high priority for urgent items", () => {
    const items = extractActionItems(
      "We need to fix this urgent bug immediately.",
    );
    assert.ok(items.some((i) => i.priority === "high"));
  });

  it("assigns low priority when indicated", () => {
    const items = extractActionItems(
      "We should eventually clean up the old code.",
    );
    assert.ok(items.some((i) => i.priority === "low"));
  });

  it("assigns medium priority by default", () => {
    const items = extractActionItems("We need to update the docs.");
    assert.ok(items.some((i) => i.priority === "medium"));
  });

  it("infers assignee from participant list", () => {
    const items = extractActionItems("Sarah should prepare the report.", [
      "Sarah",
      "Bob",
    ]);
    const item = items.find((i) =>
      i.text.toLowerCase().includes("prepare the report"),
    );
    assert.ok(item);
    assert.equal(item.assignee, "Sarah");
  });

  it("deduplicates similar action items", () => {
    const text =
      "We need to review the budget. We should review the budget soon.";
    const items = extractActionItems(text);
    // Both talk about reviewing the budget; should be deduplicated
    const reviewItems = items.filter((i) =>
      i.text.toLowerCase().includes("review the budget"),
    );
    assert.equal(reviewItems.length, 1);
  });

  it("returns empty array when no action items found", () => {
    const items = extractActionItems("The weather is nice today.");
    assert.deepEqual(items, []);
  });

  it("skips very short matches", () => {
    const items = extractActionItems("We need to go.");
    // "go" is only 2 chars, below 5 threshold
    assert.deepEqual(items, []);
  });

  it("extracts multiple action items from real transcript", () => {
    const items = extractActionItems(SAMPLE_TRANSCRIPT);
    assert.ok(
      items.length >= 3,
      `Expected at least 3 items, got ${items.length}`,
    );
  });
});

// ---------------------------------------------------------------------------
// extractKeyDecisions
// ---------------------------------------------------------------------------

describe("extractKeyDecisions", () => {
  it("extracts 'decided to' decisions", () => {
    const decisions = extractKeyDecisions(
      "The team decided to launch the new feature next month.",
    );
    assert.ok(decisions.length >= 1);
    assert.ok(decisions.some((d) => d.toLowerCase().includes("launch")));
  });

  it("extracts 'agreed' decisions", () => {
    const decisions = extractKeyDecisions(
      "We agreed that the design phase should take two weeks.",
    );
    assert.ok(decisions.length >= 1);
  });

  it("extracts 'conclusion is' decisions", () => {
    const decisions = extractKeyDecisions(
      "The conclusion is that we need more testing.",
    );
    assert.ok(decisions.length >= 1);
  });

  it("extracts 'resolved to' decisions", () => {
    const decisions = extractKeyDecisions(
      "We resolved to postpone the launch.",
    );
    assert.ok(decisions.length >= 1);
  });

  it("extracts 'chose to' decisions", () => {
    const decisions = extractKeyDecisions("We chose to use React for the UI.");
    assert.ok(decisions.length >= 1);
  });

  it("returns empty array when no decisions found", () => {
    const decisions = extractKeyDecisions("The weather is nice today.");
    assert.deepEqual(decisions, []);
  });

  it("extracts multiple decisions from real transcript", () => {
    const decisions = extractKeyDecisions(SAMPLE_TRANSCRIPT);
    assert.ok(
      decisions.length >= 2,
      `Expected at least 2 decisions, got ${decisions.length}`,
    );
  });

  it("deduplicates identical decisions", () => {
    const text =
      "We decided to launch in March. The team decided to launch in March.";
    const decisions = extractKeyDecisions(text);
    const launchDecisions = decisions.filter((d) =>
      d.toLowerCase().includes("launch in march"),
    );
    assert.equal(launchDecisions.length, 1);
  });
});

// ---------------------------------------------------------------------------
// buildSummaryPrompt
// ---------------------------------------------------------------------------

describe("buildSummaryPrompt", () => {
  it("includes transcript text in prompt", () => {
    const prompt = buildSummaryPrompt({
      transcript: "Hello world",
      style: "brief",
    });
    assert.ok(prompt.includes("Hello world"));
  });

  it("includes JSON schema in prompt", () => {
    const prompt = buildSummaryPrompt({
      transcript: "test",
      style: "brief",
    });
    assert.ok(prompt.includes("summary"));
    assert.ok(prompt.includes("actionItems"));
    assert.ok(prompt.includes("keyDecisions"));
  });

  it("requests 2-3 sentences for brief style", () => {
    const prompt = buildSummaryPrompt({
      transcript: "test",
      style: "brief",
    });
    assert.ok(prompt.includes("2-3 sentence"));
  });

  it("requests detailed paragraph for detailed style", () => {
    const prompt = buildSummaryPrompt({
      transcript: "test",
      style: "detailed",
    });
    assert.ok(prompt.toLowerCase().includes("detailed"));
  });

  it("requests bullet points for bullets style", () => {
    const prompt = buildSummaryPrompt({
      transcript: "test",
      style: "bullets",
    });
    assert.ok(prompt.toLowerCase().includes("bullet"));
  });

  it("requests action items extraction for action-items style", () => {
    const prompt = buildSummaryPrompt({
      transcript: "test",
      style: "action-items",
    });
    assert.ok(prompt.toLowerCase().includes("action items"));
  });

  it("requests meeting minutes for meeting-notes style", () => {
    const prompt = buildSummaryPrompt({
      transcript: "test",
      style: "meeting-notes",
    });
    assert.ok(prompt.toLowerCase().includes("meeting minutes"));
  });

  it("includes speaker labels when segments are provided", () => {
    const prompt = buildSummaryPrompt({
      transcript: "Hello",
      segments: SAMPLE_SEGMENTS,
      style: "brief",
    });
    assert.ok(prompt.includes("[Alice]"));
    assert.ok(prompt.includes("[Bob]"));
    assert.ok(prompt.includes("[Sarah]"));
  });

  it("uses plain transcript when no segments provided", () => {
    const prompt = buildSummaryPrompt({
      transcript: "Hello world",
      style: "brief",
    });
    assert.ok(prompt.includes("Transcript:"));
    assert.ok(prompt.includes("Hello world"));
  });

  it("requests JSON-only output", () => {
    const prompt = buildSummaryPrompt({
      transcript: "test",
      style: "brief",
    });
    assert.ok(prompt.includes("JSON"));
  });

  it("respects maxLength parameter", () => {
    const prompt = buildSummaryPrompt({
      transcript: "test",
      style: "brief",
      maxLength: 200,
    });
    assert.ok(prompt.includes("200"));
  });
});

// ---------------------------------------------------------------------------
// summarizeLocally
// ---------------------------------------------------------------------------

describe("summarizeLocally", () => {
  it("returns a brief summary with key sentences", () => {
    const result = summarizeLocally({
      transcript: SAMPLE_TRANSCRIPT,
      style: "brief",
    });
    assert.equal(result.method, "local");
    assert.ok(result.summary.length > 0);
    assert.ok(result.latencyMs >= 0);
  });

  it("returns a detailed summary with decisions", () => {
    const result = summarizeLocally({
      transcript: SAMPLE_TRANSCRIPT,
      style: "detailed",
    });
    assert.ok(result.summary.length > 0);
    // Should include key decisions inline
    assert.ok(result.keyDecisions.length > 0);
  });

  it("returns bullet points", () => {
    const result = summarizeLocally({
      transcript: SAMPLE_TRANSCRIPT,
      style: "bullets",
    });
    assert.ok(result.summary.includes("- "));
    const bulletCount = result.summary
      .split("\n")
      .filter((l) => l.startsWith("- ")).length;
    assert.ok(
      bulletCount >= 2,
      `Expected at least 2 bullets, got ${bulletCount}`,
    );
  });

  it("returns formatted action items", () => {
    const result = summarizeLocally({
      transcript: SAMPLE_TRANSCRIPT,
      style: "action-items",
    });
    assert.ok(result.actionItems.length > 0);
    assert.ok(result.summary.includes("["));
  });

  it("returns meeting notes format", () => {
    const result = summarizeLocally({
      transcript: SAMPLE_TRANSCRIPT,
      segments: SAMPLE_SEGMENTS,
      style: "meeting-notes",
    });
    assert.ok(result.summary.includes("# Meeting Notes"));
    assert.ok(result.summary.includes("Attendees"));
    assert.ok(result.summary.includes("Alice"));
    assert.ok(result.participants.includes("Alice"));
    assert.ok(result.participants.includes("Bob"));
  });

  it("includes duration when segments are provided", () => {
    const result = summarizeLocally({
      transcript: SAMPLE_TRANSCRIPT,
      segments: SAMPLE_SEGMENTS,
      style: "meeting-notes",
    });
    assert.ok(result.duration !== undefined);
  });

  it("has no duration when segments are missing", () => {
    const result = summarizeLocally({
      transcript: SAMPLE_TRANSCRIPT,
      style: "brief",
    });
    assert.equal(result.duration, undefined);
  });

  it("respects maxLength truncation", () => {
    const result = summarizeLocally({
      transcript: SAMPLE_TRANSCRIPT,
      style: "detailed",
      maxLength: 50,
    });
    assert.ok(result.summary.length <= 50);
    assert.ok(result.summary.endsWith("..."));
  });

  it("extracts action items regardless of style", () => {
    const result = summarizeLocally({
      transcript: SAMPLE_TRANSCRIPT,
      style: "brief",
    });
    assert.ok(result.actionItems.length > 0);
  });

  it("extracts key decisions regardless of style", () => {
    const result = summarizeLocally({
      transcript: SAMPLE_TRANSCRIPT,
      style: "brief",
    });
    assert.ok(result.keyDecisions.length > 0);
  });

  it("handles short transcript gracefully", () => {
    const result = summarizeLocally({
      transcript: "Hello world.",
      style: "brief",
    });
    assert.equal(result.summary, "Hello world.");
    assert.deepEqual(result.actionItems, []);
    assert.deepEqual(result.keyDecisions, []);
  });

  it("returns 'no action items' message for action-items style when none found", () => {
    const result = summarizeLocally({
      transcript: "The weather is nice today.",
      style: "action-items",
    });
    assert.ok(result.summary.includes("No action items"));
  });

  it("works with all style types", () => {
    const styles: SummaryStyle[] = [
      "brief",
      "detailed",
      "bullets",
      "action-items",
      "meeting-notes",
    ];
    for (const style of styles) {
      const result = summarizeLocally({
        transcript: SAMPLE_TRANSCRIPT,
        style,
      });
      assert.equal(result.method, "local");
      assert.ok(result.summary.length > 0, `Empty summary for style: ${style}`);
    }
  });
});

// ---------------------------------------------------------------------------
// summarize (smart dispatcher)
// ---------------------------------------------------------------------------

describe("summarize (smart dispatcher)", () => {
  it("uses local when no config provided", async () => {
    const result = await summarize({
      transcript: SAMPLE_TRANSCRIPT,
      style: "brief",
    });
    assert.equal(result.method, "local");
    assert.ok(result.summary.length > 0);
  });

  it("uses local when provider is local", async () => {
    const result = await summarize(
      { transcript: SAMPLE_TRANSCRIPT, style: "brief" },
      { provider: "local" },
    );
    assert.equal(result.method, "local");
  });

  it("uses local when API key is missing", async () => {
    const result = await summarize(
      { transcript: SAMPLE_TRANSCRIPT, style: "brief" },
      { provider: "openai" },
    );
    assert.equal(result.method, "local");
  });

  it("returns empty result for empty transcript", async () => {
    const result = await summarize({ transcript: "", style: "brief" });
    assert.equal(result.summary, "");
    assert.deepEqual(result.actionItems, []);
    assert.deepEqual(result.keyDecisions, []);
    assert.equal(result.method, "local");
  });

  it("returns empty result for whitespace-only transcript", async () => {
    const result = await summarize({ transcript: "   \n  ", style: "brief" });
    assert.equal(result.summary, "");
  });

  it("returns participants from segments for empty transcript", async () => {
    const result = await summarize({
      transcript: "",
      segments: SAMPLE_SEGMENTS,
      style: "brief",
    });
    assert.ok(result.participants.includes("Alice"));
    assert.ok(result.participants.includes("Bob"));
  });

  it("falls back to local on cloud failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Network unavailable");
    };
    try {
      const config: LlmRewriterConfig = {
        provider: "openai",
        apiKey: "fake-key",
      };
      const result = await summarize(
        { transcript: SAMPLE_TRANSCRIPT, style: "brief" },
        config,
      );
      assert.equal(result.method, "local");
      assert.ok(result.summary.length > 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns cloud result on successful OpenAI response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "This meeting covered the project update.",
                  actionItems: [
                    {
                      text: "Review the budget",
                      assignee: "Bob",
                      priority: "high",
                    },
                  ],
                  keyDecisions: ["Launch next month"],
                  participants: ["Alice", "Bob"],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    try {
      const config: LlmRewriterConfig = {
        provider: "openai",
        apiKey: "test-key",
      };
      const result = await summarize(
        { transcript: SAMPLE_TRANSCRIPT, style: "brief" },
        config,
      );
      assert.equal(result.method, "cloud");
      assert.equal(result.summary, "This meeting covered the project update.");
      assert.equal(result.actionItems.length, 1);
      assert.equal(result.actionItems[0]!.assignee, "Bob");
      assert.deepEqual(result.keyDecisions, ["Launch next month"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns cloud result on successful Anthropic response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                summary: "Anthropic summary here.",
                actionItems: [],
                keyDecisions: ["Use React"],
                participants: ["Alice"],
              }),
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    try {
      const config: LlmRewriterConfig = {
        provider: "anthropic",
        apiKey: "test-key",
      };
      const result = await summarize(
        { transcript: SAMPLE_TRANSCRIPT, style: "brief" },
        config,
      );
      assert.equal(result.method, "cloud");
      assert.equal(result.summary, "Anthropic summary here.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to local on HTTP error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("Unauthorized", { status: 401 });
    try {
      const config: LlmRewriterConfig = {
        provider: "openai",
        apiKey: "bad-key",
      };
      const result = await summarize(
        { transcript: SAMPLE_TRANSCRIPT, style: "brief" },
        config,
      );
      assert.equal(result.method, "local");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles LLM returning non-JSON gracefully", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "Here is a summary of the meeting with no JSON format.",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    try {
      const config: LlmRewriterConfig = {
        provider: "openai",
        apiKey: "test-key",
      };
      const result = await summarize(
        { transcript: SAMPLE_TRANSCRIPT, style: "brief" },
        config,
      );
      // Should still return a result (using the raw text as summary)
      assert.equal(result.method, "cloud");
      assert.ok(result.summary.length > 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
