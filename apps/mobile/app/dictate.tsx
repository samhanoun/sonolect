import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  BackHandler,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useIsFocused, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { strings, type Strings } from "../src/i18n";
import { actionLabel, noticeText, type NoticeAction } from "../src/notices";
import {
  dictationResult,
  isQuickDictationLink,
  leaveAction,
  quickStart,
  stillHeard,
} from "../src/quickDictation";
import { useCompanionStore } from "../src/store";
import { copyText, openAppSettings } from "../src/ui/actions";
import { Button, MicOrb, Waveform } from "../src/ui/components";
import { Backdrop, glassStyles } from "../src/ui/glass";
import { useReducedMotion, useReducedTransparency } from "../src/ui/motion";
import { colors, fonts, radius, space } from "../src/ui/theme";

/** Where to paste: iOS shows a way back to the previous app, top left. */
function pasteHint(t: Strings): string {
  return Platform.OS === "ios" ? t.dictate.pasteIos : t.dictate.paste;
}

/** Read after what is being read (the transcript), where the OS can queue. */
function announceQueued(message: string) {
  // react-native-web has no announceForAccessibilityWithOptions.
  if (
    typeof AccessibilityInfo.announceForAccessibilityWithOptions === "function"
  ) {
    AccessibilityInfo.announceForAccessibilityWithOptions(message, {
      queue: true,
    });
  } else {
    AccessibilityInfo.announceForAccessibility(message);
  }
}

/**
 * Quick dictation (sonolect://dictate): starts listening as soon as it opens,
 * then copies the polished text so it can be pasted into the app the user
 * came from. This is the iOS stand-in for a floating bubble, because iOS
 * keyboard extensions cannot record audio.
 *
 * Tab screens stay mounted once visited, so the sheet is mounted only while
 * it is in front: every visit listens again, and a dictation made elsewhere
 * in the app never reaches the clipboard.
 */
export default function QuickDictateScreen() {
  return useIsFocused() ? <QuickDictateSheet /> : <View style={s.screen} />;
}

