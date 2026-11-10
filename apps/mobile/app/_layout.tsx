import { useEffect } from "react";
import type { ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import {
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { strings } from "../src/i18n";
import { useCompanionStore } from "../src/store";
import { Icon, type IconName } from "../src/ui/components";
import { colors, fonts } from "../src/ui/theme";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function tabIcon(name: IconName) {
  return ({ color }: { color: ColorValue }) => (
    <Icon name={name} size={22} color={color} />
  );
}

/** Tab bar height above the system navigation area (icon, label, padding). */
const TAB_BAR_HEIGHT = 62;

export default function RootLayout() {
  // Android draws edge to edge, so the bar must grow by the navigation bar
  // inset (gesture pill or 3-button bar) instead of using a fixed height.
  const insets = useSafeAreaInsets();
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_500Medium,
  });
  const hydrate = useCompanionStore((s) => s.hydrate);
  const hydrated = useCompanionStore((s) => s.hydrated);
  const uiLanguage = useCompanionStore((s) => s.settings.uiLanguage);
  const t = strings(uiLanguage);

  useEffect(() => {
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
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.bg },
          tabBarStyle: {
            backgroundColor: colors.bgRaised,
            borderTopColor: colors.line,
            borderTopWidth: 1,
            height: TAB_BAR_HEIGHT + insets.bottom,
            paddingTop: 8,
          },
          tabBarActiveTintColor: colors.lime,
          tabBarInactiveTintColor: colors.muted,
          tabBarLabelStyle: { fontFamily: fonts.bodyMedium, fontSize: 11 },
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
      </Tabs>
    </SafeAreaProvider>
  );
}
