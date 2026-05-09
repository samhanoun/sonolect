import React, { useRef, useEffect, useState, useCallback } from "react";
import { useReaderStore } from "./readerStore";
import {
  parseDocument,
  detectDocumentType,
  splitIntoSentences,
} from "./documentParser";
import { speakWithBrowserTts, stopTts, pauseTts, resumeTts } from "./ttsEngine";
import {
  getAllVoices,
  getVoicesForLanguage,
  findVoiceById,
  type VoiceEntry,
} from "./voiceCatalog";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const ACCEPTED_TYPES = ".pdf,.docx,.doc,.md,.markdown,.txt";

const COLORS = {
  bg: "#0d0d1a",
  panel: "#16162a",
  card: "#1a1a2e",
  cardHover: "#2d2b55",
  accent: "#6c5ce7",
  accentDim: "rgba(108, 92, 231, 0.2)",
  text: "#e0e0e0",
  muted: "#888",
  border: "rgba(108, 92, 231, 0.3)",
  borderMuted: "rgba(136, 136, 136, 0.2)",
};

function estimateRemainingTime(
  currentIndex: number,
  totalSentences: number,
  speed: number,
): string {
  const remaining = totalSentences - currentIndex;
  const avgWordsPerSentence = 15;
  const wordsPerMinute = 150 * speed;
  const minutes = (remaining * avgWordsPerSentence) / wordsPerMinute;
  if (minutes < 1) return "<1 min remaining";
  return `~${Math.ceil(minutes)} min remaining`;
}

