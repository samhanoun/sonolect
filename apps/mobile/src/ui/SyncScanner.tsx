import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Modal, StyleSheet, Text, View } from "react-native";
import { type BarcodeScanningResult, CameraView } from "expo-camera";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import type { Strings } from "../i18n";
import { readScannedCode } from "../sync/pairingInput";
import { Button } from "./components";
import { useReducedMotion } from "./motion";
import { colors, fonts, radius, space } from "./theme";

/**
 * Settings' sync scanner: the back camera, full screen, reading QR codes
 * only. It takes a Sonolect sync code and nothing else: another QR code
 * says so and scanning goes on. Once it reads a code it hands the key over
 * (the scanner is then closed and the Sync section asks before joining).
 *
 * The camera runs only while the scanner is on screen. Leaving Settings or
 * the app, Back on Android and Cancel all close it, which unmounts the
 * camera view and releases the camera. The camera permission is asked
 * before the scanner opens (SyncSection.tsx).
 */
export function SyncScanner({
  t,
  onScanned,
  onClose,
  onCameraFailed,
}: {
  t: Strings;
  /** The key of the code read. Called once. */
  onScanned: (root: Uint8Array) => void;
  onClose: () => void;
  /** The camera did not start (no camera, or it is in use). */
  onCameraFailed: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [notice, setNotice] = useState<string | null>(null);
  // The camera reports the same code many times a second: act once.
  const done = useRef(false);
  const last = useRef<string | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Leaving Settings, or the app, closes the scanner and the camera.
  useFocusEffect(useCallback(() => () => close.current(), []));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") close.current();
    });
    return () => subscription.remove();
  }, []);

  const scanned = ({ data }: BarcodeScanningResult) => {
    if (done.current || data === last.current) return;
    last.current = data;
    const result = readScannedCode(data);
    if (result.kind === "confirm") {
      done.current = true;
      onScanned(result.root);
      return;
    }
    setNotice(
      result.kind === "newer"
        ? t.sync.pairingErrors.version
        : t.sync.scanNotSonolect,
    );
  };

  return (
    <Modal
      visible
      animationType={reducedMotion ? "none" : "slide"}
      presentationStyle="fullScreen"
      supportedOrientations={["portrait"]}
      onRequestClose={onClose}
    >
      <View style={styles.screen}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={scanned}
          onMountError={onCameraFailed}
          accessible
          accessibilityLabel={t.sync.scanTitle}
        />
        <SafeAreaView style={styles.overlay} edges={["top", "bottom"]}>
          <View style={styles.panel}>
            <Text accessibilityRole="header" style={styles.title}>
              {t.sync.scanTitle}
            </Text>
            <Text style={styles.body}>{t.sync.scanHelp}</Text>
          </View>
          <View style={styles.frame} pointerEvents="none" />
          <View style={styles.panel}>
            {notice ? (
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.body, styles.problem]}
              >
                {notice}
              </Text>
            ) : null}
            <Text style={styles.warning}>{t.sync.shareWarning}</Text>
            <Button label={t.common.cancel} onPress={onClose} />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  overlay: {
    flex: 1,
    justifyContent: "space-between",
    padding: space.xl,
    gap: space.xl,
  },
  panel: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.bg,
  },
  frame: {
    alignSelf: "center",
    width: 240,
    height: 240,
    borderRadius: radius.lg,
    borderWidth: 3,
    borderColor: colors.lime,
  },
  title: {
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    color: colors.text,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  problem: { color: colors.danger },
  warning: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 19,
    color: colors.amber,
  },
});
