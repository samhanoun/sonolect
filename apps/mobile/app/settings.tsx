import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DICTATION_LANGUAGES, type PrivacyLevel } from "../src/domain";
import { LANGUAGE_NAMES, strings } from "../src/i18n";
import { isAllowedApiUrl } from "../src/localApi";
import { useCompanionStore } from "../src/store";
import {
  Button,
  Card,
  Chip,
  Label,
  Segmented,
  Title,
  ToggleRow,
} from "../src/ui/components";
import { colors, fonts, radius, space } from "../src/ui/theme";

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

type TestState = "idle" | "testing" | "ok" | "fail";

export default function SettingsScreen() {
  const settings = useCompanionStore((s) => s.settings);
  const apiToken = useCompanionStore((s) => s.apiToken);
  const dictionary = useCompanionStore((s) => s.dictionary);
  const snippets = useCompanionStore((s) => s.snippets);
  const updateSettings = useCompanionStore((s) => s.updateSettings);
  const setApiToken = useCompanionStore((s) => s.setApiToken);
  const addDictionaryEntry = useCompanionStore((s) => s.addDictionaryEntry);
  const removeDictionaryEntry = useCompanionStore(
    (s) => s.removeDictionaryEntry,
  );
  const addSnippet = useCompanionStore((s) => s.addSnippet);
  const removeSnippet = useCompanionStore((s) => s.removeSnippet);
  const clearHistory = useCompanionStore((s) => s.clearHistory);
  const eraseAll = useCompanionStore((s) => s.eraseAll);
  const t = strings(settings.uiLanguage);

  const [url, setUrl] = useState(settings.localApiUrl ?? "");
  const [token, setToken] = useState(apiToken ?? "");
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>("idle");
  const [spoken, setSpoken] = useState("");
  const [written, setWritten] = useState("");
  const [trigger, setTrigger] = useState("");
  const [body, setBody] = useState("");

  const urlValid = !url.trim() || isAllowedApiUrl(url.trim());

  const saveApi = async () => {
    if (!urlValid) return;
    await updateSettings({ localApiUrl: url.trim() || undefined });
    await setApiToken(token);
    setApiMessage(t.settings.apiSaved);
    setTest("idle");
  };

  const testApi = async () => {
    if (!url.trim() || !urlValid) return;
    setTest("testing");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(new URL("/health", url.trim()).toString(), {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      clearTimeout(timer);
      setTest(response.ok ? "ok" : "fail");
    } catch {
      setTest("fail");
    }
  };

  const privacyOptions: { value: PrivacyLevel; label: string }[] = [
    { value: "standard", label: t.settings.privacyLevels.standard },
    { value: "local_first", label: t.settings.privacyLevels.local_first },
    { value: "ephemeral", label: t.settings.privacyLevels.ephemeral },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Title>{t.settings.title}</Title>

          <View style={styles.section}>
            <Label>{t.settings.privacy}</Label>
            <Segmented
              accessibilityLabel={t.settings.privacy}
              options={privacyOptions}
              value={settings.privacyLevel}
              onChange={(privacyLevel) => void updateSettings({ privacyLevel })}
            />
            <Text style={styles.help}>
              {t.settings.privacyHelp[settings.privacyLevel]}
            </Text>
          </View>

          <Card style={styles.toggles}>
            <ToggleRow
              label={t.settings.saveHistory}
              value={
                settings.saveHistory && settings.privacyLevel !== "ephemeral"
              }
              onChange={(saveHistory) => void updateSettings({ saveHistory })}
            />
            <ToggleRow
              label={t.settings.haptics}
              value={settings.hapticsEnabled}
              onChange={(hapticsEnabled) =>
                void updateSettings({ hapticsEnabled })
              }
            />
            <ToggleRow
              label={t.settings.sync}
              value={settings.cloudSyncEnabled}
              onChange={(cloudSyncEnabled) =>
                void updateSettings({ cloudSyncEnabled })
              }
              last
            />
          </Card>

          <View style={styles.section}>
            <Label>{t.settings.dictation}</Label>
            <View style={styles.chips}>
              {DICTATION_LANGUAGES.map((language) => (
                <Chip
                  key={language}
                  label={LANGUAGE_NAMES[language] ?? language}
                  selected={settings.language === language}
                  onPress={() => void updateSettings({ language })}
                />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Label>{t.settings.interface}</Label>
            <Segmented
              accessibilityLabel={t.settings.interface}
              options={[
                { value: "en", label: "English" },
                { value: "fr", label: "Français" },
              ]}
              value={settings.uiLanguage}
              onChange={(uiLanguage) => void updateSettings({ uiLanguage })}
            />
          </View>

          <View style={styles.section}>
            <Label>{t.settings.api}</Label>
            <Card>
              <Text style={styles.fieldLabel} nativeID="api-url-label">
                {t.settings.apiUrl}
              </Text>
              <TextInput
                accessibilityLabelledBy="api-url-label"
                accessibilityLabel={t.settings.apiUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://api.example.com"
                placeholderTextColor={colors.muted}
                value={url}
                onChangeText={(value) => {
                  setUrl(value);
                  setApiMessage(null);
                }}
                style={[styles.input, !urlValid && styles.inputError]}
              />
              <Text style={styles.fieldLabel}>{t.settings.apiToken}</Text>
              <TextInput
                accessibilityLabel={t.settings.apiToken}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                placeholder="••••••••"
                placeholderTextColor={colors.muted}
                value={token}
                onChangeText={setToken}
                style={styles.input}
              />
              <Text
                style={[styles.help, !urlValid && { color: colors.danger }]}
              >
                {!urlValid
                  ? t.settings.apiInvalid
                  : (apiMessage ??
                    (test === "ok"
                      ? t.settings.testOk
                      : test === "fail"
                        ? t.settings.testFail
                        : settings.localApiUrl
                          ? settings.localApiUrl
                          : t.settings.apiNotSet))}
              </Text>
              <View style={styles.row}>
                <Button
                  variant="primary"
                  label={t.settings.save}
                  disabled={!urlValid}
                  onPress={() => void saveApi()}
                />
                <Button
                  label={
                    test === "testing" ? t.settings.testing : t.settings.test
                  }
                  disabled={!url.trim() || !urlValid || test === "testing"}
                  onPress={() => void testApi()}
                />
              </View>
            </Card>
          </View>

          <View style={styles.section}>
            <Label>{t.settings.dictionary}</Label>
            <Card>
              <Text style={styles.help}>{t.settings.dictionaryHelp}</Text>
              {dictionary.map((entry) => (
                <View key={entry.id} style={styles.entry}>
                  <Text style={styles.entryText} numberOfLines={2}>
                    {entry.spoken} <Text style={{ color: colors.lime }}>→</Text>{" "}
                    {entry.replacement}
                  </Text>
                  <Button
                    compact
                    icon="close"
                    accessibilityLabel={`${t.settings.remove} ${entry.spoken}`}
                    onPress={() => void removeDictionaryEntry(entry.id)}
                  />
                </View>
              ))}
              <View style={styles.pair}>
                <TextInput
                  accessibilityLabel={t.settings.spoken}
                  placeholder={t.settings.spoken}
                  placeholderTextColor={colors.muted}
                  value={spoken}
                  onChangeText={setSpoken}
                  style={[styles.input, styles.flex]}
                />
                <TextInput
                  accessibilityLabel={t.settings.written}
                  placeholder={t.settings.written}
                  placeholderTextColor={colors.muted}
                  value={written}
                  onChangeText={setWritten}
                  style={[styles.input, styles.flex]}
                />
              </View>
              <Button
                icon="plus"
                label={t.settings.add}
                disabled={!spoken.trim() || !written.trim()}
                onPress={async () => {
                  if (await addDictionaryEntry(spoken, written)) {
                    setSpoken("");
                    setWritten("");
                  }
                }}
              />
            </Card>
          </View>

          <View style={styles.section}>
            <Label>{t.settings.snippets}</Label>
            <Card>
              <Text style={styles.help}>{t.settings.snippetsHelp}</Text>
              {snippets.map((snippet) => (
                <View key={snippet.id} style={styles.entry}>
                  <View style={styles.flex}>
                    <Text style={styles.entryText}>{snippet.trigger}</Text>
                    <Text style={styles.help} numberOfLines={2}>
                      {snippet.body}
                    </Text>
                  </View>
                  <Button
                    compact
                    icon="close"
                    accessibilityLabel={`${t.settings.remove} ${snippet.trigger}`}
                    onPress={() => void removeSnippet(snippet.id)}
                  />
                </View>
              ))}
              <TextInput
                accessibilityLabel={t.settings.trigger}
                placeholder={t.settings.trigger}
                placeholderTextColor={colors.muted}
                value={trigger}
                onChangeText={setTrigger}
                style={styles.input}
              />
              <TextInput
                accessibilityLabel={t.settings.body}
                placeholder={t.settings.body}
                placeholderTextColor={colors.muted}
                value={body}
                onChangeText={setBody}
                multiline
                style={[styles.input, styles.multiline]}
              />
              <Button
                icon="plus"
                label={t.settings.add}
                disabled={!trigger.trim() || !body.trim()}
                onPress={async () => {
                  if (await addSnippet(trigger, body)) {
                    setTrigger("");
                    setBody("");
                  }
                }}
              />
            </Card>
          </View>

          <View style={styles.section}>
            <Label>{t.settings.data}</Label>
            <View style={styles.row}>
              <Button
                variant="danger"
                icon="trash"
                label={t.settings.clearHistory}
                onPress={async () => {
                  if (
                    await confirm(
                      t.settings.clearHistory,
                      t.common.confirm,
                      t.common.cancel,
                    )
                  )
                    await clearHistory();
                }}
              />
              <Button
                variant="danger"
                label={t.settings.eraseAll}
                onPress={async () => {
                  if (
                    await confirm(
                      t.settings.eraseConfirm,
                      t.common.confirm,
                      t.common.cancel,
                    )
                  ) {
                    await eraseAll();
                    setUrl("");
                    setToken("");
                  }
                }}
              />
            </View>
            <Text style={styles.help}>{t.settings.about}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  container: { padding: space.xl, gap: space.xl, paddingBottom: 48 },
  section: { gap: space.sm },
  toggles: { paddingVertical: 4, gap: 0 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  help: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
  },
  fieldLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.text,
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  inputError: { borderColor: colors.danger },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  pair: { flexDirection: "row", gap: space.sm },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  entryText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.text,
  },
});
