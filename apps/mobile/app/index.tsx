import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
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

import { apiConfig, availableRefinementModes } from "../src/features";
import { strings } from "../src/i18n";
import { formatDuration } from "../src/library";
import { actionLabel, noticeText, type NoticeAction } from "../src/notices";
import { requestDictationPermission } from "../src/speech";
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
import { useRecognitionPlan } from "../src/useRecognitionPlan";

/** Settings > Sonolect; react-native-web has no app settings to open. */
function openAppSettings() {
  if (typeof Linking.openSettings !== "function") return;
  void Linking.openSettings().catch(() => undefined);
}

export default function CaptureScreen() {
  const settings = useCompanionStore((s) => s.settings);
  const apiToken = useCompanionStore((s) => s.apiToken);
  const capture = useCompanionStore((s) => s.capture);
  const level = useCompanionStore((s) => s.level);
  const latest = useCompanionStore((s) => s.latest);
  const notice = useCompanionStore((s) => s.notice);
  const storePlan = useCompanionStore((s) => s.plan);
  const downloading = useCompanionStore((s) => s.downloading);
  const refining = useCompanionStore((s) => s.refining);
  const startCapture = useCompanionStore((s) => s.startCapture);
  const stopCapture = useCompanionStore((s) => s.stopCapture);
  const cancelCapture = useCompanionStore((s) => s.cancelCapture);
  const saveTyped = useCompanionStore((s) => s.saveTyped);
  const refine = useCompanionStore((s) => s.refine);
  const updateSettings = useCompanionStore((s) => s.updateSettings);
  const downloadModel = useCompanionStore((s) => s.downloadModel);
  const allowSystemServiceAlways = useCompanionStore(
    (s) => s.allowSystemServiceAlways,
  );
  const showPermissionOutcome = useCompanionStore(
    (s) => s.showPermissionOutcome,
  );
  const dismissNotice = useCompanionStore((s) => s.dismissNotice);
  const t = strings(settings.uiLanguage);

  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [asking, setAsking] = useState(false);

  const listening = capture.status === "listening";
  const processing = capture.status === "processing";
  const capturing = listening || processing;
  // The plan in use while dictating (it can switch to the speech service
  // after consent), otherwise the plan the next dictation would follow.
  const idlePlan = useRecognitionPlan(settings, capturing);
  const plan = capturing ? (storePlan ?? idlePlan) : idlePlan;
  const apiConnected = Boolean(apiConfig(settings, apiToken).apiUrl);

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
    if (notice?.kind === "unavailable") setTyping(true);
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

  // No badge until the plan is known, nor when this phone can't dictate.
  const modeBadge = apiConnected
    ? { icon: "cloud" as const, label: t.mode.api }
    : !plan || plan.blockedReason === "unavailable"
      ? null
      : plan.badge === "on-device"
        ? { icon: "lock" as const, label: t.mode.onDevice }
        : {
            icon: "cloud" as const,
            label:
              plan.badge === "apple-service"
                ? t.mode.appleService
                : t.mode.deviceService,
          };

  const serviceNote =
    !apiConnected && plan?.route === "system-service"
      ? plan.badge === "apple-service"
        ? t.capture.appleServiceNote
        : t.capture.systemServiceNote
      : null;

  const onNoticeAction = (action: NoticeAction) => {
    switch (action) {
      case "downloadModel":
        void downloadModel();
        break;
      case "useServiceOnce":
        void startCapture({ allowSystemServiceOnce: true });
        break;
      case "alwaysAllow":
        void allowSystemServiceAlways();
        break;
      case "openSettings":
        openAppSettings();
        break;
      case "typeInstead":
        setTyping(true);
        dismissNotice();
        break;
      case "dismiss":
        dismissNotice();
        break;
    }
  };

  // iOS shows its own permission prompts, so onboarding always goes on to
  // them; the on-device route there needs the microphone only.
  const onOnboardingAllow = async () => {
    if (asking) return;
    setAsking(true);
    try {
      const outcome = await requestDictationPermission({
        needsSpeechRecognizer:
          Platform.OS === "ios" && plan?.route !== "on-device",
      });
      await updateSettings({ onboarded: true });
      showPermissionOutcome(outcome);
    } finally {
      setAsking(false);
    }
  };

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
            {modeBadge ? (
              <View
                style={styles.modePill}
                accessibilityLabel={modeBadge.label}
              >
                <Icon name={modeBadge.icon} size={14} color={colors.lime} />
                <Text style={styles.modePillText}>{modeBadge.label}</Text>
              </View>
            ) : null}
          </View>

          {showOnboarding ? (
            <Card style={styles.onboarding}>
              <Text style={styles.onboardingTitle}>{t.onboarding.title}</Text>
              <Text style={styles.muted}>{t.onboarding.body}</Text>
              <View style={styles.row}>
                <Button
                  variant="primary"
                  icon="mic"
                  label={
                    Platform.OS === "ios"
                      ? t.onboarding.continue
                      : t.onboarding.allow
                  }
                  disabled={asking}
                  onPress={() => void onOnboardingAllow()}
                />
                {Platform.OS === "ios" ? null : (
                  <Button
                    variant="ghost"
                    label={t.onboarding.skip}
                    disabled={asking}
                    onPress={() => void updateSettings({ onboarded: true })}
                  />
                )}
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
            {notice ? (
              <View style={styles.notice} accessibilityRole="alert">
                <Text style={styles.noticeText}>{noticeText(t, notice)}</Text>
                <View style={styles.noticeActions}>
                  {notice.actions.map((action) => {
                    const busy = action === "downloadModel" && downloading;
                    return (
                      <Button
                        key={action}
                        compact
                        label={
                          busy ? t.capture.downloading : actionLabel(t, action)
                        }
                        disabled={busy}
                        onPress={() => onNoticeAction(action)}
                      />
                    );
                  })}
                </View>
              </View>
            ) : null}
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
            {serviceNote ? (
              <Text style={styles.noteSmall}>{serviceNote}</Text>
            ) : null}
            {settings.privacyLevel === "ephemeral" ? (
              <Text style={styles.noteSmall}>{t.capture.ephemeralNote}</Text>
            ) : null}
          </View>

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
                  {availableRefinementModes().map((mode) => (
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
    alignSelf: "stretch",
    gap: space.sm,
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
  noticeActions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
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
