import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyDictionary,
  cleanParts,
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

describe("cleanParts", () => {
  const DICTIONARY = [
    { id: "d1", spoken: "new york", replacement: "New York" },
    { id: "d2", spoken: "sam lect", replacement: "Sonolect" },
    { id: "d3", spoken: "cube", replacement: "Kube" },
  ];
  const SNIPPETS = [
    { id: "s1", trigger: "insert my address", body: "1 Main Street, Paris" },
    { id: "s2", trigger: "sign off", body: "Best, Sam" },
  ];
  const CONTEXT = { dictionary: DICTIONARY, snippets: SNIPPETS };

  it("keeps a sentence going into the next part", () => {
    assert.deepEqual(
      cleanParts(["i went to the store and", "bought some milk"]),
      [
        { first: 0, last: 0, text: "I went to the store and" },
        { first: 1, last: 1, text: "bought some milk." },
      ],
    );
    assert.deepEqual(
      cleanParts(["we start now.", "then we stop"]).map((run) => run.text),
      ["We start now.", "Then we stop."],
    );
    assert.deepEqual(
      cleanParts(["¿qué tal?", "¿bien?"], { language: "es-ES" }).map(
        (run) => run.text,
      ),
      ["¿Qué tal?", "¿Bien?"],
    );
  });

  it("cleans parts that a phrase spans as one run", () => {
    assert.deepEqual(
      cleanParts(["we moved to new", "york last year"], CONTEXT),
      [{ first: 0, last: 1, text: "We moved to New York last year." }],
    );
    assert.deepEqual(
      cleanParts(["please", "insert", "my", "address", "thanks"], CONTEXT),
      [
        { first: 0, last: 0, text: "Please" },
        { first: 1, last: 3, text: "1 Main Street, Paris" },
        { first: 4, last: 4, text: "thanks." },
      ],
    );
    // A repeated word and a two-word filler said across two parts.
    assert.deepEqual(cleanParts(["i think the", "the plan works"]), [
      { first: 0, last: 1, text: "I think the plan works." },
    ]);
    assert.deepEqual(
      cleanParts(["c'est du", "coup, réglé"], { language: "fr-FR" }),
      [{ first: 0, last: 1, text: "C'est réglé." }],
    );
  });

  it("cleans together what spans more words than the quick pass sees", () => {
    // Fillers sit between the two copies of a repeated word.
    assert.deepEqual(cleanParts(["so the", "um uh um the plan is ready"]), [
      { first: 0, last: 1, text: "So the plan is ready." },
    ]);
    assert.deepEqual(
      cleanParts(["creo que el", "eh eh eh el plan"], { language: "es-ES" }),
      [{ first: 0, last: 1, text: "Creo que el plan." }],
    );
    // A phrase that overlaps itself, paired from far before the boundary.
    const laugh = {
      dictionary: [{ id: "d1", spoken: "ha ha", replacement: "haha" }],
      snippets: [
        { id: "s1", trigger: "insert my address", body: "1 Main Street" },
      ],
    };
    assert.deepEqual(
      cleanParts(["it was so funny ha ha ha ha ha", "ha anyway"], laugh)
        .map((run) => run.text)
        .join(" "),
      // "ha ha" × 3 is "haha haha haha", and the repeats collapse.
      "It was so funny haha anyway.",
    );
    // A replacement that a later phrase goes on from.
    const chained = {
      snippets: [
        { id: "s1", trigger: "insert my home address", body: "1 Main Street" },
      ],
      dictionary: [
        {
          id: "d1",
          spoken: "street and then go",
          replacement: "Street, then go",
        },
      ],
    };
    assert.deepEqual(
      cleanParts(["insert my home address and then", "go"], chained),
      [{ first: 0, last: 1, text: "1 Main Street, then go." }],
    );
  });

  it("keeps a dollar sign in a replacement as it is", () => {
    const dictionary = [
      { id: "d1", spoken: "one hundred dollars", replacement: "$100" },
      { id: "d2", spoken: "the match", replacement: "$& and $'" },
    ];
    assert.equal(
      cleanTranscript("it costs one hundred dollars", { dictionary }),
      "It costs $100.",
    );
    assert.equal(applyDictionary("see the match", dictionary), "see $& and $'");
    assert.equal(
      expandSnippets("pay sign off", [
        { id: "s1", trigger: "sign off", body: "$1 Sam" },
      ]),
      "pay $1 Sam",
    );
  });

  it("leaves parts apart when no phrase spans them", () => {
    assert.deepEqual(
      cleanParts(["deploy to cube", "now"], CONTEXT).map((run) => run.text),
      ["Deploy to Kube", "now."],
    );
    // Words a language says twice stay apart, as they stay in the note.
    assert.equal(cleanParts(["he had", "had enough"]).length, 2);
  });

  it("drops parts left empty and joins a part that opens with a mark", () => {
    assert.deepEqual(cleanParts(["it works.", "um", "next part"]), [
      { first: 0, last: 0, text: "It works." },
      { first: 2, last: 2, text: "Next part." },
    ]);
    assert.deepEqual(cleanParts(["we start", ", then stop"]), [
      { first: 0, last: 1, text: "We start, then stop." },
    ]);
    assert.deepEqual(cleanParts(["", "  ", "um"]), []);
    assert.deepEqual(cleanParts([]), []);
  });

  it("reads as cleanTranscript of the whole transcript", () => {
    // A seeded generator, so a failure names its case.
    let seed = 12_345;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const vocabulary = [
      "um",
      "uh",
      "um",
      "euh",
      "eh",
      "du",
      "coup,",
      "the",
      "the",
      "the",
      "had",
      "new",
      "york",
      "sam",
      "lect",
      "cube",
      "insert",
      "my",
      "address",
      "sign",
      "off",
      "ha",
      "ha",
      "ha",
      "we",
      "ship",
      "friday",
      "ok.",
      "really?",
      "yes!",
      "and",
      ",",
      "i",
      "think",
      "là",
      "là",
      "el",
      "el",
    ];
    const laughs = [{ id: "d9", spoken: "ha ha", replacement: "haha" }];
    for (let round = 0; round < 1_500; round += 1) {
      const words = Array.from(
        { length: 1 + Math.floor(next() * 20) },
        () => vocabulary[Math.floor(next() * vocabulary.length)] ?? "",
      );
      const parts: string[] = [];
      for (const word of words) {
        if (parts.length === 0 || next() < 0.4) parts.push(word);
        else parts[parts.length - 1] += ` ${word}`;
      }
      const language = ["en-US", "fr-FR", "es-ES"][round % 3] ?? "en-US";
      const context = {
        ...CONTEXT,
        dictionary: round % 2 ? [...DICTIONARY, ...laughs] : DICTIONARY,
        language,
      };
      const runs = cleanParts(parts, context);
      const label = JSON.stringify(parts);
      assert.equal(
        runs.map((run) => run.text).join(" "),
        cleanTranscript(parts.join(" "), context),
        label,
      );
      let after = -1;
      for (const run of runs) {
        assert.ok(run.first > after && run.last >= run.first, label);
        assert.ok(run.last < parts.length && run.text !== "", label);
        after = run.last;
      }
    }
  });

  it("cleans a long dictation with many phrases quickly enough", () => {
    const dictionary = Array.from({ length: 60 }, (_, index) => ({
      id: `d${index}`,
      spoken: `word${index} and more`,
      replacement: `Word${index}`,
    }));
    const parts = Array.from(
      { length: 2_000 },
      (_, index) => `um part ${index} has word${index % 60} and more of it`,
    );
    const started = Date.now();
    const runs = cleanParts(parts, { dictionary });
    assert.equal(runs.length, 2_000);
    assert.equal(
      runs.map((run) => run.text).join(" "),
      cleanTranscript(parts.join(" "), { dictionary }),
    );
    // Generous for CI; it takes a fraction of this here.
    assert.ok(Date.now() - started < 20_000);
  });
});
