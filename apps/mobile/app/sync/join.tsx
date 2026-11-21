import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  Redirect,
  useIsFocused,
  useLocalSearchParams,
  useRouter,
} from "expo-router";

import { SYNC_URL } from "../../src/features";
import { strings } from "../../src/i18n";
import { syncController, useCompanionStore } from "../../src/store";
import { joinPlanForLink, joinScreenFor } from "../../src/sync/joinLink";
import { actionErrorText, pairingErrorText } from "../../src/sync/messages";
import { useSyncView } from "../../src/sync/useSync";
import { Button, Card, Label, Title } from "../../src/ui/components";
import { FadeIn, GlassScreen } from "../../src/ui/glass";
import { JoinConfirmation } from "../../src/ui/SyncSection";
import { colors, fonts, space } from "../../src/ui/theme";

/**
 * The pairing link (sonolect://sync/join?v=1&k=…), opened by the camera
 * app from another device's QR code. It carries only the key: the server
 * comes from the build. Nothing happens until the user confirms, after
 * reading how many notes this phone shares and with whom.
 *
 * Expo Router (SDK 58) hands a native deep link's query string to the
 * screen and drops its fragment (joinRoute.test.ts), so the key is read
 * from the query parameters. In builds without a sync server, and on the
 * web, the link opens Capture and nothing else happens.
 *
 * Tab screens stay mounted once visited: the content is mounted only while
 * the screen is in front, so each visit starts from the link again.
 */
export default function JoinSyncScreen() {
  const focused = useIsFocused();
  if (!SYNC_URL || !syncController()) return <Redirect href="/" />;
  return focused ? <JoinSync /> : <View style={styles.flex} />;
}

function JoinSync() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const uiLanguage = useCompanionStore((s) => s.settings.uiLanguage);
  const noteCount = useCompanionStore((s) => s.history.length);
  const sync = syncController();
  const view = useSyncView(sync);
  const t = strings(uiLanguage);
  const [message, setMessage] = useState<string | null>(null);

  const screen = joinScreenFor(
    joinPlanForLink(SYNC_URL, params),
    view?.status ?? null,
    (root) => sync?.joinOutcome(root) ?? null,
  );
  if (screen.kind === "leave" || !sync) return <Redirect href="/" />;

  const leave = () => router.replace("/");
  const openSettings = () => router.replace("/settings");

  const join = async (root: Uint8Array) => {
    setMessage(null);
    try {
      const result = await sync.join(root);
      if (result === "joined") openSettings();
      else
        setMessage(
          result === "alreadyJoined"
            ? t.sync.alreadyJoined
            : t.sync.otherVaultOn,
        );
    } catch (error) {
      setMessage(actionErrorText(t, error));
    }
  };

  return (
    <GlassScreen>
      <ScrollView contentContainerStyle={styles.container}>
        <FadeIn>
          <Title>{t.sync.joinScreenTitle}</Title>
        </FadeIn>
        <FadeIn index={1} style={styles.section}>
          <Label heading>{t.sync.title}</Label>
          <Card>
            {screen.kind === "confirm" ? (
              <JoinConfirmation
                t={t}
                noteCount={noteCount}
                busy={Boolean(view?.busy)}
                ready={screen.ready}
                onJoin={() => void join(screen.root)}
                onCancel={leave}
              />
            ) : (
              <>
                <Text accessibilityRole="header" style={styles.heading}>
                  {screen.kind === "invalid"
                    ? t.sync.joinInvalidTitle
                    : t.sync.joinTitle}
                </Text>
                <Text style={styles.body}>
                  {screen.kind === "invalid"
                    ? pairingErrorText(t, screen.error)
                    : screen.kind === "alreadyJoined"
                      ? t.sync.alreadyJoined
                      : t.sync.otherVaultOn}
                </Text>
                <Text style={styles.warning}>{t.sync.shareWarning}</Text>
                <View style={styles.row}>
                  <Button
                    variant="primary"
                    label={t.sync.openSettings}
                    onPress={openSettings}
                  />
                  <Button label={t.common.cancel} onPress={leave} />
                </View>
              </>
            )}
            {view?.problem && screen.kind === "confirm" && !screen.ready ? (
              <Text style={[styles.help, styles.problem]}>
                {t.sync.problems[view.problem]}
              </Text>
            ) : null}
            {message ? (
              <Text style={[styles.help, styles.problem]}>{message}</Text>
            ) : null}
          </Card>
        </FadeIn>
      </ScrollView>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { padding: space.xl, gap: space.xl },
  section: { gap: space.sm },
  heading: {
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
  warning: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 19,
    color: colors.amber,
  },
  help: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
  },
  problem: { color: colors.danger },
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
});