function QuickDictateSheet() {
  const router = useRouter();
  const capture = useCompanionStore((st) => st.capture);
  const level = useCompanionStore((st) => st.level);
  const notice = useCompanionStore((st) => st.notice);
  const downloading = useCompanionStore((st) => st.downloading);
  const uiLanguage = useCompanionStore((st) => st.settings.uiLanguage);
  const startCapture = useCompanionStore((st) => st.startCapture);
  const stopCapture = useCompanionStore((st) => st.stopCapture);
  const downloadModel = useCompanionStore((st) => st.downloadModel);
  const allowSystemServiceAlways = useCompanionStore(
    (st) => st.allowSystemServiceAlways,
  );
  const dismissNotice = useCompanionStore((st) => st.dismissNotice);
  const t = strings(uiLanguage);

  /** The text this visit dictated, and whether it reached the clipboard. */
  const [result, setResult] = useState<{
    text: string;
    copied: boolean;
  } | null>(null);
  /** A dictation should start as soon as quickStart allows. */
  const wanted = useRef(true);
  /** A dictation was heard during this visit: its text is this visit's. */
  const heard = useRef(false);
  /** False once the screen is left. */
  const shown = useRef(true);
  const reduced = useReducedMotion();
  const opaque = useReducedTransparency();
  /** The backdrop's lime light rises while the microphone listens. */
  const glow = useRef(new Animated.Value(0)).current;

  const listening = capture.status === "listening";
  const processing = capture.status === "processing";
  // Why dictation couldn't start or stopped, such as a missing language
  // pack or the speech service needing consent, with what to do about it.
  const showNotice = notice !== null && !listening && !processing;

  useEffect(() => {
    const animation = Animated.timing(glow, {
      toValue: listening ? 1 : 0,
      duration: reduced ? 0 : 700,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [listening, reduced, glow]);

  /** A start that ends up listening once the screen was left is dropped. */
  const afterStart = useCallback(() => {
    if (shown.current) return;
    const state = useCompanionStore.getState();
    if (state.capture.status === "listening") state.cancelCapture();
  }, []);

  const start = useCallback(
    (options?: { allowSystemServiceOnce: boolean }) => {
      setResult(null);
      void startCapture(options).finally(afterStart);
    },
    [startCapture, afterStart],
  );

  const tryStart = useCallback(() => {
    if (!wanted.current || !shown.current) return;
    const decision = quickStart(
      AppState.currentState,
      useCompanionStore.getState().capture.status,
    );
    if (decision === "wait") return;
    wanted.current = false;
    if (decision === "start") start();
  }, [start]);

  /** The orb, or the link arriving again: dictate as soon as possible. */
  const requestStart = useCallback(() => {
    wanted.current = true;
    tryStart();
  }, [tryStart]);

  // When the screen opens, then whenever what it waited for changes: the
  // previous dictation's polishing ends, or the app comes to the front.
  useEffect(() => {
    tryStart();
  }, [capture.status, tryStart]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") tryStart();
    });
    return () => subscription.remove();
  }, [tryStart]);

  // The link arriving while the screen is already in front (the Action
  // button pressed again) asks for another dictation.
  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (isQuickDictationLink(url)) requestStart();
    });
    return () => subscription.remove();
  }, [requestStart]);

  // Android Back while dictating finishes it and keeps the text, as on
  // Capture, instead of leaving with the microphone on.
  useEffect(() => {
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
  }, []);

  /** Copies this visit's text and says so; a refusal leaves a Copy button. */
  const deliver = useCallback(async (refined: string) => {
    const text = refined.trim();
    if (!text) return;
    // Resolves false, or rejects, when the clipboard refuses.
    const copied = await Clipboard.setStringAsync(text).catch(() => false);
    if (!shown.current) return;
    setResult({ text, copied });
    if (!copied) return;
    const { settings } = useCompanionStore.getState();
    if (settings.hapticsEnabled && Platform.OS !== "web") {
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => undefined);
    }
    const now = strings(settings.uiLanguage);
    announceQueued(`${now.dictate.copied}. ${pasteHint(now)}`);
  }, []);

  // Only a dictation heard during this visit is copied: the store also
  // finishes dictations from Capture and changes the latest note on its own.
  useEffect(() => {
    shown.current = true;
    heard.current = stillHeard(
      false,
      useCompanionStore.getState().capture.status,
    );
    const unsubscribe = useCompanionStore.subscribe((state, previous) => {
      const mine = heard.current;
      heard.current = stillHeard(mine, state.capture.status);
      const turn = mine ? dictationResult(previous, state) : null;
      if (turn) void deliver(turn.refinedText);
    });
    return () => {
      shown.current = false;
      unsubscribe();
      // Never listening unseen: leaving ends the dictation.
      const state = useCompanionStore.getState();
      const action = leaveAction(state.capture);
      if (action === "stop") state.stopCapture();
      else if (action === "cancel") state.cancelCapture();
    };
  }, [deliver]);

  // Leaving ends a dictation that is still listening (the effect above).
  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const copyResult = async () => {
    if (!result) return;
    const { text } = result;
    if (!(await copyText(text, t))) return;
    setResult((current) =>
      current?.text === text ? { text, copied: true } : current,
    );
  };

  const onNoticeAction = (action: NoticeAction) => {
    switch (action) {
      case "downloadModel":
        void downloadModel();
        break;
      case "useServiceOnce":
        start({ allowSystemServiceOnce: true });
        break;
      case "alwaysAllow":
        setResult(null);
        void allowSystemServiceAlways().finally(afterStart);
        break;
      case "openSettings":
        openAppSettings();
        break;
      case "typeInstead":
        // Typing lives on Capture, which shows this notice too.
        router.replace("/");
        break;
      case "dismiss":
        dismissNotice();
        break;
    }
  };

  const title = listening
    ? t.dictate.listening
    : processing
      ? t.dictate.polishing
      : result
        ? result.copied
          ? t.dictate.copied
          : t.dictate.ready
        : capture.status === "error"
          ? t.dictate.failed
          : t.dictate.title;

  const body =
    listening || processing
      ? capture.partialTranscript || t.dictate.speakHint
      : (result?.text ?? t.dictate.tapToStart);

  return (
    <View style={s.screen}>
      <Backdrop glow={glow} />
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <View
          style={[
            glassStyles.panel,
            glassStyles.panelStrong,
            opaque && glassStyles.panelOpaque,
            s.sheet,
          ]}
        >
          <Text style={s.title} accessibilityRole="header">
            {title}
          </Text>
          {showNotice ? (
            // The root layout announces each notice once: no live region.
            <View
              style={[
                glassStyles.panel,
                s.notice,
                opaque && glassStyles.panelOpaque,
              ]}
            >
              <Text style={s.noticeText}>{noticeText(t, notice)}</Text>
              <View style={s.noticeActions}>
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
          ) : (
            <Text style={s.body} numberOfLines={6}>
              {body}
            </Text>
          )}
          <View style={s.wave}>
            <Waveform level={level} active={listening} />
          </View>
          <MicOrb
            listening={listening}
            busy={processing}
            label={listening ? t.dictate.tapToFinish : t.capture.tapToSpeak}
            onPress={() => (listening ? stopCapture() : requestStart())}
            accessibilityLabel={
              listening ? t.dictate.a11yFinish : t.dictate.a11yStart
            }
            level={level}
          />
          {result?.copied && !showNotice && !listening && !processing ? (
            <Text style={s.hint}>{pasteHint(t)}</Text>
          ) : null}
          <View style={s.actions}>
            {result && !result.copied && !listening && !processing ? (
              // The clipboard refused the automatic copy: a tap is allowed.
              <Button
                label={t.capture.copy}
                icon="copy"
                onPress={() => void copyResult()}
              />
            ) : null}
            <Button label={t.dictate.close} variant="ghost" onPress={close} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  sheet: {
    flex: 1,
    margin: space.lg,
    padding: space.xl,
    borderRadius: radius.lg + 10,
    alignItems: "center",
    justifyContent: "center",
    gap: space.lg,
  },
  title: {
    color: colors.lime,
    fontFamily: fonts.display,
    fontSize: 28,
    textAlign: "center",
  },
  body: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 24,
    textAlign: "center",
    minHeight: 48,
  },
  notice: {
    alignSelf: "stretch",
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
  },
  noticeText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
  },
  noticeActions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  wave: { alignSelf: "stretch", alignItems: "center" },
  hint: {
    color: colors.muted,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    textAlign: "center",
  },
  actions: { flexDirection: "row", gap: space.sm },
});
