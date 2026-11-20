import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type ColorValue,
  type LayoutChangeEvent,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { FadeIn, PressableScale, glassStyles } from "./glass";
import { useReducedMotion, useReducedTransparency } from "./motion";
import {
  colors,
  fonts,
  glass,
  inputSelectionColor,
  motion,
  radius,
  space,
} from "./theme";

export { useReducedMotion } from "./motion";

/** Smallest touch target: 44 pt on iOS, 48 dp on Android (ux-18). */
export const MIN_TOUCH_SIZE = Platform.select({
  ios: 44,
  android: 48,
  default: 44,
});

/**
 * Fixed chrome (labels, chips, segments, the mode pill, tab labels) grows
 * with the system font size up to 1.5x, so it stays on screen at 200%.
 * Body text is not capped (ux-19).
 */
export const CHROME_MAX_FONT_SCALE = 1.5;

/**
 * Lime cursor, selection handles and selection in every text field. iOS
 * ignores cursorColor and selectionHandleColor and tints all three with
 * selectionColor, which is opaque there (see inputSelectionColor).
 */
export const inputColors = {
  cursorColor: colors.lime,
  selectionHandleColor: colors.lime,
  selectionColor: inputSelectionColor(Platform.OS),
} as const satisfies TextInputProps;

export type IconName =
  | "mic"
  | "stop"
  | "list"
  | "speaker"
  | "settings"
  | "lock"
  | "cloud"
  | "search"
  | "copy"
  | "share"
  | "pin"
  | "trash"
  | "play"
  | "pause"
  | "plus"
  | "close"
  | "keyboard";

export function Icon({
  name,
  size = 20,
  color = colors.text,
}: {
  name: IconName;
  size?: number;
  color?: ColorValue;
}) {
  const stroke = {
    stroke: color,
    strokeWidth: 2,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {name === "mic" && (
        <>
          <Rect x={9} y={3} width={6} height={11} rx={3} {...stroke} />
          <Path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...stroke} />
        </>
      )}
      {name === "stop" && (
        <Rect x={6} y={6} width={12} height={12} rx={2} fill={color} />
      )}
      {name === "list" && <Path d="M4 5h16M4 12h16M4 19h10" {...stroke} />}
      {name === "speaker" && (
        <Path
          d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"
          {...stroke}
        />
      )}
      {name === "settings" && (
        <>
          <Circle cx={12} cy={12} r={3} {...stroke} />
          <Path
            d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
            {...stroke}
          />
        </>
      )}
      {name === "lock" && (
        <>
          <Rect x={5} y={11} width={14} height={10} rx={2} {...stroke} />
          <Path d="M8 11V7a4 4 0 0 1 8 0v4" {...stroke} />
        </>
      )}
      {name === "cloud" && (
        <Path
          d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"
          {...stroke}
        />
      )}
      {name === "search" && (
        <>
          <Circle cx={11} cy={11} r={7} {...stroke} />
          <Path d="m20 20-3.5-3.5" {...stroke} />
        </>
      )}
      {name === "copy" && (
        <>
          <Rect x={9} y={9} width={11} height={11} rx={2} {...stroke} />
          <Path d="M5 15V5a2 2 0 0 1 2-2h8" {...stroke} />
        </>
      )}
      {name === "share" && (
        <Path
          d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"
          {...stroke}
        />
      )}
      {name === "pin" && (
        <Path d="M9 4h6l-1 6 4 4H6l4-4zM12 14v6" {...stroke} />
      )}
      {name === "trash" && (
        <Path
          d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
          {...stroke}
        />
      )}
      {name === "play" && <Path d="M7 4v16l13-8z" fill={color} />}
      {name === "pause" && <Path d="M7 4h4v16H7zM13 4h4v16h-4z" fill={color} />}
      {name === "plus" && <Path d="M12 5v14M5 12h14" {...stroke} />}
      {name === "close" && <Path d="M6 6l12 12M18 6 6 18" {...stroke} />}
      {name === "keyboard" && (
        <>
          <Rect x={2} y={6} width={20} height={12} rx={2} {...stroke} />
          <Path
            d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"
            {...stroke}
          />
        </>
      )}
    </Svg>
  );
}

/**
 * A small mono caption. `heading` makes it a screen-reader heading: only for
 * section labels, never for mode tags, durations or a status.
 */
