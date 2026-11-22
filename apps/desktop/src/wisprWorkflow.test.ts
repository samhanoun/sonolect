import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  applyDictionary,
  buildInsertionPlan,
  expandSnippets,
  isOnboardingComplete,
  normalizeDictionaryEntry,
  normalizeSnippet,
  onboardingProgress,
  polishDictation,
} from "./wisprWorkflow";

describe("Wispr-style dictation workflow helpers", () => {
  it("polishes raw speech by removing filler words and adding sentence punctuation", () => {
    assert.equal(
      polishDictation("um please send this to sam you know it is ready"),
      "Please send this to sam you know it is ready.",
    );
  });

  it("applies personal dictionary entries before insertion", () => {
    assert.equal(
      polishDictation("send it to ismail hanoun", {
        dictionary: [
          { id: "1", spoken: "ismail hanoun", replacement: "Ismail Hanoun" },
        ],
      }),
      "Send it to Ismail Hanoun.",
    );
  });

  it("applies entries that start or end with an accented letter or a symbol", () => {
    const entry = (spoken: string, replacement: string) => ({
      id: spoken,
      spoken,
      replacement,
    });
    assert.equal(
      applyDictionary("je bois un café ce matin", [
        entry("café", "Café Lumière"),
      ]),
      "je bois un Café Lumière ce matin",
    );
    assert.equal(
      applyDictionary("Éric est là, éric aussi", [
        entry("Éric", "Eric Dupont"),
      ]),
      "Eric Dupont est là, Eric Dupont aussi",
    );
    assert.equal(
      applyDictionary("I write C++ daily. C++.", [entry("C++", "C plus plus")]),
      "I write C plus plus daily. C plus plus.",
    );
    assert.equal(
      polishDictation("je bois un café", {
        dictionary: [entry("café", "Café Lumière")],
      }),
      "Je bois un Café Lumière.",
    );
  });

  it("only replaces whole words, in any script", () => {
    const entries = [{ id: "1", spoken: "café", replacement: "X" }];
    assert.equal(
      applyDictionary("cafés, décafé et café", entries),
      "cafés, décafé et X",
    );
    // A combining accent is part of the word before it.
    assert.equal(
      applyDictionary("café", [{ id: "2", spoken: "cafe", replacement: "X" }]),
      "café",
    );
    assert.equal(
      applyDictionary("sonolectx sonolect_ sonolect", [
        { id: "3", spoken: "sonolect", replacement: "Sonolect" },
      ]),
      "sonolectx sonolect_ Sonolect",
    );
  });

  it("expands slash snippets inside polished dictation", () => {
    assert.equal(
      expandSnippets("Please add /sig", [
        { id: "s1", trigger: "/sig", body: "Best, Ismail" },
      ]),
      "Please add Best, Ismail",
    );
  });

  it("normalizes dictionary entries and snippet triggers", () => {
    const entry = normalizeDictionaryEntry({
      id: "d",
      spoken: " flow ",
      replacement: " Wispr Flow ",
    });
    assert.deepEqual(entry, {
      id: "d",
      spoken: "flow",
      replacement: "Wispr Flow",
    });
    const snippet = normalizeSnippet({
      id: "s",
      trigger: "thanks",
      body: "Thank you!",
    });
    assert.deepEqual(snippet, {
      id: "s",
      trigger: "/thanks",
      body: "Thank you!",
    });
  });

  it("chooses native insertion before clipboard fallback when active app automation is available", () => {
    assert.deepEqual(buildInsertionPlan(" hello world ", true, true), {
      method: "native-insert",
      text: "hello world",
      status: "Inserted polished dictation into the active app.",
    });
  });

  it("chooses clipboard fallback insertion when active app automation is unavailable", () => {
    assert.deepEqual(buildInsertionPlan(" hello world ", true), {
      method: "clipboard-fallback",
      text: "hello world",
      status:
        "Copied polished dictation to clipboard. Paste into the app you were using.",
    });
  });

  it("tracks onboarding completion across mic, shortcut, Whisper, and privacy setup", () => {
    const checklist = {
      micPermission: true,
      shortcutPrimer: true,
      whisperSetup: false,
      privacyChoice: true,
    };
    assert.equal(onboardingProgress(checklist), 75);
    assert.equal(isOnboardingComplete(checklist), false);
    assert.equal(
      isOnboardingComplete({ ...checklist, whisperSetup: true }),
      true,
    );
  });
});
