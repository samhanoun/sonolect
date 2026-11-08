import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Speech from "expo-speech";
import { SafeAreaView } from "react-native-safe-area-context";

import { strings } from "../src/i18n";
import { useCompanionStore } from "../src/store";
import { Button, Card, Chip, Label, Title } from "../src/ui/components";
import { colors, fonts, radius, space } from "../src/ui/theme";

const RATES = [0.75, 1, 1.25, 1.5];
type PlayState = "idle" | "playing" | "paused";

export default function ReaderScreen() {
  const settings = useCompanionStore((s) => s.settings);
  const latest = useCompanionStore((s) => s.latest);
  const updateSettings = useCompanionStore((s) => s.updateSettings);
  const t = strings(settings.uiLanguage);
  const [text, setText] = useState("");
  const [state, setState] = useState<PlayState>("idle");
  const [voices, setVoices] = useState<Speech.Voice[]>([]);
  const [voice, setVoice] = useState<string | undefined>();
  const canPause = Platform.OS === "ios";

  useEffect(() => {
    let mounted = true;
    Speech.getAvailableVoicesAsync()
      .then((all) => {
        if (!mounted) return;
        const base = settings.language.split("-")[0] ?? "en";
        setVoices(
          all
            .filter((v) => v.language?.toLowerCase().startsWith(base))
            .slice(0, 6),
        );
      })
      .catch(() => setVoices([]));
    return () => {
      mounted = false;
    };
  }, [settings.language]);

  useEffect(() => () => void Speech.stop(), []);

  const play = () => {
    const content = text.trim();
    if (!content) return;
    void Speech.stop();
    setState("playing");
    Speech.speak(content, {
      language: settings.language,
      rate: settings.speechRate,
      ...(voice ? { voice } : {}),
      onDone: () => setState("idle"),
      onStopped: () => setState("idle"),
      onError: () => setState("idle"),
    });
  };

  const stop = () => {
    void Speech.stop();
    setState("idle");
  };

  const togglePause = async () => {
    if (state === "playing") {
      await Speech.pause();
      setState("paused");
    } else if (state === "paused") {
      await Speech.resume();
      setState("playing");
    }
  };

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
          <View style={styles.header}>
            <Title>{t.reader.title}</Title>
            <Text style={styles.muted}>{t.reader.subtitle}</Text>
          </View>

          <View style={styles.field}>
            <Label>{t.reader.text}</Label>
            <TextInput
              accessibilityLabel={t.reader.text}
              multiline
              value={text}
              onChangeText={setText}
              placeholder={t.reader.placeholder}
              placeholderTextColor={colors.muted}
              style={styles.textarea}
            />
            {latest && !text ? (
              <Button
                compact
                label={t.reader.useLatest}
                variant="ghost"
                onPress={() => setText(latest.refinedText)}
              />
            ) : null}
          </View>

          <Card>
            <Label>{t.reader.speed}</Label>
            <View style={styles.chips}>
              {RATES.map((rate) => (
                <Chip
                  key={rate}
                  label={`${rate}×`}
                  selected={settings.speechRate === rate}
                  onPress={() => void updateSettings({ speechRate: rate })}
                />
              ))}
            </View>
            {voices.length > 0 ? (
              <>
                <Label>{t.reader.voice.toUpperCase()}</Label>
                <View style={styles.chips}>
                  <Chip
                    label={t.reader.systemVoice}
                    selected={!voice}
                    onPress={() => setVoice(undefined)}
                  />
                  {voices.map((v) => (
                    <Chip
                      key={v.identifier}
                      label={v.name}
                      selected={voice === v.identifier}
                      onPress={() => setVoice(v.identifier)}
                    />
                  ))}
                </View>
              </>
            ) : null}
            <View style={styles.controls}>
              {state === "idle" ? (
                <Button
                  variant="primary"
                  icon="play"
                  label={t.reader.play}
                  disabled={!text.trim()}
                  onPress={play}
                  style={styles.flex}
                />
              ) : canPause ? (
                <Button
                  variant="primary"
                  icon={state === "playing" ? "pause" : "play"}
                  label={state === "playing" ? t.reader.pause : t.reader.resume}
                  onPress={() => void togglePause()}
                  style={styles.flex}
                />
              ) : (
                <Button
                  variant="primary"
                  icon="play"
                  label={t.reader.play}
                  onPress={play}
                  style={styles.flex}
                />
              )}
              <Button
                icon="stop"
                accessibilityLabel={t.reader.stop}
                disabled={state === "idle"}
                onPress={stop}
              />
            </View>
            {!text.trim() ? (
              <Text style={styles.muted}>{t.reader.empty}</Text>
            ) : null}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  container: { padding: space.xl, gap: space.lg, paddingBottom: 40 },
  header: { gap: 6 },
  muted: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
  field: { gap: space.sm },
  textarea: {
    minHeight: 220,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 25,
    textAlignVertical: "top",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  controls: { flexDirection: "row", gap: 10, alignItems: "center" },
});
