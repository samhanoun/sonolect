import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
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
