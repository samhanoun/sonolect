import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useReaderStore } from "./readerStore";
import type { ParsedDocument } from "./documentParser";

function makeParsed(rawText: string): ParsedDocument {
  return {
    title: "Test",
    type: "text",
    content: rawText,
    sections: [],
    metadata: {
      wordCount: rawText.split(/\s+/).length,
      estimatedReadTimeMinutes: 1,
    },
    rawText,
  };
}

const initialState = useReaderStore.getState();

describe("readerStore", () => {
  beforeEach(() => {
    useReaderStore.setState({ ...initialState }, true);
  });

  describe("initial state", () => {
    it("has empty documents", () => {
      const state = useReaderStore.getState();
      assert.deepEqual(state.documents, []);
    });

    it("has no active document", () => {
      const state = useReaderStore.getState();
      assert.equal(state.activeDocumentId, null);
    });

    it("has idle playback", () => {
      const state = useReaderStore.getState();
      assert.equal(state.playback.status, "idle");
    });

    it("has empty sentences", () => {
      const state = useReaderStore.getState();
      assert.deepEqual(state.sentences, []);
    });

    it("has empty bookmarks", () => {
      const state = useReaderStore.getState();
      assert.deepEqual(state.bookmarks, []);
    });

    it("has default speed of 1", () => {
      const state = useReaderStore.getState();
      assert.equal(state.speed, 1);
    });

    it("has empty selectedVoiceId", () => {
      const state = useReaderStore.getState();
      assert.equal(state.selectedVoiceId, "");
    });
  });

  describe("addDocument", () => {
    it("creates a document entry with an id", () => {
      useReaderStore
        .getState()
        .addDocument("test.txt", makeParsed("Hello world."));
      const state = useReaderStore.getState();
      assert.equal(state.documents.length, 1);
      assert.ok(state.documents[0]!.id.length > 0);
      assert.equal(state.documents[0]!.fileName, "test.txt");
    });

    it("sets the new document as active", () => {
      useReaderStore
        .getState()
        .addDocument("test.txt", makeParsed("Hello world."));
      const state = useReaderStore.getState();
      assert.equal(state.activeDocumentId, state.documents[0]!.id);
    });

    it("splits sentences from the document", () => {
      useReaderStore
        .getState()
        .addDocument(
          "test.txt",
          makeParsed("First sentence. Second sentence."),
        );
      const state = useReaderStore.getState();
      assert.equal(state.sentences.length, 2);
      assert.equal(state.sentences[0], "First sentence.");
      assert.equal(state.sentences[1], "Second sentence.");
    });

    it("resets currentSentenceIndex to 0", () => {
      useReaderStore.setState({ currentSentenceIndex: 5 });
      useReaderStore.getState().addDocument("test.txt", makeParsed("Hello."));
      assert.equal(useReaderStore.getState().currentSentenceIndex, 0);
    });

    it("updates totalSentences in playback", () => {
      useReaderStore
        .getState()
        .addDocument("test.txt", makeParsed("One. Two. Three."));
      assert.equal(useReaderStore.getState().playback.totalSentences, 3);
    });

    it("sets addedAt timestamp", () => {
      useReaderStore.getState().addDocument("test.txt", makeParsed("Hello."));
      const doc = useReaderStore.getState().documents[0]!;
      assert.ok(doc.addedAt);
      assert.ok(!isNaN(Date.parse(doc.addedAt)));
    });
  });

  describe("removeDocument", () => {
    it("removes a document by id", () => {
      useReaderStore.getState().addDocument("a.txt", makeParsed("A."));
      useReaderStore.getState().addDocument("b.txt", makeParsed("B."));
      const idToRemove = useReaderStore.getState().documents[0]!.id;
      useReaderStore.getState().removeDocument(idToRemove);
      const state = useReaderStore.getState();
      assert.equal(state.documents.length, 1);
      assert.notEqual(state.documents[0]!.id, idToRemove);
    });

    it("clears active document when removing the active one", () => {
      useReaderStore.getState().addDocument("a.txt", makeParsed("A."));
      const id = useReaderStore.getState().documents[0]!.id;
      useReaderStore.getState().removeDocument(id);
      const state = useReaderStore.getState();
      assert.equal(state.activeDocumentId, null);
      assert.deepEqual(state.sentences, []);
      assert.equal(state.currentSentenceIndex, 0);
    });

    it("keeps active document when removing a different one", () => {
      useReaderStore.getState().addDocument("a.txt", makeParsed("A."));
      const firstId = useReaderStore.getState().documents[0]!.id;
      useReaderStore.getState().addDocument("b.txt", makeParsed("B."));
      const activeId = useReaderStore.getState().activeDocumentId;
      useReaderStore.getState().removeDocument(firstId);
      assert.equal(useReaderStore.getState().activeDocumentId, activeId);
    });
  });

  describe("setActiveDocument", () => {
    it("switches active document", () => {
      useReaderStore.getState().addDocument("a.txt", makeParsed("A sentence."));
      const firstId = useReaderStore.getState().documents[0]!.id;
      useReaderStore.getState().addDocument("b.txt", makeParsed("B sentence."));
      useReaderStore.getState().setActiveDocument(firstId);
      assert.equal(useReaderStore.getState().activeDocumentId, firstId);
    });

    it("re-splits sentences for the new active document", () => {
      useReaderStore
        .getState()
        .addDocument("a.txt", makeParsed("Alpha. Beta."));
      const firstId = useReaderStore.getState().documents[0]!.id;
      useReaderStore.getState().addDocument("b.txt", makeParsed("Gamma."));
      assert.equal(useReaderStore.getState().sentences.length, 1);
      useReaderStore.getState().setActiveDocument(firstId);
      assert.equal(useReaderStore.getState().sentences.length, 2);
      assert.equal(useReaderStore.getState().sentences[0], "Alpha.");
    });

    it("resets currentSentenceIndex to 0", () => {
      useReaderStore.getState().addDocument("a.txt", makeParsed("X."));
      const firstId = useReaderStore.getState().documents[0]!.id;
      useReaderStore.getState().addDocument("b.txt", makeParsed("Y."));
      useReaderStore.setState({ currentSentenceIndex: 5 });
      useReaderStore.getState().setActiveDocument(firstId);
      assert.equal(useReaderStore.getState().currentSentenceIndex, 0);
    });

    it("does nothing for unknown id", () => {
      useReaderStore.getState().addDocument("a.txt", makeParsed("A."));
      const before = useReaderStore.getState().activeDocumentId;
      useReaderStore.getState().setActiveDocument("nonexistent");
      assert.equal(useReaderStore.getState().activeDocumentId, before);
    });
  });

  describe("setSelectedVoice", () => {
    it("updates voiceId", () => {
      useReaderStore.getState().setSelectedVoice("edge-en-US-AriaNeural");
      assert.equal(
        useReaderStore.getState().selectedVoiceId,
        "edge-en-US-AriaNeural",
      );
    });
  });

  describe("setSpeed", () => {
    it("updates speed", () => {
      useReaderStore.getState().setSpeed(1.5);
      assert.equal(useReaderStore.getState().speed, 1.5);
    });
  });

  describe("setCurrentSentence", () => {
    it("updates the sentence index", () => {
      useReaderStore.getState().setCurrentSentence(7);
      assert.equal(useReaderStore.getState().currentSentenceIndex, 7);
    });
  });

  describe("updatePlaybackStatus", () => {
    it("changes playback status", () => {
      useReaderStore.getState().updatePlaybackStatus("speaking");
      assert.equal(useReaderStore.getState().playback.status, "speaking");
    });

    it("preserves other playback fields", () => {
      useReaderStore.getState().addDocument("a.txt", makeParsed("One. Two."));
      const totalBefore = useReaderStore.getState().playback.totalSentences;
      useReaderStore.getState().updatePlaybackStatus("paused");
      assert.equal(
        useReaderStore.getState().playback.totalSentences,
        totalBefore,
      );
      assert.equal(useReaderStore.getState().playback.status, "paused");
    });
  });

  describe("addBookmark", () => {
    it("creates a bookmark at the current position", () => {
      useReaderStore
        .getState()
        .addDocument("a.txt", makeParsed("Hello. World."));
      useReaderStore.getState().setCurrentSentence(1);
      useReaderStore.getState().addBookmark("Important");
      const state = useReaderStore.getState();
      assert.equal(state.bookmarks.length, 1);
      assert.equal(state.bookmarks[0]!.label, "Important");
      assert.equal(state.bookmarks[0]!.sentenceIndex, 1);
      assert.equal(state.bookmarks[0]!.documentId, state.activeDocumentId);
    });

    it("has a createdAt timestamp", () => {
      useReaderStore.getState().addDocument("a.txt", makeParsed("Hello."));
      useReaderStore.getState().addBookmark("Test");
      const bookmark = useReaderStore.getState().bookmarks[0]!;
      assert.ok(bookmark.createdAt);
      assert.ok(!isNaN(Date.parse(bookmark.createdAt)));
    });

    it("does nothing without an active document", () => {
      useReaderStore.getState().addBookmark("Orphan");
      assert.equal(useReaderStore.getState().bookmarks.length, 0);
    });
  });

  describe("removeBookmark", () => {
    it("removes a bookmark by index", () => {
      useReaderStore.getState().addDocument("a.txt", makeParsed("Hello."));
      useReaderStore.getState().addBookmark("First");
      useReaderStore.getState().addBookmark("Second");
      useReaderStore.getState().removeBookmark(0);
      const state = useReaderStore.getState();
      assert.equal(state.bookmarks.length, 1);
      assert.equal(state.bookmarks[0]!.label, "Second");
    });
  });
});
