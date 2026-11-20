import { useEffect, useRef, useState, type ComponentProps } from "react";
import {
  Animated,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCompanionStore } from "../store";
import { CHROME_MAX_FONT_SCALE, Icon, type IconName } from "./components";
import { GlassBar, PressableScale } from "./glass";
import { useReducedMotion } from "./motion";
import { colors, fonts, glass, motion } from "./theme";

type TabBarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];

/** The capsule's height, without the safe area under it. */
export const TAB_BAR_HEIGHT = 64;
/** The gap between the capsule and the screen's edges. */
const TAB_BAR_MARGIN = 14;
const RADIUS = TAB_BAR_HEIGHT / 2;
/** The selected tab's lens: inset from the capsule's edge. */
const LENS_INSET = 6;

/** The tabs in the bar, in order; +not-found is a route but never a tab. */
const TABS: Record<string, IconName> = {
  index: "mic",
  library: "list",
  reader: "speaker",
  settings: "settings",
};

/**
 * The space a screen leaves at its bottom so its last item can scroll
 * clear of the floating bar.
 */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + TAB_BAR_MARGIN * 2 + insets.bottom;
}

/**
 * Hides the bar while the keyboard is up, so a mis-tap above the keys
 * doesn't leave the text being typed (android-9). iOS announces the
 * keyboard before it moves, Android only after.
 */
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hide = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const subscriptions = [
      Keyboard.addListener(show, () => setVisible(true)),
      Keyboard.addListener(hide, () => setVisible(false)),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);
  return visible;
}

/**
 * The floating glass tab bar: a capsule over the page, with a lit lens that
 * springs to the selected tab. Tabs are read as in the stock bar: "tab" on
 * Android, a button with "Capture, tab, 1 of 4" on iOS (from the screen
 * options), selected or not.
 */
export function GlassTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  insets,
}: TabBarProps) {
  const reduced = useReducedMotion();
  const hapticsEnabled = useCompanionStore((s) => s.settings.hapticsEnabled);
  const keyboardVisible = useKeyboardVisible();
  const [width, setWidth] = useState(0);

  const routes = state.routes.filter((route) => route.name in TABS);
  const focusedKey = state.routes[state.index]?.key;
  // -1 on a route that has no tab (a hidden screen): no tab is lit.
  const focusedTab = routes.findIndex((route) => route.key === focusedKey);
  const selected = Math.max(0, focusedTab);

  const lens = useRef(new Animated.Value(selected)).current;
  const hidden = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      lens.setValue(selected);
      return;
    }
    const animation = Animated.spring(lens, {
      toValue: selected,
      useNativeDriver: true,
      ...motion.spring,
    });
    animation.start();
    return () => animation.stop();
  }, [selected, reduced, lens]);

  useEffect(() => {
    const animation = Animated.timing(hidden, {
      toValue: keyboardVisible ? 1 : 0,
      duration: reduced ? 0 : 180,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [keyboardVisible, reduced, hidden]);

  const count = Math.max(routes.length, 1);
  const tabWidth = width / count;
  const lensWidth = Math.max(0, tabWidth - LENS_INSET * 2);

  return (
    <Animated.View
      pointerEvents={keyboardVisible ? "none" : "box-none"}
      style={[
        styles.dock,
        {
          bottom: insets.bottom + TAB_BAR_MARGIN,
          opacity: hidden.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0],
          }),
          transform: [
            {
              translateY: hidden.interpolate({
                inputRange: [0, 1],
                outputRange: [0, TAB_BAR_HEIGHT + insets.bottom + 24],
              }),
            },
          ],
        },
      ]}
    >
      <GlassBar radius={RADIUS} style={styles.bar}>
        <View
          style={styles.row}
          {...(Platform.OS === "ios" ? {} : { accessibilityRole: "tablist" })}
          onLayout={(event: LayoutChangeEvent) =>
            setWidth(event.nativeEvent.layout.width)
          }
        >
          {tabWidth > 0 && focusedTab >= 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.lens,
                {
                  width: lensWidth,
                  transform: [
                    {
                      translateX:
                        count > 1
                          ? lens.interpolate({
                              inputRange: [0, count - 1],
                              outputRange: [0, tabWidth * (count - 1)],
                            })
                          : 0,
                    },
                  ],
                },
              ]}
            />
          ) : null}
          {routes.map((route, index) => {
            const descriptor = descriptors[route.key];
            if (!descriptor) return null;
            const { options } = descriptor;
            const focused = index === focusedTab;
            const title =
              typeof options.title === "string" ? options.title : route.name;
            const color = focused ? colors.lime : glass.tabIdle;

            const onPress = () => {
              const event = emitter.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (focused || event.defaultPrevented) return;
              if (hapticsEnabled && Platform.OS !== "web") {
                void Haptics.selectionAsync().catch(() => undefined);
              }
              navigateToTab(route.key);
            };

            const onLongPress = () => {
              emitter.emit({ type: "tabLongPress", target: route.key });
            };

            return (
              <PressableScale
                key={route.key}
                accessibilityRole={Platform.OS === "ios" ? "button" : "tab"}
                accessibilityState={{ selected: focused }}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? title}
                // iOS shows the name in the Large Content Viewer on a long
                // press at accessibility text sizes.
                accessibilityLargeContentTitle={title}
                accessibilityShowsLargeContentViewer
                onPress={onPress}
                onLongPress={onLongPress}
                pressedScale={0.9}
                style={styles.tab}
              >
                <Icon
                  name={TABS[route.name] ?? "mic"}
                  size={22}
                  color={color}
                />
                {/* The name grows with the font size up to 1.5x, then
                    shrinks to fit the tab, on one line (ux-19): "Bibliothèque"
                    at 1.5x is wider than a tab on a 360 dp phone. */}
                <Text
                  maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[styles.label, { color }, focused && styles.labelOn]}
                >
                  {title}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </GlassBar>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: TAB_BAR_MARGIN,
    right: TAB_BAR_MARGIN,
    alignItems: "center",
  },
  bar: {
    width: "100%",
    maxWidth: 520,
    height: TAB_BAR_HEIGHT,
  },
  row: { flex: 1, flexDirection: "row", alignItems: "stretch" },
  lens: {
    position: "absolute",
    top: LENS_INSET,
    bottom: LENS_INSET,
    left: LENS_INSET,
    borderRadius: RADIUS - LENS_INSET,
    backgroundColor: glass.accent,
    borderWidth: 1,
    borderColor: glass.accentEdge,
    boxShadow: glass.lensGlow,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 6,
  },
  label: { fontFamily: fonts.bodyMedium, fontSize: 11, textAlign: "center" },
  labelOn: { fontFamily: fonts.bodyBold },
});
