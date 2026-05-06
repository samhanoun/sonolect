import { useCallback } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { useCompanionStore } from "../../src/store";
import { getStylePresets } from "../../src/stylePresets";
import type { PrivacyLevel } from "../../src/domain";

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

const presets = getStylePresets();

export default function SettingsScreen() {
  const settings = useCompanionStore((s) => s.settings);
  const updateSettings = useCompanionStore((s) => s.updateSettings);
  const activeStylePreset = useCompanionStore((s) => s.activeStylePreset);
  const setActiveStylePreset = useCompanionStore((s) => s.setActiveStylePreset);
  const retentionPolicy = useCompanionStore((s) => s.retentionPolicy);
  const setRetentionPolicy = useCompanionStore((s) => s.setRetentionPolicy);

  const privacyLevels: { key: PrivacyLevel; label: string }[] = [
    { key: "standard", label: "Standard" },
    { key: "local_first", label: "Local first" },
    { key: "ephemeral", label: "Ephemeral" },
  ];

  const languages: { key: "fr-FR" | "en-US" | "auto"; label: string }[] = [
    { key: "fr-FR", label: "French" },
    { key: "en-US", label: "English" },
    { key: "auto", label: "Auto" },
  ];

  const handleRetentionMaxAge = useCallback(
    (text: string) => {
      const days = parseInt(text, 10);
      if (Number.isFinite(days) && days > 0) {
        void setRetentionPolicy({ maxAgeDays: days });
      }
    },
    [setRetentionPolicy],
  );

  const handleRetentionMaxItems = useCallback(
    (text: string) => {
      const items = parseInt(text, 10);
      if (Number.isFinite(items) && items > 0) {
        void setRetentionPolicy({ maxItems: items });
      }
    },
    [setRetentionPolicy],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Settings</Text>

        {/* Style preset selector */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Style Preset</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.presetRow}
          >
            {presets.map((preset) => (
              <Pressable
                key={preset.id}
                onPress={() => setActiveStylePreset(preset.id)}
                style={[
                  styles.presetPill,
                  activeStylePreset === preset.id && styles.presetPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.presetLabel,
                    activeStylePreset === preset.id && styles.presetLabelActive,
                  ]}
                >
                  {preset.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.presetDesc}>
            {presets.find((p) => p.id === activeStylePreset)?.description ??
              "Select a style preset to apply to polished text."}
          </Text>
        </View>

        {/* Retention controls */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Retention Policy</Text>
          <View style={styles.retentionRow}>
            <Text style={styles.retentionLabel}>Max age (days)</Text>
            <TextInput
              style={styles.retentionInput}
              keyboardType="numeric"
              defaultValue={String(retentionPolicy.maxAgeDays)}
              onEndEditing={(e) => handleRetentionMaxAge(e.nativeEvent.text)}
              placeholderTextColor={palette.textMuted}
            />
          </View>
          <View style={styles.retentionRow}>
            <Text style={styles.retentionLabel}>Max items</Text>
            <TextInput
              style={styles.retentionInput}
              keyboardType="numeric"
              defaultValue={String(retentionPolicy.maxItems)}
              onEndEditing={(e) => handleRetentionMaxItems(e.nativeEvent.text)}
              placeholderTextColor={palette.textMuted}
            />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Auto-delete expired</Text>
            <Switch
              value={retentionPolicy.autoDeleteEnabled}
              onValueChange={(value) =>
                void setRetentionPolicy({ autoDeleteEnabled: value })
              }
              trackColor={{ false: palette.border, true: palette.primary }}
            />
          </View>
        </View>

        {/* Privacy level */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy Level</Text>
          <View style={styles.pillRow}>
            {privacyLevels.map((level) => (
              <Pressable
                key={level.key}
                onPress={() => void updateSettings({ privacyLevel: level.key })}
                style={[
                  styles.pill,
                  settings.privacyLevel === level.key && styles.pillActive,
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    settings.privacyLevel === level.key &&
                      styles.pillTextActive,
                  ]}
                >
                  {level.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Language selector */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Language</Text>
          <View style={styles.pillRow}>
            {languages.map((lang) => (
              <Pressable
                key={lang.key}
                onPress={() => void updateSettings({ language: lang.key })}
                style={[
                  styles.pill,
                  settings.language === lang.key && styles.pillActive,
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    settings.language === lang.key && styles.pillTextActive,
                  ]}
                >
                  {lang.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* General toggles */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>General</Text>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Save history</Text>
            <Switch
              value={settings.saveHistory}
              onValueChange={(value) =>
                void updateSettings({ saveHistory: value })
              }
              trackColor={{ false: palette.border, true: palette.primary }}
            />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Cloud sync</Text>
            <Switch
              value={settings.cloudSyncEnabled}
              onValueChange={(value) =>
                void updateSettings({ cloudSyncEnabled: value })
              }
              trackColor={{ false: palette.border, true: palette.primary }}
            />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Notifications</Text>
            <Switch
              value={settings.notificationsEnabled}
              onValueChange={(value) =>
                void updateSettings({ notificationsEnabled: value })
              }
              trackColor={{ false: palette.border, true: palette.primary }}
            />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Haptics</Text>
            <Switch
              value={settings.hapticsEnabled}
              onValueChange={(value) =>
                void updateSettings({ hapticsEnabled: value })
              }
              trackColor={{ false: palette.border, true: palette.primary }}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  container: { padding: 20, gap: 18, paddingBottom: 44 },
  title: {
    color: palette.text,
    fontSize: 28,
    fontWeight: "800",
    paddingTop: 8,
  },
  section: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    gap: 12,
  },
  sectionTitle: { color: palette.text, fontSize: 18, fontWeight: "800" },
  presetRow: { gap: 8, paddingVertical: 4 },
  presetPill: {
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  presetPillActive: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  presetLabel: { color: palette.textMuted, fontWeight: "700", fontSize: 14 },
  presetLabelActive: { color: palette.text },
  presetDesc: { color: palette.textMuted, fontSize: 13, lineHeight: 20 },
  retentionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  retentionLabel: { color: palette.text, fontSize: 15 },
  retentionInput: {
    color: palette.text,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    width: 80,
    textAlign: "center",
    fontSize: 15,
  },
  pillRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pill: {
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  pillActive: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  pillText: { color: palette.textMuted, fontWeight: "700" },
  pillTextActive: { color: palette.text },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  settingLabel: { color: palette.text, fontSize: 15 },
});
