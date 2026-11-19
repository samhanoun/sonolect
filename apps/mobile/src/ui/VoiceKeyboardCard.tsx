import { useCallback, useEffect, useState } from "react";
import { AppState, Platform, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  getVoiceKeyboardStatus,
  openVoiceKeyboardSettings,
  showVoiceKeyboardPicker,
  type VoiceKeyboardStatus,
} from "../../modules/sonolect-voice-keyboard";
import { Button, Card, Label } from "./components";
import { colors, fonts, space } from "./theme";

/**
 * "Dictate in any app" settings card. Android: the Sonolect voice keyboard
 * (an input method) types straight into other apps. iOS keyboards cannot use
 * the microphone, so iOS gets Quick dictation, which copies the text for
 * pasting and can be bound to the Action button or Back Tap via Shortcuts.
 */
export function VoiceKeyboardCard() {
  const router = useRouter();
  const [status, setStatus] = useState<VoiceKeyboardStatus>(() =>
    getVoiceKeyboardStatus(),
  );
  const refresh = useCallback(() => setStatus(getVoiceKeyboardStatus()), []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  if (Platform.OS === "android" && status.supported) {
    const step = !status.enabled
      ? "Turn on “Sonolect voice” in your keyboard settings, then come back."
      : !status.selected
        ? "Switch to the Sonolect voice keyboard in any text field, or here."
        : "Sonolect voice is your keyboard. Tap its mic in any app and speak.";
    return (
      <Card>
        <Label>Dictate in any app</Label>
        <Text style={s.body}>{step}</Text>
        <Text style={s.note}>
          {status.onDeviceRecognition
            ? "Speech is recognised on this phone."
            : "This phone has no on-device recogniser. With Standard privacy the keyboard uses the system speech service."}
        </Text>
        <View style={s.row}>
          {!status.enabled ? (
            <Button
              label="Open keyboard settings"
              icon="keyboard"
              variant="primary"
              onPress={() => openVoiceKeyboardSettings()}
            />
          ) : (
            <Button
              label={status.selected ? "Change keyboard" : "Switch keyboard"}
              icon="keyboard"
              variant={status.selected ? "outline" : "primary"}
              onPress={() => {
                void showVoiceKeyboardPicker().then(() =>
                  setTimeout(refresh, 800),
                );
              }}
            />
          )}
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <Label>Dictate in any app</Label>
      <Text style={s.body}>
        {Platform.OS === "ios"
          ? "iPhone keyboards can't use the microphone, so Sonolect uses Quick dictation: it opens straight into listening, then copies your words so you can paste them where you were."
          : "Quick dictation opens straight into listening, then copies your words so you can paste them anywhere."}
      </Text>
      {Platform.OS === "ios" && (
        <Text style={s.note}>
          Tip: in Shortcuts, add “Open URL” with sonolect://dictate and assign
          it to the Action button or Back Tap.
        </Text>
      )}
      <View style={s.row}>
        <Button
          label="Try Quick dictation"
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
