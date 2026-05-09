import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  matchVoiceCommand,
  applyVoiceCommand,
  stripCommandFromText,
  VOICE_COMMANDS,
} from "./voiceCommands";

describe("matchVoiceCommand", () => {
  it("matches delete that at end of text", () => {
    const result = matchVoiceCommand("hello world delete that");
    assert.notEqual(result, null);
    assert.equal(result!.name, "delete that");
  });

  it("matches undo that", () => {
    const result = matchVoiceCommand("some text undo that");
    assert.notEqual(result, null);
    assert.equal(result!.name, "undo that");
  });

  it("matches redo that", () => {
    const result = matchVoiceCommand("some text redo that");
    assert.notEqual(result, null);
    assert.equal(result!.name, "redo that");
  });

  it("matches new line", () => {
    const result = matchVoiceCommand("hello new line");
    assert.notEqual(result, null);
    assert.equal(result!.name, "new line");
  });

  it("matches new paragraph", () => {
    const result = matchVoiceCommand("hello new paragraph");
    assert.notEqual(result, null);
    assert.equal(result!.name, "new paragraph");
  });

  it("matches bold that", () => {
    const result = matchVoiceCommand("important bold that");
    assert.notEqual(result, null);
    assert.equal(result!.name, "bold that");
  });

  it("matches italic that", () => {
    const result = matchVoiceCommand("emphasis italic that");
    assert.notEqual(result, null);
    assert.equal(result!.name, "italic that");
  });

  it("matches capitalize that", () => {
    const result = matchVoiceCommand("word capitalize that");
    assert.notEqual(result, null);
    assert.equal(result!.name, "capitalize that");
  });

  it("matches uppercase that", () => {
    const result = matchVoiceCommand("warning uppercase that");
    assert.notEqual(result, null);
    assert.equal(result!.name, "uppercase that");
  });

  it("matches lowercase that", () => {
    const result = matchVoiceCommand("TEXT lowercase that");
    assert.notEqual(result, null);
    assert.equal(result!.name, "lowercase that");
  });

  it("matches period", () => {
    const result = matchVoiceCommand("end of sentence period");
    assert.notEqual(result, null);
    assert.equal(result!.name, "period");
  });

  it("matches comma", () => {
    const result = matchVoiceCommand("hello comma");
    assert.notEqual(result, null);
    assert.equal(result!.name, "comma");
  });

  it("matches question mark", () => {
    const result = matchVoiceCommand("how are you question mark");
    assert.notEqual(result, null);
    assert.equal(result!.name, "question mark");
  });

  it("matches exclamation mark", () => {
    const result = matchVoiceCommand("wow exclamation mark");
    assert.notEqual(result, null);
    assert.equal(result!.name, "exclamation mark");
  });

  it("matches colon", () => {
    const result = matchVoiceCommand("note colon");
    assert.notEqual(result, null);
    assert.equal(result!.name, "colon");
  });

  it("matches semicolon", () => {
    const result = matchVoiceCommand("clause semicolon");
    assert.notEqual(result, null);
    assert.equal(result!.name, "semicolon");
  });

  it("matches open quote", () => {
    const result = matchVoiceCommand("he said open quote");
    assert.notEqual(result, null);
    assert.equal(result!.name, "open quote");
  });

  it("matches close quote", () => {
    const result = matchVoiceCommand("hello close quote");
    assert.notEqual(result, null);
    assert.equal(result!.name, "close quote");
  });

  it("matches select all", () => {
    const result = matchVoiceCommand("select all");
    assert.notEqual(result, null);
    assert.equal(result!.name, "select all");
  });

  it("is case insensitive", () => {
    const result = matchVoiceCommand("hello DELETE THAT");
    assert.notEqual(result, null);
    assert.equal(result!.name, "delete that");
  });

  it("returns null for non-matching text", () => {
    const result = matchVoiceCommand("just regular speech");
    assert.equal(result, null);
  });

  it("does not match command in middle of sentence", () => {
    const result = matchVoiceCommand("delete that is not the end here");
    assert.equal(result, null);
  });

  it("does not false match period inside a word", () => {
    const result = matchVoiceCommand("periodic table");
    assert.equal(result, null);
  });

  it("does not false match colon inside a word", () => {
    const result = matchVoiceCommand("colonnade");
    assert.equal(result, null);
  });
});

