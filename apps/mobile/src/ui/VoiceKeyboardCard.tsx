import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import {
  getVoiceKeyboardStatus,
  openVoiceKeyboardSettings,
  showVoiceKeyboardPicker,
  type VoiceKeyboardStatus,
} from "../../modules/sonolect-voice-keyboard";
import { strings } from "../i18n";
import { systemServiceAllowedWithoutAsking } from "../speechPolicy";
import { useCompanionStore } from "../store";
import { systemTimers } from "../sync/timers";
import { watchKeyboardChange } from "../voiceKeyboardWatch";
import { Button, Card, Label } from "./components";
import { colors, fonts, space } from "./theme";

/**
 * "Dictate in any app" settings card. Android: the Sonolect voice keyboard
 * (an input method) types straight into other apps. iOS keyboards cannot use
 * the microphone, so iOS gets Quick dictation, which copies the text for
 * pasting and can be bound to the Action button or Back Tap via Shortcuts.
 * `enterIndex` is its place in the screen's fade-in cascade.
 */
export function VoiceKeyboardCard({ enterIndex }: { enterIndex: number }) {
  const router = useRouter();
  const uiLanguage = useCompanionStore((st) => st.settings.uiLanguage);
  const serviceAllowed = useCompanionStore((st) =>
    systemServiceAllowedWithoutAsking(st.settings),
  );
  const t = strings(uiLanguage).settings.voiceKeyboard;
  const [status, setStatus] = useState<VoiceKeyboardStatus>(() =>
    getVoiceKeyboardStatus(),
  );
  const refresh = useCallback(() => setStatus(getVoiceKeyboardStatus()), []);
  /** Stops the reads that follow the keyboard picker. */
  const stopWatch = useRef<(() => void) | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    // Android: the window gets focus back when the keyboard picker closes.
    const focus =
      Platform.OS === "android"
        ? AppState.addEventListener("focus", refresh)
        : null;
    return () => {
      sub.remove();
      focus?.remove();
      stopWatch.current?.();
    };
  }, [refresh]);

  // Tabs stay mounted: the status is read again each time Settings shows.
  useFocusEffect(refresh);

  const openPicker = () => {
    stopWatch.current?.();
    const before = status;
    void showVoiceKeyboardPicker().then((shown) => {
      if (!shown) return;
      // The picker answers as soon as it shows, before the user picks.
      stopWatch.current = watchKeyboardChange({
        read: getVoiceKeyboardStatus,
        changed: (next) =>
          next.selected !== before.selected || next.enabled !== before.enabled,
        onStatus: setStatus,
        timers: systemTimers,
      });
    });
  };

  if (Platform.OS === "android" && status.supported) {
    const step = !status.enabled
      ? t.enable
      : !status.selected
        ? t.select
        : t.ready;
    return (
      <Card enterIndex={enterIndex}>
        <Label>{t.title}</Label>
        <Text style={s.body}>{step}</Text>
        <Text style={s.note}>
          {status.onDeviceRecognition
            ? t.onDevice
            : serviceAllowed
              ? t.systemService
              : t.needsService}
        </Text>
        <View style={s.row}>
          {!status.enabled ? (
            <Button
              label={t.openKeyboardSettings}
              icon="keyboard"
              variant="primary"
              onPress={() => openVoiceKeyboardSettings()}
            />
          ) : (
            <Button
              label={status.selected ? t.changeKeyboard : t.switchKeyboard}
              icon="keyboard"
              variant={status.selected ? "outline" : "primary"}
              onPress={openPicker}
            />
          )}
        </View>
      </Card>
    );
  }

  return (
    <Card enterIndex={enterIndex}>
      <Label>{t.title}</Label>
      <Text style={s.body}>{Platform.OS === "ios" ? t.quickIos : t.quick}</Text>
      {Platform.OS === "ios" && <Text style={s.note}>{t.shortcutTip}</Text>}
      <View style={s.row}>
        <Button
          label={t.tryQuick}
          icon="mic"
          variant="primary"
          onPress={() => router.push("/dictate")}
        />
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  body: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    marginTop: space.sm,
  },
  note: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    marginTop: space.sm,
  },
  row: { flexDirection: "row", gap: space.sm, marginTop: space.md },
});
