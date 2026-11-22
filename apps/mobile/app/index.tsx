import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";

import { openPrivacyPolicy, privacyPolicyUrl } from "../src/appInfo";
import { apiConfig, availableRefinementModes } from "../src/features";
import { strings } from "../src/i18n";
import { formatDuration } from "../src/library";
import { actionLabel, noticeText, type NoticeAction } from "../src/notices";
import type { RefinementMode } from "../src/domain";
import {
  PROVIDER_NAMES,
  isOnlineEditingReady,
  isOnlineMode,
} from "../src/onlineRefine";
import { requestDictationPermission } from "../src/speech";
import { useCompanionStore } from "../src/store";
import {
  copyText,
  currentShareTarget,
  openAppSettings,
  shareText,
} from "../src/ui/actions";
import {
  Button,
  CHROME_MAX_FONT_SCALE,
  Card,
  Chip,
  Icon,
  Label,
  MicOrb,
  TextLink,
  Waveform,
  inputColors,
} from "../src/ui/components";
import { confirm } from "../src/ui/confirm";
import { FadeIn, GlassScreen, glassStyles } from "../src/ui/glass";
import { useTabBarClearance } from "../src/ui/GlassTabBar";
import { useReducedMotion, useReducedTransparency } from "../src/ui/motion";
import { colors, fonts, modeColor, radius, space } from "../src/ui/theme";
import { useRecognitionPlan } from "../src/useRecognitionPlan";

/** Fixed for the build (app.config.js); null hides the link. */
const POLICY_URL = privacyPolicyUrl();