export function Label({
  children,
  color = colors.muted,
  style,
  heading,
}: {
  children: ReactNode;
  color?: string;
  style?: StyleProp<TextStyle>;
  heading?: boolean;
}) {
  return (
    <Text
      {...(heading ? { accessibilityRole: "header" as const } : {})}
      maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
      style={[styles.label, { color }, style]}
    >
      {children}
    </Text>
  );
}

export function Title({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text accessibilityRole="header" style={[styles.title, style]}>
      {children}
    </Text>
  );
}

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

export function Button({
  label,
  icon,
  variant = "outline",
  onPress,
  disabled,
  selected,
  style,
  accessibilityLabel,
  compact,
}: {
  label?: string;
  icon?: IconName;
  variant?: ButtonVariant;
  onPress: PressableProps["onPress"];
  disabled?: boolean;
  /** A toggle such as Pin: read as selected, with a lime icon when on. */
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  compact?: boolean;
}) {
  const fg =
    variant === "primary"
      ? colors.onLime
      : variant === "danger"
        ? colors.danger
        : colors.text;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{
        disabled: Boolean(disabled),
        ...(selected === undefined ? {} : { selected }),
      }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={compact ? 6 : 0}
      style={[
        styles.button,
        compact && styles.buttonCompact,
        variant === "primary" && styles.buttonPrimary,
        variant === "outline" && styles.buttonOutline,
        variant === "danger" && styles.buttonDanger,
        selected && styles.buttonSelected,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          size={compact ? 16 : 18}
          color={selected ? colors.lime : fg}
        />
      ) : null}
      {label ? (
        <Text
          style={[
            styles.buttonText,
            compact && styles.buttonTextCompact,
            { color: fg },
          ]}
        >
          {label}
        </Text>
      ) : null}
    </PressableScale>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{
        selected: Boolean(selected),
        disabled: Boolean(disabled),
      }}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.chip,
        selected && styles.chipSelected,
        disabled && styles.disabled,
      ]}
    >
      <Text
        maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
        style={[styles.chipText, selected && styles.chipTextSelected]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

/**
 * A glass panel. `strong` raises it a step, for content that needs to stand
 * out from the cards around it. With Reduce Transparency it is solid.
 * `enterIndex` fades it in on mount, staggered by its place in a list.
 */
export function Card({
  children,
  style,
  strong,
  enterIndex,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  strong?: boolean;
  enterIndex?: number;
}) {
  const opaque = useReducedTransparency();
  const panel = (
    <View
      style={[
        glassStyles.panel,
        styles.card,
        strong && glassStyles.panelStrong,
        opaque && glassStyles.panelOpaque,
        style,
      ]}
    >
      {children}
    </View>
  );
  return enterIndex === undefined ? (
    panel
  ) : (
    <FadeIn index={enterIndex}>{panel}</FadeIn>
  );
}

/**
 * A message at the top of a screen, such as a storage error, with an
 * optional action. The root layout announces each notice once, so this has
 * no live region: Android would read it twice.
 */
export function NoticeBanner({
  text,
  actionLabel,
  onAction,
}: {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const opaque = useReducedTransparency();
  return (
    <View
      style={[
        glassStyles.panel,
        glassStyles.panelStrong,
        styles.banner,
        opaque && glassStyles.panelOpaque,
      ]}
      accessibilityRole="alert"
    >
      <Text style={styles.bannerText}>{text}</Text>
      {actionLabel && onAction ? (
        <Button
          compact
          label={actionLabel}
          onPress={onAction}
          style={styles.bannerAction}
        />
      ) : null}
    </View>
  );
}

export function ToggleRow({
  label,
  value,
  onChange,
  last,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  last?: boolean;
  /** Shown but not changeable, such as Save history in Ephemeral mode. */
  disabled?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, !last && styles.toggleRowBorder]}>
      <Text
        style={[styles.body, styles.toggleLabel, disabled && styles.mutedText]}
      >
        {label}
      </Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={Boolean(disabled)}
        trackColor={{ false: colors.lineInteractive, true: colors.lime }}
        thumbColor={value ? colors.onLime : colors.muted}
        ios_backgroundColor={colors.lineInteractive}
        {...({ activeThumbColor: colors.onLime } as object)}
      />
    </View>
  );
}

/**
 * A text link that opens a web page, such as the privacy policy. It is read
 * as a link, and its touch area reaches the minimum size.
 */
