import { useEffect, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCompanionStore } from "../src/store";
import { Button, MicOrb, Waveform } from "../src/ui/components";
import { Backdrop, glassStyles } from "../src/ui/glass";
import { useReducedMotion, useReducedTransparency } from "../src/ui/motion";
import { colors, fonts, radius, space } from "../src/ui/theme";

/**
 * Quick dictation (sonolect://dictate): starts listening as soon as it opens,
 * then copies the polished text so it can be pasted into the app the user
 * came from. This is the iOS stand-in for a floating bubble, because iOS
 * keyboard extensions cannot record audio.
 */
export default function QuickDictateScreen() {
  const router = useRouter();
  const capture = useCompanionStore((st) => st.capture);
  const level = useCompanionStore((st) => st.level);
  const latest = useCompanionStore((st) => st.latest);
  const haptics = useCompanionStore((st) => st.settings.hapticsEnabled);
  const startCapture = useCompanionStore((st) => st.startCapture);
  const stopCapture = useCompanionStore((st) => st.stopCapture);
  const cancelCapture = useCompanionStore((st) => st.cancelCapture);

  const startLatestId = useRef(latest?.id);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const opaque = useReducedTransparency();
  /** The backdrop's lime light rises while the microphone listens. */
  const glow = useRef(new Animated.Value(0)).current;

  const listening = capture.status === "listening";
  const processing = capture.status === "processing";

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
    if (useCompanionStore.getState().capture.status === "idle") {
      void startCapture();
    }
    // Start once when the screen opens.
  }, []);

  useEffect(() => {
    if (!latest || latest.id === startLatestId.current) return;
    startLatestId.current = latest.id;
    const text = latest.refinedText.trim();
    if (!text) return;
    void Clipboard.setStringAsync(text).then(() => {
      setCopiedText(text);
      if (haptics && Platform.OS !== "web") {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => undefined);
      }
    });
  }, [latest, haptics]);

  const close = () => {
    if (listening || processing) cancelCapture();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const again = () => {
    setCopiedText(null);
    void startCapture();
  };

  const title = listening
    ? "Listening…"
    : processing
      ? "Polishing…"
      : copiedText
        ? "Copied"
        : capture.status === "error"
          ? "Couldn't dictate"
          : "Quick dictation";

  const body =
    listening || processing
      ? capture.partialTranscript ||
        "Speak naturally. Tap the orb when you're done."
      : copiedText
        ? copiedText
        : "Tap the orb to start.";

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
          <Text style={s.body} numberOfLines={6}>
            {body}
          </Text>
          <View style={s.wave}>
            <Waveform level={level} active={listening} />
          </View>
          <MicOrb
            listening={listening}
            busy={processing}
            label={listening ? "Tap to finish" : "Tap to speak"}
            onPress={() => (listening ? stopCapture() : again())}
            accessibilityLabel={
              listening ? "Finish dictation" : "Start dictation"
            }
            level={level}
          />
          {copiedText ? (
            <Text style={s.hint}>
              {Platform.OS === "ios"
                ? "Go back to your app (top-left corner) and paste."
                : "Switch back to your app and paste."}
            </Text>
          ) : null}
          <View style={s.actions}>
            <Button label="Close" variant="ghost" onPress={close} />
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
  },
  body: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 24,
    textAlign: "center",
    minHeight: 48,
  },
  wave: { alignSelf: "stretch", alignItems: "center" },
  hint: {
    color: colors.muted,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    textAlign: "center",
  },
  actions: { flexDirection: "row", gap: space.sm },
});