/** Cancel asks first once a dictation is longer than this. */
const CONFIRM_CANCEL_AFTER_MS = 15_000;

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
  const refiningMode = useCompanionStore((s) => s.refiningMode);
  const sendingTo = useCompanionStore((s) => s.sendingTo);
  const onlineKeySaved = useCompanionStore((s) => s.onlineKeySaved);
  const onlinePlan = useCompanionStore((s) => s.onlinePlan);
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
  const router = useRouter();

  const clearance = useTabBarClearance();
  const reduced = useReducedMotion();
  const opaque = useReducedTransparency();
  /** The backdrop's lime light rises while the microphone listens. */
  const glow = useRef(new Animated.Value(0)).current;
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [asking, setAsking] = useState(false);
  /** The Send dialog of online editing is open: a second tap does nothing. */
  const consenting = useRef(false);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const liveRef = useRef<ScrollViewInstance>(null);
  /** The typing card's y in the screen's ScrollView, once laid out. */
  const typingY = useRef<number | null>(null);
  /** The typing card scrolls into view once it is laid out. */
  const scrollToTyping = useRef(false);

  const listening = capture.status === "listening";
  const processing = capture.status === "processing";
  const ready = capture.status === "ready";
  const capturing = listening || processing;
  // The plan in use while dictating (it can switch to the speech service
  // after consent), otherwise the plan the next dictation would follow.
  const idlePlan = useRecognitionPlan(settings, capturing);
  const plan = capturing ? (storePlan ?? idlePlan) : idlePlan;
  const apiConnected = Boolean(apiConfig(settings, apiToken).apiUrl);
  // Rewrite and Reply with the user's own key: a provider, a model and a
  // saved key, and never in the web preview.
  const onlineEditing = isOnlineEditingReady(
    settings,
    onlineKeySaved,
    Platform.OS === "web",
  )
    ? settings.onlineEditing
    : undefined;

  useEffect(() => {
    const animation = Animated.timing(glow, {
      toValue: listening ? 1 : 0,
      duration: reduced ? 0 : 700,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [listening, reduced, glow]);

  useEffect(() => {
    if (!listening || !capture.startedAt) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.parse(capture.startedAt);
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(timer);
  }, [listening, capture.startedAt]);

  /** Not scrollToEnd: REFINE LATEST comes after the typing card. */
  const scrollToTypingCard = (): boolean => {
    const y = typingY.current;
    if (y === null) return false;
    scrollRef.current?.scrollTo({
      y: Math.max(0, y - space.md),
      animated: true,
    });
    return true;
  };

  const openTyping = () => {
    if (typing && scrollToTypingCard()) return;
    scrollToTyping.current = true;
    setTyping(true);
  };

  // This phone can't dictate: typing is the way in.
  useEffect(() => {
    if (notice?.kind === "unavailable") openTyping();
  }, [notice]);

  // The typing card is hidden while dictating; closing it keeps its focus
  // (and the keyboard) from coming back when the dictation ends.
  useEffect(() => {
    if (listening) setTyping(false);
  }, [listening]);

  // Android Back while dictating stops it and keeps the text, instead of
  // leaving the screen with the microphone on.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return undefined;
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          const state = useCompanionStore.getState();
          if (state.capture.status !== "listening") return false;
          state.stopCapture();
          return true;
        },
      );
      return () => subscription.remove();
    }, []),
  );

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

  // Dictation keeps running while the dialog is open.
  const onCancel = async () => {
    const { id, startedAt } = capture;
    const ranMs = startedAt ? Date.now() - Date.parse(startedAt) : 0;
    if (ranMs > CONFIRM_CANCEL_AFTER_MS) {
      const discard = await confirm({
        title: t.capture.discardTitle,
        confirmLabel: t.capture.discard,
        cancelLabel: t.capture.keepDictating,
        destructive: true,
      });
      if (!discard) return;
      // It may have ended, and been saved, while the dialog was open.
      const current = useCompanionStore.getState().capture;
      if (current.id !== id || current.status !== "listening") return;
    }
    cancelCapture();
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
      case "openOnlineSettings":
        dismissNotice();
        // A new value each time, so Settings scrolls to the section again.
        router.navigate({
          pathname: "/settings",
          params: { section: "online", at: String(Date.now()) },
        });
        break;
      case "typeInstead":
        openTyping();
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

  /**
   * A refinement chip. Rewrite and Reply with online editing ask before
   * sending the note, unless "Send without asking" is on outside Ephemeral.
   * The dialog names the provider and the model; Send agrees to those only.
   */
  const onRefine = async (turnId: string, mode: RefinementMode) => {
    if (consenting.current) return;
    const plan = onlinePlan(turnId, mode);
    if (plan.kind !== "ask") {
      await refine(turnId, mode);
      return;
    }
    const { provider, model } = plan.editing;
    const name = PROVIDER_NAMES[provider];
    const o = t.settings.onlineEditing;
    consenting.current = true;
    let send = false;
    try {
      send = await confirm({
        title: o.consentTitle(name),
        message: o.consentMessage(t.modes[mode], name, model),
        confirmLabel: o.send,
        cancelLabel: t.common.cancel,
      });
    } finally {
      consenting.current = false;
    }
    if (send) await refine(turnId, mode, { consentedTo: { provider, model } });
  };

  // partialTranscript goes stale after a refine, a delete or a clear.
  const liveText = capturing
    ? capture.partialTranscript
    : ready && latest
      ? latest.refinedText
      : "";

  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copyLatest = async () => {
    if (!latest) return;
    // A failure says so instead of failing silently (data-14).
    if (!(await copyText(latest.refinedText, t))) return;
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  const showOnboarding = !settings.onboarded;

  return (
    <GlassScreen glow={glow}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.container,
            { paddingBottom: clearance + space.lg },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <FadeIn style={styles.header}>
            <View style={styles.shrink}>
              <Text style={styles.brand}>
                sono<Text style={{ color: colors.lime }}>lect</Text>
              </Text>
              <Label>{t.brandTag}</Label>
            </View>
            {modeBadge ? (
              <View
                style={[
                  glassStyles.panel,
                  styles.modePill,
                  styles.shrink,
                  opaque && glassStyles.panelOpaque,
                ]}
                accessibilityLabel={modeBadge.label}
              >
                <Icon name={modeBadge.icon} size={14} color={colors.lime} />
                <Text
                  maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
                  style={styles.modePillText}
                >
                  {modeBadge.label}
                </Text>
              </View>
            ) : null}
          </FadeIn>

          {showOnboarding ? (
            <Card strong style={styles.onboarding} enterIndex={1}>
              <Text style={styles.onboardingTitle}>{t.onboarding.title}</Text>
              <Text style={styles.muted}>{t.onboarding.body}</Text>
              {POLICY_URL ? (
                <TextLink
                  label={t.settings.privacyPolicy}
                  onPress={() => openPrivacyPolicy(POLICY_URL)}
                />
              ) : null}
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

          <FadeIn index={1} style={styles.stage}>
            <Label
              color={listening ? colors.lime : colors.muted}
              style={styles.status}
            >
              {statusLabel}
            </Label>
            {notice ? (
              <View
                style={[
                  glassStyles.panel,
                  glassStyles.panelStrong,
                  styles.notice,
                  opaque && glassStyles.panelOpaque,
                ]}
                accessibilityRole="alert"
              >
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
              level={level}
            />
            <Waveform level={level} active={listening} />
            <ScrollView
              ref={liveRef}
              style={styles.liveScroll}
              contentContainerStyle={styles.liveContent}
              nestedScrollEnabled
              accessibilityLabel={t.capture.liveTranscript}
              onContentSizeChange={() =>
                liveRef.current?.scrollToEnd({ animated: false })
              }
            >
              <View style={styles.liveRow}>
                <Text style={styles.live} numberOfLines={ready ? 4 : undefined}>
                  {liveText || (listening ? "" : t.capture.hint)}
                </Text>
                {listening ? (
                  // A nested Text would be read as part of the transcript.
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <Text style={[styles.live, styles.cursor]}>▍</Text>
                  </View>
                ) : null}
              </View>
            </ScrollView>
            {listening ? (
              <Button
                label={t.capture.cancel}
                onPress={() => void onCancel()}
              />
            ) : (
              <Button
                icon="keyboard"
                label={t.capture.typeInstead}
                variant="ghost"
                onPress={() => (typing ? setTyping(false) : openTyping())}
              />
            )}
            {serviceNote ? (
              <Text style={styles.noteSmall}>{serviceNote}</Text>
            ) : null}
            {settings.privacyLevel === "ephemeral" ? (
              <Text style={styles.noteSmall}>{t.capture.ephemeralNote}</Text>
            ) : null}
          </FadeIn>

          {typing && !listening ? (
            <View
              onLayout={(event) => {
                typingY.current = event.nativeEvent.layout.y;
                if (!scrollToTyping.current) return;
                scrollToTyping.current = false;
                scrollToTypingCard();
              }}
            >
              <Card style={styles.typingCard}>
                <TextInput
                  autoFocus
                  accessibilityLabel={t.capture.typePlaceholder}
                  multiline
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={t.capture.typePlaceholder}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  {...inputColors}
                />
                {/* Not while a dictation is processed: its text comes first. */}
                <Button
                  variant="primary"
                  label={t.capture.saveTyped}
                  disabled={!draft.trim() || capturing}
                  onPress={async () => {
                    // A refused save keeps the draft.
                    if (!(await saveTyped(draft))) return;
                    setDraft("");
                    setTyping(false);
                  }}
                />
              </Card>
            </View>
          ) : null}

          <FadeIn index={2} style={styles.section}>
            <Label heading>{t.capture.afterCapture}</Label>
            {latest ? (
              <Card>
                <View style={styles.metaRow}>
                  <Label color={modeColor(latest.mode)}>
                    {t.modeTag[latest.mode] ?? latest.mode}
                  </Label>
                  <Label>
                    {refining
                      ? sendingTo
                        ? t.settings.onlineEditing.sending(
                            PROVIDER_NAMES[sendingTo],
                          )
                        : t.capture.refining
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
                  {currentShareTarget() === "download" ? (
                    <Button
                      compact
                      icon="download"
                      label={t.capture.download}
                      onPress={() =>
                        void shareText(latest.refinedText, t, latest.createdAt)
                      }
                    />
                  ) : (
                    <Button
                      compact
                      icon="share"
                      label={t.capture.share}
                      onPress={() => void shareText(latest.refinedText, t)}
                    />
                  )}
                </View>
                <View style={styles.chips}>
                  {availableRefinementModes(onlineEditing !== undefined).map(
                    (mode) => {
                      const busy = refining && refiningMode === mode;
                      // The cloud marks a chip that sends the note out.
                      const online =
                        onlineEditing !== undefined && isOnlineMode(mode)
                          ? {
                              icon: "cloud" as const,
                              accessibilityHint:
                                t.settings.onlineEditing.chipHint(
                                  PROVIDER_NAMES[onlineEditing.provider],
                                ),
                            }
                          : {};
                      return (
                        <Chip
                          key={mode}
                          label={t.modes[mode]}
                          selected={latest.mode === mode}
                          // One refinement at a time.
                          disabled={refining && !busy}
                          busy={busy}
                          {...online}
                          onPress={() => void onRefine(latest.id, mode)}
                        />
                      );
                    },
                  )}
                </View>
              </Card>
            ) : (
              <Text style={styles.muted}>{t.capture.noCaptureYet}</Text>
            )}
          </FadeIn>
        </ScrollView>
      </KeyboardAvoidingView>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: space.xl, gap: space.xl },
  // At large font sizes the mode pill wraps under the brand instead of
  // running off the screen (ux-19).
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  shrink: { flexShrink: 1, minWidth: 0 },
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
  },
  modePillText: {
    flexShrink: 1,
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
  liveScroll: { alignSelf: "stretch", maxHeight: 160 },
  liveContent: { alignItems: "center", minHeight: 52 },
  liveRow: { flexDirection: "row", alignItems: "flex-end", maxWidth: 330 },
  live: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 26,
    color: colors.text,
    textAlign: "center",
  },
  cursor: { flexShrink: 0, color: colors.lime },
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
    borderRadius: radius.lg,
    padding: space.md,
  },
  noticeText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  noticeActions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  // The card is the typing field's outline (ux-26), on every edge.
  typingCard: {
    borderColor: colors.lineInteractive,
    borderTopColor: colors.lineInteractive,
    borderBottomColor: colors.lineInteractive,
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
