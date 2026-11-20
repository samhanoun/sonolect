import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ComponentRef,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { BlurTargetView, BlurView } from "expo-blur";
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useReducedMotion, useReducedTransparency } from "./motion";
import { auroraGradients, colors, glass, motion } from "./theme";

/**
 * iOS 26 draws the tab bar in Liquid Glass, the system's own material. The
 * API check guards the iOS 26 betas that crash on it (expo/expo#40911).
 */
export const LIQUID_GLASS =
  Platform.OS === "ios" &&
  isLiquidGlassAvailable() &&
  isGlassEffectAPIAvailable();

/**
 * Android 12 (API 31) and newer blur on the GPU (RenderEffect). Older
 * versions get an opaque bar instead of a slow software blur.
 */
const ANDROID_BLUR =
  Platform.OS === "android" && typeof Platform.Version === "number"
    ? Platform.Version >= 31
    : false;

type TargetRef = RefObject<ComponentRef<typeof View> | null>;

/**
 * A page that the bar can blur. Only Android 12+ blurs from a
 * BlurTargetView; on older Android it would only wrap every page in an
 * extra native view, and on iOS and the web it is a plain View anyway.
 */
const ScreenView = ANDROID_BLUR ? BlurTargetView : View;

/** An opacity from 0 to 1 that drives the backdrop's live glow. */
type Glow = Animated.AnimatedInterpolation<number> | Animated.Value;

/**
 * On Android a blur reads its pixels from a BlurTargetView, which can't
 * contain the blur itself. Each screen is a target, and the tab bar blurs
 * the one in front: the screen that gained focus last.
 */
let activeTarget: TargetRef | null = null;
const targetListeners = new Set<() => void>();

function setActiveTarget(node: ComponentRef<typeof View> | null) {
  if (activeTarget?.current === node) return;
  // A new object each time: BlurView only re-reads a target whose
  // `current` changed.
  activeTarget = node ? { current: node } : null;
  for (const listener of targetListeners) listener();
}

function useActiveBlurTarget(): TargetRef | null {
  return useSyncExternalStore(
    (listener) => {
      targetListeners.add(listener);
      return () => {
        targetListeners.delete(listener);
      };
    },
    () => activeTarget,
    () => null,
  );
}

/**
 * The ambient light behind a screen: two soft glows on the night green.
 * Static, so it costs nothing after the first frame. `glow` (0 to 1) brightens
 * the lime light, such as while the microphone listens.
 */
export function Backdrop({ glow }: { glow?: Glow | undefined }) {
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[StyleSheet.absoluteFill, styles.auroraForest]} />
      <View style={[StyleSheet.absoluteFill, styles.auroraCyan]} />
      <View style={[StyleSheet.absoluteFill, styles.auroraLime]} />
      {glow ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.auroraLive,
            { opacity: glow },
          ]}
        />
      ) : null}
    </View>
  );
}

/**
 * A tab's page: the backdrop, then the content inside the top safe area.
 * On Android it is also what the tab bar blurs while the page is in front.
 */
export function GlassScreen({
  children,
  glow,
}: {
  children: ReactNode;
  glow?: Glow | undefined;
}) {
  const target = useRef<ComponentRef<typeof View>>(null);
  // In front: the bar blurs this page. Behind or gone: it stops, so a page
  // without a GlassScreen (such as a hidden route) gets the solid bar
  // instead of a blur of another page.
  useFocusEffect(
    useCallback(() => {
      if (!ANDROID_BLUR) return undefined;
      const node = target.current;
      setActiveTarget(node);
      return () => {
        if (node && activeTarget?.current === node) setActiveTarget(null);
      };
    }, []),
  );
  return (
    <ScreenView ref={target} style={styles.screen}>
      <Backdrop glow={glow} />
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {children}
      </SafeAreaView>
    </ScreenView>
  );
}

/**
 * Floating chrome, such as the tab bar: Liquid Glass on iOS 26, a system
 * blur on older iOS, a GPU blur of the page on Android 12+ and the web, and
 * an opaque panel where there is no blur or Reduce Transparency is on.
 */
