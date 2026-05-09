import { create } from "zustand";
import type { ParsedDocument, DocumentSection } from "./documentParser";
import type { TtsPlaybackState } from "./ttsEngine";
import type { VoiceEntry } from "./voiceCatalog";
import { splitIntoSentences } from "./documentParser";

export type { ParsedDocument, DocumentSection, TtsPlaybackState, VoiceEntry };

export type ReaderBookmark = {
  documentId: string;
  sentenceIndex: number;
  label: string;
  createdAt: string;
};

export type ReaderDocument = {
  id: string;
  fileName: string;
  addedAt: string;
  parsed: ParsedDocument;
};

export type ReaderState = {
  documents: ReaderDocument[];
  activeDocumentId: string | null;

  playback: TtsPlaybackState;
  selectedVoiceId: string;
  speed: number;

  currentSentenceIndex: number;
  sentences: string[];

  bookmarks: ReaderBookmark[];

  addDocument: (fileName: string, parsed: ParsedDocument) => void;
  removeDocument: (id: string) => void;
  setActiveDocument: (id: string) => void;
  setSelectedVoice: (voiceId: string) => void;
  setSpeed: (speed: number) => void;
  setCurrentSentence: (index: number) => void;
  updatePlaybackStatus: (status: TtsPlaybackState["status"]) => void;
  addBookmark: (label: string) => void;
  removeBookmark: (index: number) => void;
};

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function initialPlayback(): TtsPlaybackState {
  return {
    status: "idle",
    currentSentenceIndex: 0,
    totalSentences: 0,
    progress: 0,
    speed: 1,
    voiceId: "",
  };
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  documents: [],
  activeDocumentId: null,

  playback: initialPlayback(),
  selectedVoiceId: "",
  speed: 1,

  currentSentenceIndex: 0,
  sentences: [],

  bookmarks: [],

  addDocument: (fileName, parsed) => {
    const id = generateId();
    const doc: ReaderDocument = {
      id,
      fileName,
      addedAt: new Date().toISOString(),
      parsed,
    };
    const sentences = splitIntoSentences(parsed.rawText);
    set((state) => ({
      documents: [...state.documents, doc],
      activeDocumentId: id,
      sentences,
      currentSentenceIndex: 0,
      playback: {
        ...initialPlayback(),
        totalSentences: sentences.length,
      },
    }));
  },

  removeDocument: (id) => {
    set((state) => {
      const documents = state.documents.filter((d) => d.id !== id);
      if (state.activeDocumentId === id) {
        return {
          documents,
          activeDocumentId: null,
          sentences: [],
          currentSentenceIndex: 0,
          playback: initialPlayback(),
        };
      }
      return { documents };
    });
  },

  setActiveDocument: (id) => {
    const doc = get().documents.find((d) => d.id === id);
    if (!doc) return;
    const sentences = splitIntoSentences(doc.parsed.rawText);
    set({
      activeDocumentId: id,
      sentences,
      currentSentenceIndex: 0,
      playback: {
        ...initialPlayback(),
        totalSentences: sentences.length,
      },
    });
  },

  setSelectedVoice: (voiceId) => set({ selectedVoiceId: voiceId }),

  setSpeed: (speed) => set({ speed }),

  setCurrentSentence: (index) => set({ currentSentenceIndex: index }),

  updatePlaybackStatus: (status) =>
    set((state) => ({
      playback: { ...state.playback, status },
    })),

  addBookmark: (label) => {
    const { activeDocumentId, currentSentenceIndex } = get();
    if (!activeDocumentId) return;
    const bookmark: ReaderBookmark = {
      documentId: activeDocumentId,
      sentenceIndex: currentSentenceIndex,
      label,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({ bookmarks: [...state.bookmarks, bookmark] }));
  },

  removeBookmark: (index) => {
    set((state) => ({
      bookmarks: state.bookmarks.filter((_, i) => i !== index),
    }));
  },
}));
