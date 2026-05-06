import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useCompanionStore } from "../../src/store";
import {
  filterHistory,
  highlightMatches,
  searchTranscripts,
} from "../../src/searchAndFilter";
import type { SearchResult, TranscriptHistoryRow } from "../../src/searchAndFilter";

const palette = {
  background: "#08090A",
  surface: "#111317",
  surfaceMuted: "#181B21",
  border: "#2A2F38",
  primary: "#8B5CF6",
  primarySoft: "#A78BFA",
  success: "#22C55E",
  text: "#F4F4F5",
  textMuted: "#A1A1AA",
  warning: "#F59E0B",
};

type FilterMode = "all" | "recent" | "long";

/** Convert the store's TranscriptTurn[] to the SearchAndFilter module's row format. */
function turnsToRows(
  turns: ReturnType<typeof useCompanionStore.getState>["history"],
): TranscriptHistoryRow[] {
  return turns.map((t) => ({
    id: t.id,
    title: t.refinedText.slice(0, 60) || "Untitled",
    preview: t.refinedText.slice(0, 100),
    transcript: t.refinedText,
    timestamp: t.createdAt,
    duration: `${Math.round(t.durationMs / 1000)}s`,
    mode: t.mode,
    status: t.syncState,
    metadata: "",
    updatedAt: t.createdAt,
  }));
}

export default function SearchScreen() {
  const history = useCompanionStore((s) => s.history);
  const searchQuery = useCompanionStore((s) => s.searchQuery);
  const setSearchQuery = useCompanionStore((s) => s.setSearchQuery);

  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(() => turnsToRows(history), [history]);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (filterMode === "recent") {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      result = filterHistory(result, { dateFrom: weekAgo });
    } else if (filterMode === "long") {
      result = filterHistory(result, { minDuration: 60000 });
    }
    return result;
  }, [rows, filterMode]);

  const results: SearchResult[] = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchTranscripts(filteredRows, searchQuery);
  }, [filteredRows, searchQuery]);

  const selectedTurn = useMemo(
    () => history.find((t) => t.id === selectedId),
    [history, selectedId],
  );

  const renderResult = useCallback(
    ({ item }: { item: SearchResult }) => (
      <Pressable
        style={({ pressed }) => [
          styles.resultCard,
          selectedId === item.id && styles.resultCardActive,
          pressed && styles.pressed,
        ]}
        onPress={() => setSelectedId(item.id === selectedId ? null : item.id)}
      >
        <View style={styles.resultHeader}>
          <Text style={styles.resultTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.matchBadge}>{item.matchCount} matches</Text>
        </View>
        <Text style={styles.resultSnippet} numberOfLines={2}>
          {item.snippet}
        </Text>
      </Pressable>
    ),
    [selectedId],
  );

  const filters: { key: FilterMode; label: string }[] = [
    { key: "all", label: "All" },
    { key: "recent", label: "Last 7 days" },
    { key: "long", label: "> 1 min" },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Search transcripts..."
        placeholderTextColor={palette.textMuted}
        value={searchQuery}
        onChangeText={setSearchQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.filterRow}>
        {filters.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilterMode(f.key)}
            style={[
              styles.filterPill,
              filterMode === f.key && styles.filterPillActive,
            ]}
          >
            <Text
              style={[
                styles.filterText,
                filterMode === f.key && styles.filterTextActive,
              ]}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {selectedTurn ? (
        <View style={styles.transcriptView}>
          <View style={styles.transcriptHeader}>
            <Text style={styles.transcriptTitle}>Full transcript</Text>
            <Pressable onPress={() => setSelectedId(null)}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <Text style={styles.transcriptBody}>
            {searchQuery
              ? highlightMatches(selectedTurn.refinedText, searchQuery)
              : selectedTurn.refinedText}
          </Text>
          <Text style={styles.transcriptMeta}>
            Mode: {selectedTurn.mode} | Duration:{" "}
            {Math.round(selectedTurn.durationMs / 1000)}s | Status:{" "}
            {selectedTurn.syncState}
          </Text>
        </View>
      ) : null}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={renderResult}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {searchQuery.trim()
              ? "No results found."
              : "Type a query to search your transcripts."}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { color: palette.text, fontSize: 28, fontWeight: "800" },
  searchInput: {
    color: palette.text,
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 14,
    marginHorizontal: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  filterPill: {
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  filterPillActive: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  filterText: { color: palette.textMuted, fontWeight: "700", fontSize: 13 },
  filterTextActive: { color: palette.text },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 8 },
  resultCard: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  resultCardActive: { borderColor: palette.primary },
  resultHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resultTitle: {
    color: palette.text,
    fontWeight: "700",
    fontSize: 15,
    flex: 1,
  },
  matchBadge: {
    color: palette.warning,
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 8,
  },
  resultSnippet: {
    color: palette.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  pressed: { opacity: 0.78 },
  transcriptView: {
    backgroundColor: palette.surface,
    borderColor: palette.primary,
    borderWidth: 1,
    borderRadius: 18,
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 16,
    gap: 10,
  },
  transcriptHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  transcriptTitle: { color: palette.text, fontWeight: "800", fontSize: 16 },
  closeText: { color: palette.primarySoft, fontWeight: "700" },
  transcriptBody: { color: palette.text, fontSize: 14, lineHeight: 22 },
  transcriptMeta: { color: palette.textMuted, fontSize: 12 },
  emptyText: {
    color: palette.textMuted,
    textAlign: "center",
    paddingTop: 32,
    lineHeight: 22,
  },
});
