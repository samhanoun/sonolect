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
  splitSentences,
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

  it("keeps words that only sound like fillers", () => {
    assert.equal(
      removeFillers("quiero este coche y no ese", "es-ES"),
      "quiero este coche y no ese",
    );
    assert.equal(
      removeFillers("do you know where the keys are", "en-US"),
      "do you know where the keys are",
    );
    assert.equal(
      removeFillers("I mean it, this has to ship on Friday", "en-US"),
      "I mean it, this has to ship on Friday",
    );
    assert.equal(
      removeFillers("I like, really like it", "en-US"),
      "I like, really like it",
    );
    assert.equal(
      removeFillers("j'ai vu Ben hier", "fr-FR"),
      "j'ai vu Ben hier",
    );
    assert.equal(removeFillers("este año", "es-ES"), "este año");
  });

  it("collapses repeated words but keeps legitimate doubles", () => {
    assert.equal(
      removeFillers("nous nous sommes vus", "fr-FR"),
      "nous nous sommes vus",
    );
    assert.equal(
      removeFillers("vous vous êtes trompés", "fr-FR"),
      "vous vous êtes trompés",
    );
    assert.equal(removeFillers("oh là là", "fr-FR"), "oh là là");
    assert.equal(
      removeFillers("he had had enough", "en-US"),
      "he had had enough",
    );
    assert.equal(
      removeFillers("I know that that is true", "en-US"),
      "I know that that is true",
    );
    assert.equal(removeFillers("the the plan", "en-US"), "the plan");
    assert.equal(removeFillers("The the plan", "en-US"), "The plan");
    assert.equal(removeFillers("the theory", "en-US"), "the theory");
    assert.equal(removeFillers("été été", "fr-FR"), "été");
    assert.equal(removeFillers("été été chaud", "fr-FR"), "été chaud");
    assert.equal(removeFillers("un café cafés", "fr-FR"), "un café cafés");
    assert.equal(removeFillers("die die", "de-DE"), "die die");
    assert.equal(
      removeFillers("dass die die Zeitung liest", "de-DE"),
      "dass die die Zeitung liest",
    );
    assert.equal(removeFillers("está estábamos", "es-ES"), "está estábamos");
    assert.equal(removeFillers("así así", "es-ES"), "así así");
    // Combining accents (NFD) stay part of their word.
    assert.equal(
      removeFillers("e\u0301te\u0301 e\u0301te\u0301", "fr-FR"),
      "e\u0301te\u0301",
    );
    // Arabic doubles a noun to mean "one by one": خطوة خطوة is "step by step".
    assert.equal(removeFillers("خطوة خطوة", "ar-SA"), "خطوة خطوة");
    // A word joined by a hyphen or an apostrophe belongs to the word before
    // it, so the next word is not a repetition of it.
    for (const text of [
      "il va peut-être être en retard",
      "il peut peut-être venir",
      "de neuf heures jusqu'à à peu près midi",
      "jusqu\u2019à à midi",
      "est-ce ce que tu viens",
      "peut\u2010être être",
      "quelqu'un un jour",
      "dis-moi moi aussi",
    ]) {
      assert.equal(removeFillers(text, "fr-FR"), text);
    }
    // A stutter before a contraction still collapses.
    assert.equal(
      removeFillers("so I I'm thinking", "en-US"),
      "so I'm thinking",
    );
    assert.equal(
      removeFillers("we we\u2019re late", "en-US"),
      "we\u2019re late",
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

  it("punctuates Spanish, Arabic and full-width text", () => {
    assert.equal(sentenceCase("¿qué tal?"), "¿Qué tal?");
    assert.equal(sentenceCase("¡hola! ¿vienes?"), "¡Hola! ¿Vienes?");
    assert.equal(sentenceCase("كيف حالك؟"), "كيف حالك؟");
    assert.equal(sentenceCase("hola. ¿vienes?"), "Hola. ¿Vienes?");
    assert.equal(sentenceCase("bonjour。ça va？"), "Bonjour。Ça va？");
    assert.equal(sentenceCase("c'est fini！"), "C'est fini！");
    assert.equal(sentenceCase("مرحبا"), "مرحبا.");
  });

  it("splits sentences after Arabic and full-width marks", () => {
    assert.deepEqual(splitSentences("Bonjour。Ça va？"), [
      "Bonjour。",
      "Ça va？",
    ]);
    assert.deepEqual(splitSentences("كيف حالك؟ أنا بخير."), [
      "كيف حالك؟",
      "أنا بخير.",
    ]);
    assert.deepEqual(splitSentences("本当？！ はい。"), ["本当？！", "はい。"]);
    assert.deepEqual(splitSentences("Version 3.5 ships. Done"), [
      "Version 3.5 ships.",
      "Done",
    ]);
  });

  it("cleans a transcript without adding a period after a question", () => {
    assert.equal(
      cleanTranscript("quiero este coche y no ese", { language: "es-ES" }),
      "Quiero este coche y no ese.",
    );
    assert.equal(
      cleanTranscript("¿qué hora es? este libro", { language: "es-ES" }),
      "¿Qué hora es? Este libro.",
    );
    assert.equal(
      cleanTranscript("كيف حالك؟", { language: "ar-SA" }),
      "كيف حالك؟",
    );
    assert.equal(
      cleanTranscript("il va peut-être être en retard", { language: "fr-FR" }),
      "Il va peut-être être en retard.",
    );
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