export function ReaderView() {
  const store = useReaderStore();
  const sentenceRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [voiceLangFilter, setVoiceLangFilter] = useState("all");
  const [availableVoices, setAvailableVoices] = useState<VoiceEntry[]>([]);
  const playingRef = useRef(false);

  useEffect(() => {
    setAvailableVoices(getAllVoices());
  }, []);

  useEffect(() => {
    const el = sentenceRefs.current.get(store.currentSentenceIndex);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [store.currentSentenceIndex]);

  const handleFileRead = useCallback(
    async (file: File) => {
      const isText = /\.(txt|text|md|markdown)$/i.test(file.name);
      const data = isText ? await file.text() : await file.arrayBuffer();
      const parsed = await parseDocument(file.name, data);
      store.addDocument(file.name, parsed);
    },
    [store],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileRead(file);
      if (e.target) e.target.value = "";
    },
    [handleFileRead],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileRead(file);
    },
    [handleFileRead],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const speakFrom = useCallback((index: number) => {
    const s = useReaderStore.getState();
    if (!playingRef.current || index >= s.sentences.length) {
      useReaderStore.getState().updatePlaybackStatus("idle");
      playingRef.current = false;
      return;
    }
    s.setCurrentSentence(index);
    const voice = findVoiceById(s.selectedVoiceId);
    speakWithBrowserTts(s.sentences[index]!, voice?.name ?? "", s.speed, () =>
      speakFrom(index + 1),
    );
  }, []);

  const handlePlay = useCallback(() => {
    if (store.playback.status === "speaking") {
      pauseTts();
      store.updatePlaybackStatus("paused");
      playingRef.current = false;
      return;
    }

    if (store.playback.status === "paused") {
      resumeTts();
      store.updatePlaybackStatus("speaking");
      playingRef.current = true;
      return;
    }

    if (store.sentences.length === 0) return;

    playingRef.current = true;
    store.updatePlaybackStatus("speaking");
    speakFrom(store.currentSentenceIndex);
  }, [store, speakFrom]);

  const handleStop = useCallback(() => {
    stopTts();
    playingRef.current = false;
    store.updatePlaybackStatus("idle");
    store.setCurrentSentence(0);
  }, [store]);

  const handleSkipBack = useCallback(() => {
    const newIndex = Math.max(0, store.currentSentenceIndex - 5);
    store.setCurrentSentence(newIndex);
    if (store.playback.status === "speaking") {
      stopTts();
      playingRef.current = true;
      store.updatePlaybackStatus("speaking");
      speakFrom(newIndex);
    }
  }, [store, speakFrom]);

  const handleSkipForward = useCallback(() => {
    const newIndex = Math.min(
      store.sentences.length - 1,
      store.currentSentenceIndex + 5,
    );
    store.setCurrentSentence(newIndex);
    if (store.playback.status === "speaking") {
      stopTts();
      playingRef.current = true;
      store.updatePlaybackStatus("speaking");
      speakFrom(newIndex);
    }
  }, [store, speakFrom]);

  const handleSentenceClick = useCallback(
    (index: number) => {
      store.setCurrentSentence(index);
      if (store.playback.status === "speaking") {
        stopTts();
        playingRef.current = true;
        speakFrom(index);
      }
    },
    [store, speakFrom],
  );

  const handleVoicePreview = useCallback((voice: VoiceEntry) => {
    speakWithBrowserTts(
      "Hello, this is a preview of this voice.",
      voice.name,
      1,
      () => {},
    );
  }, []);

  const handleBookmark = useCallback(() => {
    const label = `Sentence ${store.currentSentenceIndex + 1}`;
    store.addBookmark(label);
  }, [store]);

  const progressPercent =
    store.sentences.length > 0
      ? (store.currentSentenceIndex / store.sentences.length) * 100
      : 0;

  const activeDoc = store.documents.find(
    (d) => d.id === store.activeDocumentId,
  );

  const languages = Array.from(
    new Set(availableVoices.map((v) => v.languageCode)),
  ).sort();

  const filteredVoices = availableVoices.filter((v) => {
    const matchSearch =
      voiceSearch === "" ||
      v.displayName.toLowerCase().includes(voiceSearch.toLowerCase()) ||
      v.language.toLowerCase().includes(voiceSearch.toLowerCase()) ||
      v.name.toLowerCase().includes(voiceSearch.toLowerCase());
    const matchLang =
      voiceLangFilter === "all" || v.languageCode === voiceLangFilter;
    return matchSearch && matchLang;
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100%",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: "12px 24px",
          background: COLORS.panel,
          borderBottom: `1px solid ${COLORS.borderMuted}`,
          flexShrink: 0,
        }}
      >
        <button
          onClick={handleSkipBack}
          style={{
            background: "transparent",
            border: "none",
            color: COLORS.text,
            fontSize: 18,
            cursor: "pointer",
            padding: "8px 12px",
            borderRadius: 8,
          }}
          title="Skip back 5 sentences"
        >
          &#9664;&#9664;
        </button>

        <button
          onClick={handlePlay}
          style={{
            background: COLORS.accent,
            border: "none",
            color: "#fff",
            fontSize: 22,
            cursor: "pointer",
            width: 56,
            height: 56,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 20px ${COLORS.accentDim}`,
          }}
        >
          {store.playback.status === "speaking" ? "⏸" : "▶"}
        </button>

        <button
          onClick={handleSkipForward}
          style={{
            background: "transparent",
            border: "none",
            color: COLORS.text,
            fontSize: 18,
            cursor: "pointer",
            padding: "8px 12px",
            borderRadius: 8,
          }}
          title="Skip forward 5 sentences"
        >
          &#9654;&#9654;
        </button>

        <button
          onClick={handleStop}
          style={{
            background: "transparent",
            border: `1px solid ${COLORS.border}`,
            color: COLORS.text,
            fontSize: 16,
            cursor: "pointer",
            padding: "8px 14px",
            borderRadius: 8,
          }}
        >
          &#9632; Stop
        </button>

        <div style={{ display: "flex", gap: 4, marginLeft: 16 }}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => store.setSpeed(s)}
              style={{
                background: store.speed === s ? COLORS.accent : COLORS.card,
                color: store.speed === s ? "#fff" : COLORS.text,
                border: "none",
                padding: "6px 10px",
                borderRadius: 20,
                fontSize: 12,
                cursor: "pointer",
                fontWeight: store.speed === s ? 700 : 400,
              }}
            >
              {s}x
            </button>
          ))}
        </div>

        <div
          style={{
            flex: 1,
            maxWidth: 300,
            marginLeft: 16,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            style={{
              height: 4,
              background: COLORS.card,
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progressPercent}%`,
                height: "100%",
                background: COLORS.accent,
                borderRadius: 2,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <span style={{ fontSize: 11, color: COLORS.muted }}>
            {store.sentences.length > 0
              ? estimateRemainingTime(
                  store.currentSentenceIndex,
                  store.sentences.length,
                  store.speed,
                )
              : "No document loaded"}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div
          style={{
            width: 260,
            background: COLORS.panel,
            borderRight: `1px solid ${COLORS.borderMuted}`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <div style={{ padding: "16px 12px 8px" }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: "100%",
                padding: "10px 0",
                background: COLORS.accent,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                marginBottom: 8,
              }}
            >
              Upload Document
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
          </div>

          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            style={{
              margin: "0 12px 12px",
              padding: 20,
              border: `2px dashed ${isDragging ? COLORS.accent : COLORS.border}`,
              borderRadius: 8,
              textAlign: "center",
              color: isDragging ? COLORS.accent : COLORS.muted,
              fontSize: 12,
              background: isDragging ? COLORS.accentDim : "transparent",
              transition: "border-color 0.2s, color 0.2s",
            }}
          >
            Drop files here
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "0 12px" }}>
            {store.documents.map((doc) => (
              <div
                key={doc.id}
                onClick={() => store.setActiveDocument(doc.id)}
                style={{
                  padding: "10px 12px",
                  marginBottom: 4,
                  borderRadius: 8,
                  background:
                    doc.id === store.activeDocumentId
                      ? COLORS.accentDim
                      : COLORS.card,
                  cursor: "pointer",
                  border:
                    doc.id === store.activeDocumentId
                      ? `1px solid ${COLORS.accent}`
                      : "1px solid transparent",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: COLORS.text,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}
                  >
                    {doc.fileName}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      store.removeDocument(doc.id);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: COLORS.muted,
                      cursor: "pointer",
                      fontSize: 14,
                      padding: "0 4px",
                      lineHeight: 1,
                    }}
                  >
                    &#10005;
                  </button>
                </div>
                <div
                  style={{ fontSize: 11, color: COLORS.muted, marginTop: 4 }}
                >
                  {doc.parsed.metadata.wordCount.toLocaleString()} words
                  &middot; {new Date(doc.addedAt).toLocaleDateString()}
                </div>
              </div>
            ))}
            {store.documents.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  color: COLORS.muted,
                  fontSize: 12,
                  padding: "24px 0",
                }}
              >
                No documents yet
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 32px",
            background: COLORS.bg,
          }}
        >
          {activeDoc ? (
            <>
              <h2
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  marginBottom: 20,
                  color: COLORS.text,
                }}
              >
                {activeDoc.parsed.title}
              </h2>
              <div style={{ lineHeight: 1.8 }}>
                {store.sentences.map((sentence, idx) => {
                  const isCurrent = idx === store.currentSentenceIndex;
                  const isRead = idx < store.currentSentenceIndex;
                  return (
                    <div
                      key={idx}
                      ref={(el) => {
                        if (el) sentenceRefs.current.set(idx, el);
                        else sentenceRefs.current.delete(idx);
                      }}
                      onClick={() => handleSentenceClick(idx)}
                      style={{
                        display: "inline",
                        padding: isCurrent ? "2px 4px" : "0 1px",
                        borderRadius: isCurrent ? 4 : 0,
                        background: isCurrent
                          ? COLORS.accentDim
                          : "transparent",
                        color: isRead ? COLORS.muted : COLORS.text,
                        cursor: "pointer",
                        transition: "background 0.2s, color 0.2s",
                        fontSize: 15,
                        borderLeft: isCurrent
                          ? `2px solid ${COLORS.accent}`
                          : "2px solid transparent",
                      }}
                    >
                      {sentence}{" "}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: COLORS.muted,
                fontSize: 16,
              }}
            >
              Upload or select a document to start reading
            </div>
          )}
        </div>

        <div
          style={{
            width: 280,
            background: COLORS.panel,
            borderLeft: `1px solid ${COLORS.borderMuted}`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <div style={{ padding: "16px 12px 8px" }}>
            <input
              type="text"
              placeholder="Search voices..."
              value={voiceSearch}
              onChange={(e) => setVoiceSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: COLORS.card,
                border: `1px solid ${COLORS.borderMuted}`,
                borderRadius: 8,
                color: COLORS.text,
                fontSize: 13,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <select
              value={voiceLangFilter}
              onChange={(e) => setVoiceLangFilter(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: COLORS.card,
                border: `1px solid ${COLORS.borderMuted}`,
                borderRadius: 8,
                color: COLORS.text,
                fontSize: 13,
                marginTop: 8,
                outline: "none",
                cursor: "pointer",
                boxSizing: "border-box",
              }}
            >
              <option value="all">All Languages</option>
              {languages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
            {filteredVoices.map((voice) => {
              const isSelected = store.selectedVoiceId === voice.id;
              return (
                <div
                  key={voice.id}
                  onClick={() => store.setSelectedVoice(voice.id)}
                  style={{
                    padding: "10px 12px",
                    marginBottom: 4,
                    borderRadius: 8,
                    background: isSelected ? COLORS.accentDim : COLORS.card,
                    border: isSelected
                      ? `1px solid ${COLORS.accent}`
                      : "1px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: COLORS.text,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {voice.displayName}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: COLORS.muted,
                          marginTop: 2,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span>{voice.language}</span>
                        <span>
                          {voice.gender === "male"
                            ? "♂"
                            : voice.gender === "female"
                              ? "♀"
                              : "⚥"}
                        </span>
                        <span
                          style={{
                            background: COLORS.cardHover,
                            padding: "1px 6px",
                            borderRadius: 4,
                            fontSize: 10,
                          }}
                        >
                          {voice.provider}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleVoicePreview(voice);
                      }}
                      style={{
                        background: COLORS.card,
                        border: `1px solid ${COLORS.border}`,
                        color: COLORS.text,
                        fontSize: 11,
                        padding: "4px 10px",
                        borderRadius: 6,
                        cursor: "pointer",
                        flexShrink: 0,
                        marginLeft: 8,
                      }}
                    >
                      Preview
                    </button>
                  </div>
                </div>
              );
            })}
            {filteredVoices.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  color: COLORS.muted,
                  fontSize: 12,
                  padding: "24px 0",
                }}
              >
                No voices found
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 24px",
          background: COLORS.panel,
          borderTop: `1px solid ${COLORS.borderMuted}`,
          fontSize: 12,
          color: COLORS.muted,
          flexShrink: 0,
        }}
      >
        <span>
          {store.sentences.length > 0
            ? `Sentence ${store.currentSentenceIndex + 1} / ${store.sentences.length}`
            : "No document"}
        </span>
        <span>
          {store.sentences.length > 0
            ? estimateRemainingTime(
                store.currentSentenceIndex,
                store.sentences.length,
                store.speed,
              )
            : ""}
        </span>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 200,
          }}
        >
          {activeDoc?.parsed.title || ""}
        </span>
        <button
          onClick={handleBookmark}
          disabled={!store.activeDocumentId}
          style={{
            background: "transparent",
            border: "none",
            color: store.activeDocumentId ? "#f1c40f" : COLORS.muted,
            fontSize: 18,
            cursor: store.activeDocumentId ? "pointer" : "default",
            padding: "0 4px",
          }}
          title="Bookmark current position"
        >
          &#9733;
        </button>
      </div>
    </div>
  );
}
