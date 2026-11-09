import { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Speech from "expo-speech";
import { SafeAreaView } from "react-native-safe-area-context";

import type { TranscriptTurn } from "../src/domain";
import { strings } from "../src/i18n";
import {
  exportAsMarkdown,
  filterHistory,
  formatDuration,
  sortHistory,
  type LibraryFilter,
} from "../src/library";
import { useCompanionStore } from "../src/store";
import { Button, Card, Chip, Icon, Label, Title } from "../src/ui/components";
import { colors, fonts, modeColor, radius, space } from "../src/ui/theme";

const FILTERS: LibraryFilter[] = ["all", "pinned", "summaries", "tasks"];

function confirm(
  message: string,
  confirmLabel: string,
  cancelLabel: string,
): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(
      typeof window !== "undefined" ? window.confirm(message) : false,
    );
  }
  return new Promise((resolve) => {
    Alert.alert(message, undefined, [
      { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: "destructive",
        onPress: () => resolve(true),
      },
    ]);
  });
}

function timeLabel(iso: string, locale: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export default function LibraryScreen() {
  const history = useCompanionStore((s) => s.history);
  const settings = useCompanionStore((s) => s.settings);
  const deleteTurn = useCompanionStore((s) => s.deleteTurn);
  const togglePin = useCompanionStore((s) => s.togglePin);
  const t = strings(settings.uiLanguage);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const items = useMemo(
    () => sortHistory(filterHistory(history, query, filter)),
    [history, query, filter],
  );
  const locale = settings.uiLanguage === "fr" ? "fr-FR" : "en-US";

  const renderItem = ({ item }: { item: TranscriptTurn }) => {
    const open = expanded === item.id;
    return (
      <Card style={styles.item}>
        <View style={styles.metaRow}>
          <Label color={modeColor(item.mode)}>
            {item.pinned ? "◆ " : ""}
            {t.modeTag[item.mode] ?? item.mode}
          </Label>
          <Label>
            {timeLabel(item.createdAt, locale)} ·{" "}
            {item.source === "typed"
              ? t.library.typed
              : formatDuration(item.durationMs)}{" "}
            · {t.library.sync[item.syncState]}
          </Label>
        </View>
        <Text
          selectable
          style={styles.itemText}
          numberOfLines={open ? undefined : 4}
          onPress={() => setExpanded(open ? null : item.id)}
          accessibilityHint="Expands the transcript"
        >
          {item.refinedText}
        </Text>
        {open && item.rawText && item.rawText !== item.refinedText ? (
          <View style={styles.raw}>
            <Label>{t.library.original.toUpperCase()}</Label>
            <Text selectable style={styles.rawText}>
              {item.rawText}
            </Text>
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button
            compact
            icon="copy"
            label={t.capture.copy}
            onPress={() => void Clipboard.setStringAsync(item.refinedText)}
          />
          <Button
            compact
            icon="share"
            label={t.capture.share}
            onPress={() =>
              void Share.share({ message: item.refinedText }).catch(
                () => undefined,
              )
            }
          />
          <Button
            compact
            icon="speaker"
            label={t.library.listen}
            onPress={() => {
              void Speech.stop();
              Speech.speak(item.refinedText, {
                rate: settings.speechRate,
                ...(item.language !== "auto"
                  ? { language: item.language }
                  : {}),
              });
            }}
          />
          <Button
            compact
            icon="pin"
            accessibilityLabel={item.pinned ? t.library.unpin : t.library.pin}
            onPress={() => void togglePin(item.id)}
          />
          <Button
            compact
            icon="trash"
            variant="danger"
            accessibilityLabel={t.library.delete}
            onPress={async () => {
              if (
                await confirm(
                  t.library.deleteConfirm,
                  t.library.delete,
                  t.common.cancel,
                )
              ) {
                await deleteTurn(item.id);
              }
            }}
          />
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Title>{t.library.title}</Title>
              <Label>{t.library.items(history.length)}</Label>
            </View>
            <View style={styles.search}>
              <Icon name="search" size={16} color={colors.muted} />
              <TextInput
                accessibilityLabel={t.library.search}
                placeholder={t.library.search}
                placeholderTextColor={colors.muted}
                value={query}
                onChangeText={setQuery}
                style={styles.searchInput}
                returnKeyType="search"
              />
            </View>
            <View style={styles.filters}>
              {FILTERS.map((value) => (
                <Chip
                  key={value}
                  label={t.library.filters[value]}
                  selected={filter === value}
                  onPress={() => setFilter(value)}
                />
              ))}
              {history.length > 0 ? (
                <Button
                  compact
                  icon="share"
                  label={t.library.exportAll}
                  variant="ghost"
                  onPress={() =>
                    void Share.share({
                      message: exportAsMarkdown(sortHistory(history)),
                    }).catch(() => undefined)
                  }
                />
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {history.length === 0 ? t.library.empty : t.library.noMatch}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { padding: space.xl, gap: space.md, paddingBottom: 40 },
  header: { gap: space.md, marginBottom: space.xs },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
    paddingVertical: 10,
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    alignItems: "center",
  },
  item: { gap: space.sm },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space.sm,
    flexWrap: "wrap",
  },
  itemText: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  raw: { gap: 4, paddingTop: space.xs },
  rawText: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 21,
    paddingTop: space.lg,
  },
});