export function TextLink({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  const reduced = useReducedMotion();
  const opaque = useReducedTransparency();
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [width, setWidth] = useState(0);
  const position = useRef(new Animated.Value(index)).current;

  // The thumb springs to the selected segment (no slide with Reduce Motion).
  useEffect(() => {
    if (reduced) {
      position.setValue(index);
      return;
    }
    const animation = Animated.spring(position, {
      toValue: index,
      useNativeDriver: true,
      ...motion.spring,
    });
    animation.start();
    return () => animation.stop();
  }, [index, reduced, position]);

  const count = Math.max(options.length, 1);
  // Segments share the row inside its border (1) and padding (4), 4 apart.
  const thumbWidth = width > 0 ? (width - 10 - 4 * (count - 1)) / count : 0;
  const step = thumbWidth + 4;

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      onLayout={(event: LayoutChangeEvent) =>
        setWidth(event.nativeEvent.layout.width)
      }
      style={[
        glassStyles.panel,
        styles.segmented,
        opaque && glassStyles.panelOpaque,
      ]}
    >
      {thumbWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.segmentThumb,
            {
              width: thumbWidth,
              transform: [
                {
                  translateX:
                    count > 1
                      ? position.interpolate({
                          inputRange: [0, count - 1],
                          outputRange: [0, step * (count - 1)],
                        })
                      : 0,
                },
              ],
            },
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            // 40 + 4 + 4 = 48, inside the container's padding of 4.
            hitSlop={{ top: 4, bottom: 4 }}
            style={[
              styles.segment,
              // Until the row is measured there is no thumb to slide.
              selected && thumbWidth === 0 && styles.segmentSelected,
            ]}
          >
            <Text
              maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
              style={[
                styles.segmentText,
                selected && styles.segmentTextSelected,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const BAR_COUNT = 28;

/** Bars fade towards both ends of the meter, so it reads as a soft band. */
function barOpacity(index: number): number {
  const fromEdge = Math.min(index, BAR_COUNT - 1 - index) / (BAR_COUNT / 2);
  return 0.35 + 0.65 * Math.min(1, fromEdge * 2.2);
}

/** Live input meter: bars shift left as new levels arrive. */
export function Waveform({
  level,
  active,
}: {
  level: number;
  active: boolean;
}) {
  const [history, setHistory] = useState<number[]>(() =>
    Array(BAR_COUNT).fill(0),
  );
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    if (!active) {
      setHistory(Array(BAR_COUNT).fill(0));
      return;
    }
    const timer = setInterval(() => {
      setHistory((previous) => [...previous.slice(1), levelRef.current]);
    }, 90);
    return () => clearInterval(timer);
  }, [active]);

  return (
    <View
      style={styles.waveform}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {history.map((value, index) => {
        const lit = active && value > 0.02;
        return (
          <View
            key={index}
            style={[
              styles.bar,
              {
                height: 4 + Math.round(value * 36),
                backgroundColor: lit ? colors.lime : colors.lineStrong,
                opacity: lit ? barOpacity(index) : 1,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

/**
 * The capture button: a lit lime core in glass rings. While listening, a
 * halo swells with the voice and the dashed orbit turns. Reduce Motion
 * keeps the rings still and the halo steady.
 */
export function MicOrb({
  listening,
  busy,
  label,
  onPress,
  accessibilityLabel,
  level = 0,
}: {
  listening: boolean;
  busy: boolean;
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  /** Input level from 0 to 1, while listening. */
  level?: number;
}) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const voice = useRef(new Animated.Value(0)).current;
  const active = listening || busy;

  // The inner ring breathes while listening.
  useEffect(() => {
    if (!listening || reduced) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [listening, reduced, pulse]);

  // The dashed orbit turns while a dictation runs, faster while it is
  // processed. It stops otherwise, so an idle screen draws no frames.
  useEffect(() => {
    if (!active || reduced) {
      orbit.stopAnimation();
      return;
    }
    orbit.setValue(0);
    const loop = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: busy ? 2400 : 14000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, busy, reduced, orbit]);

  // The halo follows the voice.
  useEffect(() => {
    const target = listening ? Math.min(1, Math.max(0, level)) : 0;
    if (reduced) {
      voice.setValue(listening ? 0.4 : 0);
      return;
    }
    const animation = Animated.spring(voice, {
      toValue: target,
      useNativeDriver: true,
      stiffness: 180,
      damping: 18,
      mass: 0.8,
    });
    animation.start();
    return () => animation.stop();
  }, [listening, level, reduced, voice]);

  const ringScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });
  const ringOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 0.85],
  });
  const rotate = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const haloScale = voice.interpolate({
    inputRange: [0, 1],
    outputRange: [listening ? 1 : 0.92, 1.22],
  });
  const haloOpacity = voice.interpolate({
    inputRange: [0, 1],
    outputRange: [listening ? 0.75 : 0.5, 1],
  });

  return (
    <View style={styles.orb}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.halo,
          { opacity: haloOpacity, transform: [{ scale: haloScale }] },
        ]}
      />
      <View pointerEvents="none" style={[styles.ring, styles.ringOuter]} />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          styles.ringDashed,
          active && styles.ringDashedActive,
          { transform: [{ rotate }] },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          styles.ringActive,
          {
            borderColor: listening ? colors.lime : colors.lineStrong,
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          },
        ]}
      />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={onPress}
        pressedScale={0.93}
        style={[styles.orbButton, busy && styles.disabled]}
      >
        <Icon
          name={listening ? "stop" : "mic"}
          size={30}
          color={colors.onLime}
        />
        <Text style={styles.orbLabel}>{label}</Text>
      </PressableScale>
    </View>
  );
}

export const styles = StyleSheet.create({
  label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.5 },
  title: {
    fontFamily: fonts.display,
    fontSize: 30,
    letterSpacing: -0.8,
    color: colors.text,
  },
  body: { fontFamily: fonts.body, fontSize: 15, color: colors.text },
  button: {
    minHeight: MIN_TOUCH_SIZE,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  buttonCompact: {
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
  },
  buttonPrimary: {
    backgroundColor: colors.lime,
    backgroundImage: glass.limeSheen,
    boxShadow: glass.buttonGlow,
  },
  buttonOutline: {
    backgroundColor: glass.control,
    borderWidth: 1,
    borderColor: glass.edge,
    borderTopColor: glass.edgeTop,
  },
  buttonDanger: {
    backgroundColor: glass.dangerFill,
    borderWidth: 1,
    borderColor: glass.dangerEdge,
  },
  // A toggle that is on (Pin): lime-tinted glass.
  buttonSelected: {
    backgroundColor: glass.accent,
    borderColor: glass.accentEdge,
    borderTopColor: glass.accentEdge,
  },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 15 },
  buttonTextCompact: { fontFamily: fonts.bodyMedium, fontSize: 13 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  // No hitSlop: chip rows are 8 apart, so slop areas would overlap and send
  // a tap to the wrong chip.
  chip: {
    minHeight: MIN_TOUCH_SIZE,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.lineInteractive,
    backgroundColor: glass.recess,
    justifyContent: "center",
  },
  chipSelected: {
    backgroundColor: glass.accent,
    borderColor: glass.accentEdge,
  },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.text },
  chipTextSelected: { color: colors.lime, fontFamily: fonts.bodyBold },
  card: {
    borderRadius: radius.xl,
    padding: space.lg,
    gap: space.md,
  },
  banner: {
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
  },
  bannerText: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  bannerAction: { alignSelf: "flex-start" },
  toggleRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  // A long label wraps instead of pushing the switch off the screen.
  toggleLabel: { flexShrink: 1 },
  mutedText: { color: colors.muted },
  link: {
    minHeight: MIN_TOUCH_SIZE,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  linkText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.lime,
    textDecorationLine: "underline",
  },
  toggleRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  segmented: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: radius.lg,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  segmentSelected: { backgroundColor: glass.accent },
  segmentThumb: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: radius.md,
    backgroundColor: glass.accent,
    borderWidth: 1,
    borderColor: glass.accentEdge,
  },
  // A label that wraps at a large font size stays centred in its segment.
  segmentText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
  },
  segmentTextSelected: { color: colors.lime, fontFamily: fonts.bodyBold },
  waveform: { flexDirection: "row", alignItems: "center", gap: 4, height: 44 },
  bar: { width: 4, borderRadius: 2 },
  orb: {
    width: 248,
    height: 248,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundImage: glass.halo,
  },
  ring: { position: "absolute", borderRadius: 999 },
  ringOuter: {
    width: 248,
    height: 248,
    borderWidth: 1,
    borderColor: glass.edge,
    backgroundColor: glass.ringFill,
  },
  ringDashed: {
    width: 204,
    height: 204,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderStyle: "dashed",
  },
  ringDashedActive: { borderColor: glass.orbit },
  ringActive: { width: 160, height: 160, borderWidth: 2 },
  orbButton: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.lime,
    backgroundImage: glass.limeSheen,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: glass.orbEdge,
    boxShadow: glass.limeGlow,
  },
  orbLabel: {
    fontFamily: fonts.displayMedium,
    fontSize: 14,
    color: colors.onLime,
  },
});
