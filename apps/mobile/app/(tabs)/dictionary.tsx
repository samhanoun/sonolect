import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useCompanionStore } from "../../src/store";
import { searchDictionary } from "../../src/dictionaryCrud";
import type { DictionaryEntry } from "../../src/dictionaryCrud";

const palette = {
  background: "#08090A",
  surface: "#111317",
  surfaceMuted: "#181B21",
  border: "#2A2F38",
  primary: "#8B5CF6",
  primarySoft: "#A78BFA",
  danger: "#EF4444",
  text: "#F4F4F5",
  textMuted: "#A1A1AA",
};

export default function DictionaryScreen() {
  const entries = useCompanionStore((s) => s.dictionaryEntries);
  const addEntry = useCompanionStore((s) => s.addDictionaryEntry);
  const removeEntry = useCompanionStore((s) => s.removeDictionaryEntry);

  const [search, setSearch] = useState("");
  const [spoken, setSpoken] = useState("");
  const [replacement, setReplacement] = useState("");

  const filtered = useMemo(
    () => searchDictionary(entries, search),
    [entries, search],
  );

  const handleAdd = useCallback(() => {
    if (!spoken.trim() || !replacement.trim()) return;
    void addEntry(spoken.trim(), replacement.trim());
    setSpoken("");
    setReplacement("");
  }, [spoken, replacement, addEntry]);

  const handleDelete = useCallback(
    (entry: DictionaryEntry) => {
      Alert.alert("Remove entry", `Delete "${entry.spoken}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void removeEntry(entry.id),
        },
      ]);
    },
    [removeEntry],
  );

  const renderItem = useCallback(
    ({ item }: { item: DictionaryEntry }) => (
      <View style={styles.entryRow}>
        <View style={styles.entryContent}>
          <Text style={styles.entrySpoken}>{item.spoken}</Text>
          <Text style={styles.entryReplacement}>{item.replacement}</Text>
        </View>
        <Pressable
          onPress={() => handleDelete(item)}
          style={styles.deleteButton}
          accessibilityLabel={`Delete ${item.spoken}`}
        >
          <Text style={styles.deleteText}>X</Text>
        </Pressable>
      </View>
    ),
    [handleDelete],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>Dictionary</Text>
        <Text style={styles.count}>{entries.length} entries</Text>
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Search entries..."
        placeholderTextColor={palette.textMuted}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.addForm}>
        <TextInput
          style={styles.formInput}
          placeholder="Spoken word"
          placeholderTextColor={palette.textMuted}
          value={spoken}
          onChangeText={setSpoken}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.formInput}
          placeholder="Replacement"
          placeholderTextColor={palette.textMuted}
          value={replacement}
          onChangeText={setReplacement}
          autoCapitalize="none"
        />
        <Pressable
          onPress={handleAdd}
          style={({ pressed }) => [
            styles.addButton,
            (!spoken.trim() || !replacement.trim()) && styles.addButtonDisabled,
            pressed && styles.pressed,
          ]}
          disabled={!spoken.trim() || !replacement.trim()}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {search ? "No matching entries." : "No dictionary entries yet."}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { color: palette.text, fontSize: 28, fontWeight: "800" },
  count: { color: palette.textMuted, fontSize: 14 },
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
  addForm: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 18,
    margin: 20,
    padding: 14,
    gap: 10,
  },
  formInput: {
    color: palette.text,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  addButton: {
    backgroundColor: palette.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  addButtonDisabled: { opacity: 0.4 },
  addButtonText: { color: palette.text, fontWeight: "800", fontSize: 15 },
  pressed: { opacity: 0.78 },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 8 },
  entryRow: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  entryContent: { flex: 1, gap: 4 },
  entrySpoken: { color: palette.primarySoft, fontWeight: "700", fontSize: 15 },
  entryReplacement: { color: palette.text, fontSize: 14 },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.surfaceMuted,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 10,
  },
  deleteText: { color: palette.danger, fontWeight: "800", fontSize: 14 },
  emptyText: {
    color: palette.textMuted,
    textAlign: "center",
    paddingTop: 32,
    lineHeight: 22,
  },
});
