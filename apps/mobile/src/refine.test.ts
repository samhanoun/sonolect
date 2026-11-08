import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyDictionary,
  cleanTranscript,
  expandSnippets,
  modeNeedsModel,
  refineLocally,
  removeFillers,
  sentenceCase,
} from "./refine";

describe("local refinement", () => {
  it("removes filler words and stutters without changing meaning", () => {
    assert.equal(
      removeFillers("um so I I think, uh, we ship friday"),
      "so I think, we ship friday",
    );
    assert.equal(
      removeFillers("euh je pense que oui", "fr-FR"),
      "je pense que oui",
    );
  });

  it("sentence-cases and terminates text", () => {
    assert.equal(
      sentenceCase("hello there. how are you"),
      "Hello there. How are you.",
    );
    assert.equal(sentenceCase("already done!"), "Already done!");
    assert.equal(sentenceCase("   "), "");
  });

  it("applies dictionary replacements on word boundaries only", () => {
    const entries = [{ id: "1", spoken: "cube", replacement: "Kube" }];
    assert.equal(
      applyDictionary("deploy to cube now", entries),
      "deploy to Kube now",
    );
    assert.equal(applyDictionary("cubes are fine", entries), "cubes are fine");
  });

  it("expands snippet triggers", () => {
    const snippets = [{ id: "1", trigger: "sign off", body: "Best, Sam" }];
    assert.equal(
      expandSnippets("thanks sign off", snippets),
      "thanks Best, Sam",
    );
  });

  it("never invents content for generative modes without a model", () => {
    const raw = "um tell Camille I approve the plan";
    const cleaned = cleanTranscript(raw);
    assert.equal(refineLocally(raw, "reply"), cleaned);
    assert.equal(refineLocally(raw, "rewrite"), cleaned);
    assert.equal(modeNeedsModel("reply"), true);
    assert.equal(modeNeedsModel("summarize"), false);
  });

  it("summarizes to at most three sentences taken from the input", () => {
    const raw =
      "We met about the launch. Marketing wants two more weeks. Engineering is ready now. The beta feedback was mostly positive and asks for offline mode. Lunch was good.";
    const summary = refineLocally(raw, "summarize");
    const sentences = summary.split(/(?<=\.)\s+/);
    assert.ok(sentences.length <= 3);
    for (const sentence of sentences)
      assert.ok(raw.includes(sentence.replace(/\.$/, "")));
    assert.ok(summary.startsWith("We met about the launch."));
  });

  it("turns spoken steps into a task list", () => {
    assert.equal(
      refineLocally(
        "book the room and then send the invite, then prepare slides",
        "task_creation",
      ),
      "• Book the room\n• Send the invite\n• Prepare slides",
    );
  });
});
