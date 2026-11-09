import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { REFINEMENT_MODES } from "../src/domain";
import { strings } from "../src/i18n";
import { formatDuration } from "../src/library";
import { resolveMobileLocalApiConfig } from "../src/localApi";
import {
  getSpeechAvailability,
  requestMicrophonePermission,
} from "../src/speech";
import { useCompanionStore } from "../src/store";
import {
  Button,
  Card,
  Chip,
  Icon,
  Label,
  MicOrb,
  Waveform,
} from "../src/ui/components";
import { colors, fonts, modeColor, radius, space } from "../src/ui/theme";

export default function CaptureScreen() {
  const settings = useCompanionStore((s) => s.settings);
  const apiToken = useCompanionStore((s) => s.apiToken);
  const capture = useCompanionStore((s) => s.capture);
  const level = useCompanionStore((s) => s.level);
  const latest = useCompanionStore((s) => s.latest);
  const notice = useCompanionStore((s) => s.notice);
  const noticeDetail = useCompanionStore((s) => s.noticeDetail);
  const refining = useCompanionStore((s) => s.refining);
  const startCapture = useCompanionStore((s) => s.startCapture);
  const stopCapture = useCompanionStore((s) => s.stopCapture);
  const cancelCapture = useCompanionStore((s) => s.cancelCapture);
  const saveTyped = useCompanionStore((s) => s.saveTyped);
  const refine = useCompanionStore((s) => s.refine);
  const updateSettings = useCompanionStore((s) => s.updateSettings);
  const t = strings(settings.uiLanguage);

  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const listening = capture.status === "listening";
  const processing = capture.status === "processing";
  const availability = useMemo(() => getSpeechAvailability(), []);
  const apiConnected = Boolean(
    resolveMobileLocalApiConfig({ ...settings, apiToken }).apiUrl,
  );

  useEffect(() => {
    if (!listening || !capture.startedAt) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.parse(capture.startedAt);
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(timer);
  }, [listening, capture.startedAt]);

  useEffect(() => {
    if (notice === "unavailable") setTyping(true);
  }, [notice]);

  const haptic = () => {
    if (settings.hapticsEnabled && Platform.OS !== "web") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
        () => undefined,
      );
    }
  };

  const onOrbPress = () => {
    haptic();
    if (listening) stopCapture();
    else void startCapture();
  };

  const statusLabel = listening
    ? `● ${t.capture.listening} · ${formatDuration(elapsed)}`
    : processing
      ? t.capture.processing
      : capture.status === "ready"
        ? t.capture.ready
        : capture.status === "error"
          ? t.capture.error
          : t.capture.idle;

  const modeBadge = apiConnected
    ? { icon: "cloud" as const, label: t.mode.api }
    : availability.available && availability.onDevice
      ? { icon: "lock" as const, label: t.mode.onDevice }
      : { icon: "cloud" as const, label: t.mode.deviceService };

  const noticeText =
    notice === "noSpeech"
      ? t.capture.noSpeech
      : notice === "unavailable"
        ? t.capture.unavailable
        : notice === "permissionDenied"
          ? t.capture.permissionDenied
          : notice === "needsModel"
            ? t.capture.needsModel
            : notice === "error"
              ? (noticeDetail ?? t.capture.noSpeech)
              : null;

  const liveText = listening || processing ? capture.partialTranscript : "";

  const copyLatest = async () => {
    if (!latest) return;
    await Clipboard.setStringAsync(latest.refinedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const showOnboarding = !settings.onboarded;

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
            <View>
              <Text style={styles.brand}>
                sono<Text style={{ color: colors.lime }}>lect</Text>
              </Text>
              <Label>{t.brandTag}</Label>
            </View>
            <View style={styles.modePill} accessibilityLabel={modeBadge.label}>
              <Icon name={modeBadge.icon} size={14} color={colors.lime} />
              <Text style={styles.modePillText}>{modeBadge.label}</Text>
            </View>
          </View>

          {showOnboarding ? (
            <Card style={styles.onboarding}>
              <Text style={styles.onboardingTitle}>{t.onboarding.title}</Text>
              <Text style={styles.muted}>{t.onboarding.body}</Text>
              <View style={styles.row}>
                <Button
                  variant="primary"
                  icon="mic"
                  label={t.onboarding.allow}
                  onPress={async () => {
                    await requestMicrophonePermission();
                    await updateSettings({ onboarded: true });
                  }}
                />
                <Button
                  variant="ghost"
                  label={t.onboarding.skip}
                  onPress={() => void updateSettings({ onboarded: true })}
                />
              </View>
            </Card>
          ) : null}

          <View style={styles.stage}>
            <Label
              color={listening ? colors.lime : colors.muted}
              style={styles.status}
            >
              {statusLabel}
            </Label>
            <MicOrb
              listening={listening}
              busy={processing}
              label={listening ? t.capture.done : t.capture.speak}
              onPress={onOrbPress}
              accessibilityLabel={
                listening ? t.capture.done : t.capture.tapToSpeak
              }
            />
            <Waveform level={level} active={listening} />
            <Text style={styles.live} accessibilityLiveRegion="polite">
              {liveText || (listening ? "" : t.capture.hint)}
              {listening ? <Text style={{ color: colors.lime }}>▍</Text> : null}
            </Text>
            {listening ? (
              <Button label={t.capture.cancel} onPress={cancelCapture} />
            ) : (
              <Button
                icon="keyboard"
                label={t.capture.typeInstead}
                variant="ghost"
                onPress={() => setTyping((value) => !value)}
              />
            )}
            {settings.privacyLevel !== "standard" &&
            availability.available &&
            !availability.onDevice &&
            !apiConnected ? (
              <Text style={styles.noteSmall}>{t.capture.cloudFallback}</Text>
            ) : null}
            {settings.privacyLevel === "ephemeral" ? (
              <Text style={styles.noteSmall}>{t.capture.ephemeralNote}</Text>
            ) : null}
          </View>

          {noticeText ? (
            <View style={styles.notice} accessibilityRole="alert">
              <Text style={styles.noticeText}>{noticeText}</Text>
            </View>
          ) : null}

          {typing && !listening ? (
            <Card>
              <TextInput
                accessibilityLabel={t.capture.typePlaceholder}
                multiline
                value={draft}
                onChangeText={setDraft}
                placeholder={t.capture.typePlaceholder}
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              <Button
                variant="primary"
                label={t.capture.saveTyped}
                disabled={!draft.trim()}
                onPress={async () => {
                  await saveTyped(draft);
                  setDraft("");
                  setTyping(false);
                }}
              />
            </Card>
          ) : null}

          <View style={styles.section}>
            <Label>{t.capture.afterCapture}</Label>
            {latest ? (
              <Card>
                <View style={styles.metaRow}>
                  <Label color={modeColor(latest.mode)}>
                    {t.modeTag[latest.mode] ?? latest.mode}
                  </Label>
                  <Label>
                    {refining
                      ? t.capture.refining
                      : latest.source === "typed"
                        ? t.library.typed
                        : formatDuration(latest.durationMs)}
                  </Label>
                </View>
                <Text selectable style={styles.latestText}>
                  {latest.refinedText}
                </Text>
                <View style={styles.row}>
                  <Button
                    compact
                    icon="copy"
                    label={copied ? t.capture.copied : t.capture.copy}
                    onPress={() => void copyLatest()}
                  />
                  <Button
                    compact
                    icon="share"
                    label={t.capture.share}
                    onPress={() =>
                      void Share.share({ message: latest.refinedText }).catch(
                        () => undefined,
                      )
                    }
                  />
                </View>
                <View style={styles.chips}>
                  {REFINEMENT_MODES.map((mode) => (
                    <Chip
                      key={mode}
                      label={t.modes[mode]}
                      selected={latest.mode === mode}
                      disabled={refining}
                      onPress={() => void refine(latest.id, mode)}
                    />
                  ))}
                </View>
              </Card>
            ) : (
              <Text style={styles.muted}>{t.capture.noCaptureYet}</Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  container: { padding: space.xl, paddingBottom: 40, gap: space.xl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    fontFamily: fonts.display,
    fontSize: 22,
    letterSpacing: -0.5,
    color: colors.text,
  },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  modePillText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.text,
  },
  onboarding: { gap: space.md },
  onboardingTitle: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.text,
    letterSpacing: -0.5,
  },
  stage: { alignItems: "center", gap: space.lg, paddingVertical: space.sm },
  status: { fontSize: 12, letterSpacing: 2 },
  live: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 26,
    color: colors.text,
    textAlign: "center",
    minHeight: 52,
    maxWidth: 330,
  },
  noteSmall: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
    maxWidth: 320,
  },
  notice: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceStrong,
    padding: space.md,
  },
  noticeText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  input: {
    minHeight: 110,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: "top",
  },
  section: { gap: space.md },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  latestText: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
  },
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  muted: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
  },
});
