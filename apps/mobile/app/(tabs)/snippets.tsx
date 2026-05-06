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
import { searchSnippets } from "../../src/snippetCrud";
import type { Snippet } from "../../src/snippetCrud";

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

export default function SnippetScreen() {
  const snippets = useCompanionStore((s) => s.snippets);
  const addSnippet = useCompanionStore((s) => s.addSnippet);
  const removeSnippet = useCompanionStore((s) => s.removeSnippet);

  const [search, setSearch] = useState("");
  const [trigger, setTrigger] = useState("");
  const [body, setBody] = useState("");

  const filtered = useMemo(
    () => searchSnippets(snippets, search),
    [snippets, search],
  );

  const handleAdd = useCallback(() => {
    if (!trigger.trim() || !body.trim()) return;
    void addSnippet(trigger.trim(), body.trim());
    setTrigger("");
    setBody("");
  }, [trigger, body, addSnippet]);

  const handleDelete = useCallback(
    (snippet: Snippet) => {
      Alert.alert(
        "Remove snippet",
        `Delete "${snippet.trigger}"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => void removeSnippet(snippet.id),
          },
        ],
      );
    },
    [removeSnippet],
  );

  const renderItem = useCallback(
    ({ item }: { item: Snippet }) => (
      <View style={styles.entryRow}>
        <View style={styles.entryContent}>
          <Text style={styles.entryTrigger}>{item.trigger}</Text>
          <Text style={styles.entryBody} numberOfLines={2}>
            {item.body}
          </Text>
        </View>
        <Pressable
          onPress={() => handleDelete(item)}
          style={styles.deleteButton}
          accessibilityLabel={`Delete ${item.trigger}`}
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
        <Text style={styles.title}>Snippets</Text>
        <Text style={styles.count}>{snippets.length} snippets</Text>
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Search snippets..."
        placeholderTextColor={palette.textMuted}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.addForm}>
        <TextInput
          style={styles.formInput}
          placeholder="Trigger (e.g. /hello)"
          placeholderTextColor={palette.textMuted}
          value={trigger}
          onChangeText={setTrigger}
          autoCapitalize="none"
        />
        <TextInput
          style={[styles.formInput, styles.bodyInput]}
          placeholder="Snippet body"
          placeholderTextColor={palette.textMuted}
          value={body}
          onChangeText={setBody}
          multiline
          numberOfLines={3}
        />
        <Pressable
          onPress={handleAdd}
          style={({ pressed }) => [
            styles.addButton,
            (!trigger.trim() || !body.trim()) && styles.addButtonDisabled,
            pressed && styles.pressed,
          ]}
          disabled={!trigger.trim() || !body.trim()}
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
            {search ? "No matching snippets." : "No snippets yet."}
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
  bodyInput: {
    minHeight: 60,
    textAlignVertical: "top",
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
  entryTrigger: { color: palette.primarySoft, fontWeight: "700", fontSize: 15 },
  entryBody: { color: palette.text, fontSize: 14, lineHeight: 20 },
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