export function GlassBar({
  style,
  radius,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  /** The corner radius, which the tint layer under the blur needs too. */
  radius: number;
  children: ReactNode;
}) {
  const reduceTransparency = useReducedTransparency();
  const target = useActiveBlurTarget();

  if (reduceTransparency) {
    return (
      <View
        style={[
          style,
          styles.barRim,
          styles.barOpaque,
          { borderRadius: radius },
        ]}
      >
        {children}
      </View>
    );
  }
  if (LIQUID_GLASS) {
    return (
      <GlassView
        glassEffectStyle="regular"
        colorScheme="dark"
        tintColor={glass.liquidTint}
        style={[style, { borderRadius: radius }]}
      >
        {children}
      </GlassView>
    );
  }
  if (Platform.OS === "android" && (!ANDROID_BLUR || !target)) {
    return (
      <View
        style={[
          style,
          styles.barRim,
          styles.barOpaque,
          { borderRadius: radius },
        ]}
      >
        {children}
      </View>
    );
  }
  return (
    <BlurView
      tint="systemUltraThinMaterialDark"
      intensity={Platform.OS === "android" ? 80 : 60}
      blurReductionFactor={3}
      blurMethod="dimezisBlurViewSdk31Plus"
      {...(target ? { blurTarget: target } : {})}
      style={[style, styles.barRim, { borderRadius: radius }]}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.barTint,
          { borderRadius: radius },
        ]}
      />
      {children}
    </BlurView>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A Pressable that sinks a little under the finger and springs back. With
 * Reduce Motion it only dims. Runs on the native driver: no re-render.
 */
export function PressableScale({
  style,
  pressedScale = motion.pressedScale,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  pressedScale?: number;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  const animate = (toValue: number) => {
    Animated.spring(progress, {
      toValue,
      useNativeDriver: true,
      ...motion.press,
    }).start();
  };

  const feedback = disabled
    ? null
    : {
        opacity: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0.82],
        }),
        transform: [
          {
            scale: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [1, reduced ? 1 : pressedScale],
            }),
          },
        ],
      };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(event) => {
        animate(1);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(0);
        onPressOut?.(event);
      }}
      style={[style, feedback]}
    />
  );
}

/**
 * Fades its content in and lifts it a few points when it first appears.
 * `index` staggers siblings. With Reduce Motion it shows at once.
 */
export function FadeIn({
  children,
  index = 0,
  style,
}: {
  children: ReactNode;
  index?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.enter,
      delay: Math.min(index, 6) * motion.stagger,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
    // Only on mount: a re-render must not replay it.
  }, []);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [reduced ? 0 : 12, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Animates the next layout change, such as a note opening, instead of
 * jumping to it. Not with Reduce Motion, nor on the web (no support).
 */
export function animateNextLayout(reduced: boolean) {
  if (reduced || Platform.OS === "web") return;
  LayoutAnimation.configureNext(
    LayoutAnimation.create(220, "easeInEaseOut", "opacity"),
  );
}

export const glassStyles = StyleSheet.create({
  /** A glass panel: translucent fill, top sheen, edges lit from above. */
  panel: {
    backgroundColor: glass.fill,
    backgroundImage: glass.sheen,
    borderWidth: 1,
    borderColor: glass.edge,
    borderTopColor: glass.edgeTop,
    borderBottomColor: glass.edgeBottom,
  },
  panelStrong: { backgroundColor: glass.fillStrong },
  /** Reduce Transparency: the same panel, solid. */
  panelOpaque: { backgroundColor: colors.surface, backgroundImage: "none" },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  auroraForest: { backgroundImage: auroraGradients.forest },
  auroraCyan: { backgroundImage: auroraGradients.cyan },
  auroraLime: { backgroundImage: auroraGradients.lime },
  auroraLive: { backgroundImage: auroraGradients.live },
  barRim: {
    borderWidth: 1,
    borderColor: glass.edge,
    borderTopColor: glass.edgeTop,
    borderBottomColor: glass.edgeBottom,
    boxShadow: glass.shadow,
  },
  barTint: { backgroundColor: glass.bar },
  barOpaque: { backgroundColor: glass.barOpaque },
});
