import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocales } from "expo-localization";
import { useFocusEffect } from "expo-router";

import { keepsHistory, type TranscriptTurn } from "../src/domain";
import { exportNotes } from "../src/exportNotes";
import { API_FEATURES_ENABLED } from "../src/features";
import { strings } from "../src/i18n";
import {
  EXPORT_FORMATS,
  exportLibrary,
  filterHistory,
  formatDuration,
  formatNoteDate,
  formattingLocale,
  sortHistory,
  type ExportFormat,
  type LibraryFilter,
} from "../src/library";
import { noticeText, storageBanner } from "../src/notices";
import { useCompanionStore } from "../src/store";
import { ttsController, useTts } from "../src/tts";
import { copyText, currentShareTarget, shareText } from "../src/ui/actions";
import {
  Button,
  Card,
  Chip,
  Icon,
  Label,
  NoticeBanner,
  Title,
  inputColors,
} from "../src/ui/components";
import { confirm } from "../src/ui/confirm";
import {
  FadeIn,
  GlassScreen,
  animateNextLayout,
  glassStyles,
} from "../src/ui/glass";
import { useTabBarClearance } from "../src/ui/GlassTabBar";
import { useReducedMotion, useReducedTransparency } from "../src/ui/motion";
import { colors, fonts, modeColor, radius, space } from "../src/ui/theme";

const FILTERS: LibraryFilter[] = ["all", "pinned", "summaries", "tasks"];