describe("applyVoiceCommand", () => {
  function findCommand(name: string) {
    return VOICE_COMMANDS.find((c) => c.name === name)!;
  }

  it("delete that removes last segment", () => {
    const result = applyVoiceCommand(
      "first sentence. second part",
      findCommand("delete that"),
    );
    assert.equal(result, "first sentence. ");
  });

  it("new line inserts newline", () => {
    const result = applyVoiceCommand("hello", findCommand("new line"));
    assert.equal(result, "hello\n");
  });

  it("new paragraph inserts double newline", () => {
    const result = applyVoiceCommand("hello", findCommand("new paragraph"));
    assert.equal(result, "hello\n\n");
  });

  it("bold wraps last segment", () => {
    const result = applyVoiceCommand(
      "first. important",
      findCommand("bold that"),
    );
    assert.equal(result, "first. **important**");
  });

  it("italic wraps last segment", () => {
    const result = applyVoiceCommand(
      "first. emphasis",
      findCommand("italic that"),
    );
    assert.equal(result, "first. *emphasis*");
  });

  it("capitalize that capitalizes last word", () => {
    const result = applyVoiceCommand(
      "hello world",
      findCommand("capitalize that"),
    );
    assert.equal(result, "hello World");
  });

  it("uppercase that uppercases last segment", () => {
    const result = applyVoiceCommand(
      "first. warning",
      findCommand("uppercase that"),
    );
    assert.equal(result, "first. WARNING");
  });

  it("lowercase that lowercases last segment", () => {
    const result = applyVoiceCommand(
      "first. HELLO",
      findCommand("lowercase that"),
    );
    assert.equal(result, "first. hello");
  });

  it("period inserts period", () => {
    const result = applyVoiceCommand("done", findCommand("period"));
    assert.equal(result, "done.");
  });

  it("comma inserts comma", () => {
    const result = applyVoiceCommand("hello", findCommand("comma"));
    assert.equal(result, "hello,");
  });

  it("question mark inserts question mark", () => {
    const result = applyVoiceCommand("really", findCommand("question mark"));
    assert.equal(result, "really?");
  });

  it("exclamation mark inserts exclamation mark", () => {
    const result = applyVoiceCommand("wow", findCommand("exclamation mark"));
    assert.equal(result, "wow!");
  });

  it("colon inserts colon", () => {
    const result = applyVoiceCommand("note", findCommand("colon"));
    assert.equal(result, "note:");
  });

  it("semicolon inserts semicolon", () => {
    const result = applyVoiceCommand("clause", findCommand("semicolon"));
    assert.equal(result, "clause;");
  });

  it("open quote inserts opening quote", () => {
    const result = applyVoiceCommand("he said", findCommand("open quote"));
    assert.equal(result, 'he said"');
  });

  it("close quote inserts closing quote", () => {
    const result = applyVoiceCommand("hello", findCommand("close quote"));
    assert.equal(result, 'hello"');
  });

  it("undo returns text unchanged", () => {
    const result = applyVoiceCommand("hello", findCommand("undo that"));
    assert.equal(result, "hello");
  });

  it("redo returns text unchanged", () => {
    const result = applyVoiceCommand("hello", findCommand("redo that"));
    assert.equal(result, "hello");
  });

  it("select all returns text unchanged", () => {
    const result = applyVoiceCommand("hello", findCommand("select all"));
    assert.equal(result, "hello");
  });
});

describe("stripCommandFromText", () => {
  function findCommand(name: string) {
    return VOICE_COMMANDS.find((c) => c.name === name)!;
  }

  it("strips delete that from end", () => {
    const result = stripCommandFromText(
      "hello world delete that",
      findCommand("delete that"),
    );
    assert.equal(result, "hello world");
  });

  it("strips bold that from end", () => {
    const result = stripCommandFromText(
      "important bold that",
      findCommand("bold that"),
    );
    assert.equal(result, "important");
  });

  it("strips period from end", () => {
    const result = stripCommandFromText(
      "end of sentence period",
      findCommand("period"),
    );
    assert.equal(result, "end of sentence");
  });

  it("strips new paragraph from end", () => {
    const result = stripCommandFromText(
      "hello new paragraph",
      findCommand("new paragraph"),
    );
    assert.equal(result, "hello");
  });

  it("strips question mark from end", () => {
    const result = stripCommandFromText(
      "how are you question mark",
      findCommand("question mark"),
    );
    assert.equal(result, "how are you");
  });

  it("handles text that is only the command", () => {
    const result = stripCommandFromText(
      "select all",
      findCommand("select all"),
    );
    assert.equal(result, "");
  });
});
