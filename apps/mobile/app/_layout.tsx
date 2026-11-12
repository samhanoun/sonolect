import { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type ColorValue,
} from "react-native";
import { Tabs, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
// One module per weight: a package's index requires every weight, which
// would ship all 39 font files in the app (js-1).
import { SpaceGrotesk_600SemiBold } from "@expo-google-fonts/space-grotesk/600SemiBold";
import { SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk/700Bold";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono/500Medium";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { strings } from "../src/i18n";
import { noticeText } from "../src/notices";
import { useCompanionStore } from "../src/store";
import {
  CHROME_MAX_FONT_SCALE,
  Icon,
  MIN_TOUCH_SIZE,
  type IconName,
} from "../src/ui/components";
import { confirm } from "../src/ui/confirm";
import { colors, fonts, radius, space } from "../src/ui/theme";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** The six faces theme.ts uses, keyed by the family names it refers to. */
const FONTS = {
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  JetBrainsMono_500Medium,
};

function tabIcon(name: IconName) {
  return ({ color }: { color: ColorValue }) => (
    <Icon name={name} size={22} color={color} />
  );
}

/** Tab names grow with the font size up to 1.5x, on one line (ux-19). */
function tabLabel({
  color,
  position,
  children,
}: {
  color: ColorValue;
  position: "beside-icon" | "below-icon";
  children: string;
}) {
  return (
    <Text
      maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
      numberOfLines={1}
      style={[
        styles.tabLabel,
        // Wide screens (iPad) put the name beside the icon.
        position === "beside-icon" && styles.tabLabelBeside,
        { color },
      ]}
    >
      {children}
    </Text>
  );
}

/** Tab bar height above the system navigation area (icon, label, padding). */
const TAB_BAR_HEIGHT = 62;

/** ErrorBoundary's retry mounts the layout again: storage is read once. */
let hydrationStarted = false;

/**
 * Screen readers hear each new notice once, whichever tab is open (ux-17).
 * The notice views have no live region, so Android doesn't read it twice.
 */
function NoticeAnnouncer() {
  const notice = useCompanionStore((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const t = strings(useCompanionStore.getState().settings.uiLanguage);
    AccessibilityInfo.announceForAccessibility(noticeText(t, notice));
  }, [notice]);
  return null;
}

export default function RootLayout() {
  // Android draws edge to edge, so the bar must grow by the navigation bar
  // inset (gesture pill or 3-button bar) instead of using a fixed height.
  const insets = useSafeAreaInsets();
  const [fontsLoaded, fontError] = useFonts(FONTS);
  const hydrate = useCompanionStore((s) => s.hydrate);
  const hydrated = useCompanionStore((s) => s.hydrated);
  const uiLanguage = useCompanionStore((s) => s.settings.uiLanguage);
  const t = strings(uiLanguage);

  useEffect(() => {
    if (hydrationStarted) return;
    hydrationStarted = true;
    void hydrate();
  }, [hydrate]);

  const ready = (fontsLoaded || Boolean(fontError)) && hydrated;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NoticeAnnouncer />
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.bg },
          // The keyboard covers the bar instead of pushing it up above the
          // keys, where a mis-tap leaves the text being typed (android-9).
          tabBarHideOnKeyboard: true,
          tabBarStyle: {
            backgroundColor: colors.bgRaised,
            borderTopColor: colors.line,
            borderTopWidth: 1,
            height: TAB_BAR_HEIGHT + insets.bottom,
            paddingTop: 8,
          },
          tabBarActiveTintColor: colors.lime,
          tabBarInactiveTintColor: colors.muted,
          tabBarLabel: tabLabel,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: t.tabs.capture, tabBarIcon: tabIcon("mic") }}
        />
        <Tabs.Screen
          name="library"
          options={{ title: t.tabs.library, tabBarIcon: tabIcon("list") }}
        />
        <Tabs.Screen
          name="reader"
          options={{ title: t.tabs.reader, tabBarIcon: tabIcon("speaker") }}
        />
        <Tabs.Screen
          name="settings"
          options={{ title: t.tabs.settings, tabBarIcon: tabIcon("settings") }}
        />
        {/* Unknown links redirect to Capture; never a tab. */}
        <Tabs.Screen name="+not-found" options={{ href: null }} />
      </Tabs>
    </SafeAreaProvider>
  );
}

function RecoveryButton({
  label,
  onPress,
  variant = "outline",
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "outline" | "danger";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.recoveryButton,
        variant === "primary" && styles.recoveryButtonPrimary,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.recoveryButtonText,
          variant === "primary" && { color: colors.onLime },
          variant === "danger" && { color: colors.danger },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Shown instead of the app when a screen throws while rendering, so the app
 * neither closes nor stays blank (js-2). System fonts only: the custom fonts
 * may not be loaded. expo-router's Try already hides the splash screen.
 * Errors thrown in event handlers or async code don't reach it.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const t = strings(useCompanionStore.getState().settings.uiLanguage);
  const busy = useRef(false);
  const message = error instanceof Error ? error.message : String(error);

  /** Asks first, then deletes and renders the app again. */
  const deleteAndRetry = async (title: string, wipe: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const confirmed = await confirm({
        title,
        confirmLabel: t.common.confirm,
        cancelLabel: t.common.cancel,
        destructive: true,
      });
      if (!confirmed) return;
      await wipe().catch(() => undefined);
      await retry();
    } finally {
      busy.current = false;
    }
  };

  return (
    <SafeAreaView style={styles.recovery}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.recoveryContent}>
        <Text accessibilityRole="header" style={styles.recoveryTitle}>
          {t.errorBoundary.title}
        </Text>
        <Text style={styles.recoveryBody}>{t.errorBoundary.body}</Text>
        {message ? (
          <Text selectable style={styles.recoveryError}>
            {message}
          </Text>
        ) : null}
        <RecoveryButton
          variant="primary"
          label={t.errorBoundary.tryAgain}
          onPress={() => void retry()}
        />
        <RecoveryButton
          label={t.errorBoundary.deleteNotes}
          onPress={() =>
            void deleteAndRetry(t.errorBoundary.deleteNotesConfirm, () =>
              useCompanionStore.getState().clearHistory(),
            )
          }
        />
        <RecoveryButton
          variant="danger"
          label={t.settings.eraseAll}
          onPress={() =>
            void deleteAndRetry(t.settings.eraseConfirm, () =>
              useCompanionStore.getState().eraseAll(),
            )
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tabLabel: { fontFamily: fonts.bodyMedium, fontSize: 11, textAlign: "center" },
  tabLabelBeside: { marginStart: 5, marginEnd: 12 },
  recovery: { flex: 1, backgroundColor: colors.bg },
  recoveryContent: { padding: 24, gap: space.md },
  recoveryTitle: { fontSize: 24, fontWeight: "700", color: colors.text },
  recoveryBody: { fontSize: 16, lineHeight: 23, color: colors.text },
  recoveryError: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
    marginBottom: space.sm,
  },
  recoveryButton: {
    minHeight: MIN_TOUCH_SIZE,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineInteractive,
    alignItems: "center",
    justifyContent: "center",
  },
  recoveryButtonPrimary: {
    backgroundColor: colors.lime,
    borderColor: colors.lime,
  },
  recoveryButtonText: { fontSize: 15, fontWeight: "600", color: colors.text },
  pressed: { opacity: 0.8 },
});