function timeLabel(iso: string, locale: string | undefined): string {
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
  const notice = useCompanionStore((s) => s.notice);
  const storageDegraded = useCompanionStore((s) => s.storageDegraded);
  const dismissNotice = useCompanionStore((s) => s.dismissNotice);
  const captureStatus = useCompanionStore((s) => s.capture.status);
  const t = strings(settings.uiLanguage);
  const banner = storageBanner(notice, storageDegraded);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exporting = useRef(false);
  // Export first asks for the file format, in a row under the filters.
  const [choosingFormat, setChoosingFormat] = useState(false);
  const tts = useTts();
  const clearance = useTabBarClearance();
  const reduced = useReducedMotion();
  const opaque = useReducedTransparency();
  // The microphone would hear it (speech-4).
  const captureBusy =
    captureStatus === "listening" || captureStatus === "processing";

  const items = useMemo(
    () => sortHistory(filterHistory(history, query, filter)),
    [history, query, filter],
  );
  // The phone's own formats when it speaks the UI language (ux-23).
  const locale = formattingLocale(
    settings.uiLanguage,
    useLocales()[0]?.languageTag,
  );
  const listState = useMemo(
    () => ({ expanded, copiedId, tts, captureBusy, locale, t }),
    [expanded, copiedId, tts, captureBusy, locale, t],
  );

  // Tabs stay mounted: leaving the Library stops what it reads (speech-4).
  useFocusEffect(
    useCallback(
      () => () => {
        void ttsController.stop();
      },
      [],
    ),
  );

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copyItem = async (item: TranscriptTurn) => {
    if (!(await copyText(item.refinedText, t))) return;
    setCopiedId(item.id);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedId(null), 1500);
  };

  const exportAll = async (format: ExportFormat) => {
    if (exporting.current) return;
    exporting.current = true;
    setChoosingFormat(false);
    try {
      await exportNotes(
        exportLibrary(sortHistory(history), format, {
          formatDate: (iso) => formatNoteDate(iso, locale),
          modeLabel: (mode) => t.modeTag[mode] ?? mode,
        }),
        t,
        format,
      );
    } finally {
      exporting.current = false;
    }
  };

  /** A note opens and closes smoothly instead of jumping (Reduce Motion: no). */
  const toggleExpanded = (id: string) => {
    animateNextLayout(reduced);
    setExpanded((current) => (current === id ? null : id));
  };

  const renderItem = ({
    item,
    index,
  }: {
    item: TranscriptTurn;
    index: number;
  }) => {
    const open = expanded === item.id;
    return (
      <Card style={styles.item} enterIndex={index}>
        <View style={styles.metaRow}>
          <Label color={modeColor(item.mode)}>
            {item.pinned ? "◆ " : ""}
            {t.modeTag[item.mode] ?? item.mode}
          </Label>
          <Label>
            {timeLabel(item.createdAt, locale)} ·{" "}
            {item.source === "typed"
              ? t.library.typed
              : formatDuration(item.durationMs)}
            {API_FEATURES_ENABLED
              ? ` · ${t.library.sync[item.syncState]}`
              : null}
            {item.conflictOf ? ` · ${t.library.conflictCopy}` : null}
          </Label>
        </View>
        <Text
          selectable
          style={styles.itemText}
          numberOfLines={open ? undefined : 4}
          onPress={() => toggleExpanded(item.id)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityHint={
            open ? t.library.collapseHint : t.library.expandHint
          }
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
            label={copiedId === item.id ? t.capture.copied : t.capture.copy}
            onPress={() => void copyItem(item)}
          />
          {currentShareTarget() === "download" ? (
            <Button
              compact
              icon="download"
              label={t.capture.download}
              onPress={() =>
                void shareText(item.refinedText, t, item.createdAt)
              }
            />
          ) : (
            <Button
              compact
              icon="share"
              label={t.capture.share}
              onPress={() => void shareText(item.refinedText, t)}
            />
          )}
          {tts.ownerId === item.id ? (
            <Button
              compact
              icon="stop"
              label={t.reader.stop}
              onPress={() => void ttsController.stop()}
            />
          ) : (
            <Button
              compact
              icon="speaker"
              label={t.library.listen}
              disabled={captureBusy}
              onPress={() => {
                ttsController.play(item.id, item.refinedText, {
                  language:
                    item.language !== "auto"
                      ? item.language
                      : settings.language,
                  rate: settings.speechRate,
                });
              }}
            />
          )}
          <Button
            compact
            icon="pin"
            selected={Boolean(item.pinned)}
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
                await confirm({
                  title: t.library.deleteConfirm,
                  confirmLabel: t.library.delete,
                  cancelLabel: t.common.cancel,
                  destructive: true,
                })
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
    <GlassScreen>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        extraData={listState}
        contentContainerStyle={[
          styles.container,
          { paddingBottom: clearance + space.lg },
        ]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <FadeIn style={styles.header}>
            <View style={styles.titleRow}>
              <Title style={styles.shrink}>{t.library.title}</Title>
              <Label>{t.library.items(history.length)}</Label>
            </View>
            {banner ? (
              <NoticeBanner
                text={noticeText(t, banner.notice)}
                {...(banner.dismissable
                  ? {
                      actionLabel: t.capture.actions.dismiss,
                      onAction: dismissNotice,
                    }
                  : {})}
              />
            ) : null}
            <View
              style={[
                glassStyles.panel,
                styles.search,
                opaque && glassStyles.panelOpaque,
              ]}
            >
              <Icon name="search" size={16} color={colors.muted} />
              <TextInput
                accessibilityLabel={t.library.search}
                placeholder={t.library.search}
                placeholderTextColor={colors.muted}
                value={query}
                onChangeText={setQuery}
                style={styles.searchInput}
                returnKeyType="search"
                {...inputColors}
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
                  selected={choosingFormat}
                  onPress={() => setChoosingFormat((open) => !open)}
                />
              ) : null}
            </View>
            {choosingFormat && history.length > 0 ? (
              <View style={styles.filters} accessibilityRole="toolbar">
                <Label>{t.library.exportAs}</Label>
                {EXPORT_FORMATS.map((format) => (
                  <Chip
                    key={format}
                    label={t.library.exportFormats[format]}
                    onPress={() => void exportAll(format)}
                  />
                ))}
              </View>
            ) : null}
          </FadeIn>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {history.length > 0
              ? t.library.noMatch
              : keepsHistory(settings)
                ? t.library.empty
                : t.library.historyOff}
          </Text>
        }
      />
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.xl, gap: space.md },
  header: { gap: space.md, marginBottom: space.xs },
  // At large font sizes the count wraps under the title (ux-19).
  titleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    columnGap: space.sm,
  },
  shrink: { flexShrink: 1, minWidth: 0 },
  // A text field: its outline reaches 3:1 on every edge (ux-26).
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderColor: colors.lineInteractive,
    borderTopColor: colors.lineInteractive,
    borderBottomColor: colors.lineInteractive,
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
