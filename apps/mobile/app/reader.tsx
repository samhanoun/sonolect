import { useCallback, useEffect, useState } from "react";
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
import { useLocales } from "expo-localization";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { strings } from "../src/i18n";
import { formattingLocale } from "../src/library";
import { useCompanionStore } from "../src/store";
import { ttsController, useTts } from "../src/tts";
import { filterVoices, formatRate, voiceLabel } from "../src/ttsCore";
import {
  Button,
  Card,
  Chip,
  Label,
  Title,
  inputColors,
} from "../src/ui/components";
import { colors, fonts, radius, space } from "../src/ui/theme";

const RATES = [0.75, 1, 1.25, 1.5];
/** The Reader's playback, as the read-aloud controller knows it. */
const READER_ID = "reader";

export default function ReaderScreen() {
  const settings = useCompanionStore((s) => s.settings);
  const latest = useCompanionStore((s) => s.latest);
  const captureStatus = useCompanionStore((s) => s.capture.status);
  const updateSettings = useCompanionStore((s) => s.updateSettings);
  const t = strings(settings.uiLanguage);
  const tts = useTts();
  const [text, setText] = useState("");
  /** The language of a capture loaded with 'Use latest' (ux-21). */
  const [sourceLanguage, setSourceLanguage] = useState<string | null>(null);
  const [voices, setVoices] = useState<Speech.Voice[]>([]);
  const [voice, setVoice] = useState<string | undefined>();
  const canPause = Platform.OS === "ios";
  const language = sourceLanguage ?? settings.language;
  const locale = formattingLocale(
    settings.uiLanguage,
    useLocales()[0]?.languageTag,
  );
  // Playback state comes from the controller, so a stop from a replaced
  // utterance can't reset it (speech-14); Library playback is not ours.
  const state = tts.ownerId === READER_ID ? tts.status : "idle";
  // The microphone would hear it (speech-4).
  const captureBusy =
    captureStatus === "listening" || captureStatus === "processing";

  useEffect(() => {
    let mounted = true;
    Speech.getAvailableVoicesAsync()
      .then((all) => {
        if (!mounted) return;
        const kept = filterVoices(all, language, Platform.OS);
        setVoices(kept);
        setVoice((current) =>
          current && kept.some((v) => v.identifier === current)
            ? current
            : undefined,
        );
      })
      .catch(() => {
        if (mounted) setVoices([]);
      });
    return () => {
      mounted = false;
    };
  }, [language]);

  // Tabs stay mounted: leaving the Reader stops it (speech-4).
  useFocusEffect(
    useCallback(
      () => () => {
        void ttsController.stop();
      },
      [],
    ),
  );

  const onChangeText = (value: string) => {
    setText(value);
    if (!value.trim()) setSourceLanguage(null);
  };

  const loadLatest = () => {
    if (!latest) return;
    setText(latest.refinedText);
    setSourceLanguage(latest.language !== "auto" ? latest.language : null);
  };

  const play = () => {
    ttsController.play(READER_ID, text, {
      language,
      rate: settings.speechRate,
      ...(voice ? { voice } : {}),
    });
  };

  const togglePause = () => {
    if (state === "playing") void ttsController.pause();
    else if (state === "paused") void ttsController.resume();
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
            {/* A long article scrolls inside the box, so Play stays in
                reach (ux-21). */}
            <TextInput
              accessibilityLabel={t.reader.text}
              multiline
              scrollEnabled
              value={text}
              onChangeText={onChangeText}
              placeholder={t.reader.placeholder}
              placeholderTextColor={colors.muted}
              style={styles.textarea}
              {...inputColors}
            />
            {latest && !text ? (
              <Button
                compact
                label={t.reader.useLatest}
                variant="ghost"
                onPress={loadLatest}
              />
            ) : null}
          </View>

          <Card>
            <Label>{t.reader.speed}</Label>
            <View style={styles.chips}>
              {RATES.map((rate) => (
                <Chip
                  key={rate}
                  label={formatRate(rate, locale)}
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
                  {voices.map((v, index) => (
                    <Chip
                      key={v.identifier}
                      label={voiceLabel(v, index, t, Platform.OS)}
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
                  disabled={!text.trim() || captureBusy}
                  onPress={play}
                  style={styles.flex}
                />
              ) : canPause ? (
                <Button
                  variant="primary"
                  icon={state === "playing" ? "pause" : "play"}
                  label={state === "playing" ? t.reader.pause : t.reader.resume}
                  onPress={togglePause}
                  style={styles.flex}
                />
              ) : (
                <Button
                  variant="primary"
                  icon="play"
                  label={t.reader.play}
                  disabled={!text.trim() || captureBusy}
                  onPress={play}
                  style={styles.flex}
                />
              )}
              <Button
                icon="stop"
                accessibilityLabel={t.reader.stop}
                disabled={state === "idle"}
                onPress={() => void ttsController.stop()}
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
    maxHeight: 280,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineInteractive,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 25,
    textAlignVertical: "top",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  controls: { flexDirection: "row", gap: 10, alignItems: "center" },
});
