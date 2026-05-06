import { useEffect } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { DEFAULT_SETTINGS, REFINEMENT_ACTIONS } from "../../src/domain";
import { useCompanionStore } from "../../src/store";

const palette = {
  background: "#08090A",
  surface: "#111317",
  surfaceMuted: "#181B21",
  border: "#2A2F38",
  primary: "#8B5CF6",
  primarySoft: "#A78BFA",
  success: "#22C55E",
  text: "#F4F4F5",
  textMuted: "#A1A1AA",
  warning: "#F59E0B",
};

export default function HomeScreen() {
  const hydrated = useCompanionStore((state) => state.hydrated);
  const auth = useCompanionStore((state) => state.auth);
  const settings = useCompanionStore((state) => state.settings);
  const capture = useCompanionStore((state) => state.capture);
  const history = useCompanionStore((state) => state.history);
  const hydrate = useCompanionStore((state) => state.hydrate);
  const startCapture = useCompanionStore((state) => state.startCapture);
  const stopCapture = useCompanionStore((state) => state.stopCapture);
  const cancelCapture = useCompanionStore((state) => state.cancelCapture);
  const refineLast = useCompanionStore((state) => state.refineLast);
  const updateSettings = useCompanionStore((state) => state.updateSettings);
  const clearHistory = useCompanionStore((state) => state.clearHistory);
  const markAuthReady = useCompanionStore((state) => state.markAuthReady);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const isListening = capture.status === "listening";
  const latest = history[0];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <View style={styles.badgeRow}>
            <Text style={styles.badge}>Sonolect mobile</Text>
            <Text style={styles.badgeMuted}>
              {auth.status === "ready" ? "Auth prêt" : "Invité"}
            </Text>
          </View>
          <Text style={styles.title}>Speak. Refine. Act.</Text>
          <Text style={styles.subtitle}>
            Compagnon vocal Expo pour capturer une idée, conserver l'historique
            et préparer les actions IA avant la synchronisation cloud.
          </Text>
        </View>

        <View style={styles.captureCard}>
          <Text style={styles.sectionEyebrow}>Capture vocale</Text>
          <Text style={styles.captureStatus}>{statusCopy(capture.status)}</Text>
          <Text style={styles.captureHint}>
            {capture.partialTranscript ||
              "Appuyez pour démarrer une dictée privée."}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isListening
                ? "Arrêter la capture vocale"
                : "Démarrer la capture vocale"
            }
            onPress={isListening ? () => void stopCapture() : startCapture}
            style={({ pressed }) => [
              styles.micButton,
              isListening && styles.micButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.micIcon}>{isListening ? "■" : "●"}</Text>
            <Text style={styles.micLabel}>
              {isListening ? "Terminer" : "Parler"}
            </Text>
          </Pressable>
          {isListening ? (
            <Pressable onPress={cancelCapture} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Annuler</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actions de raffinement</Text>
          <View style={styles.actionGrid}>
            {REFINEMENT_ACTIONS.map((action) => (
              <Pressable
                key={action.id}
                disabled={!latest}
                onPress={() => void refineLast(action.id)}
                style={({ pressed }) => [
                  styles.actionCard,
                  !latest && styles.disabledCard,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.actionLabel}>{action.label}</Text>
                <Text style={styles.actionHelper}>{action.helper}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Historique</Text>
            <Pressable
              onPress={() => void clearHistory()}
              disabled={history.length === 0}
            >
              <Text
                style={[
                  styles.linkText,
                  history.length === 0 && styles.disabledText,
                ]}
              >
                Effacer
              </Text>
            </Pressable>
          </View>
          {history.length === 0 ? (
            <Text style={styles.emptyText}>
              Aucune transcription sauvegardée. Le mode éphémère n'enregistre
              rien.
            </Text>
          ) : (
            history.map((turn) => (
              <View key={turn.id} style={styles.historyCard}>
                <View style={styles.historyMetaRow}>
                  <Text style={styles.historyMode}>{modeLabel(turn.mode)}</Text>
                  <Text style={styles.historyMeta}>
                    {syncStateLabel(turn.syncState)}
                  </Text>
                </View>
                <Text style={styles.historyText}>{turn.refinedText}</Text>
                <Text style={styles.historyRaw}>Brut: {turn.rawText}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Réglages & confidentialité</Text>
          <SettingRow
            label="Sauvegarder l'historique"
            value={settings.saveHistory}
            onValueChange={(value) =>
              void updateSettings({ saveHistory: value })
            }
          />
          <SettingRow
            label="Notifications prêtes"
            value={settings.notificationsEnabled}
            onValueChange={(value) =>
              void updateSettings({ notificationsEnabled: value })
            }
          />
          <SettingRow
            label="Synchronisation cloud"
            value={settings.cloudSyncEnabled}
            onValueChange={(value) =>
              void updateSettings({ cloudSyncEnabled: value })
            }
          />
          <View style={styles.apiConfigBox}>
            <Text style={styles.apiConfigLabel}>API locale Sonolect</Text>
            <TextInput
              accessibilityLabel="URL de l'API locale Sonolect"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://localhost:8787"
              placeholderTextColor={palette.textMuted}
              defaultValue={settings.localApiUrl ?? ""}
              onEndEditing={(event) =>
                void updateSettings({
                  localApiUrl: event.nativeEvent.text.trim(),
                })
              }
              style={styles.apiConfigInput}
            />
            <Text style={styles.privacyNote}>
              Renseignez une URL locale ou EXPO_PUBLIC_SONOLECT_API_URL pour
              envoyer les éléments en attente, téléverser l'audio capturé vers
              l'API locale et récupérer l'historique local.
            </Text>
          </View>
          <View style={styles.privacyRow}>
            {(["standard", "local_first", "ephemeral"] as const).map(
              (level) => (
                <Pressable
                  key={level}
                  onPress={() => void updateSettings({ privacyLevel: level })}
                  style={[
                    styles.privacyPill,
                    settings.privacyLevel === level && styles.privacyPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.privacyText,
                      settings.privacyLevel === level &&
                        styles.privacyTextActive,
                    ]}
                  >
                    {privacyLabel(level)}
                  </Text>
                </Pressable>
              ),
            )}
          </View>
          <Text style={styles.privacyNote}>
            Par défaut: {privacyLabel(DEFAULT_SETTINGS.privacyLevel)}. Les
            jetons et préférences sont isolés dans SecureStore; l'adaptateur
            notifications est prêt pour expo-notifications.
          </Text>
          <Pressable
            onPress={() => void markAuthReady()}
            style={styles.authButton}
          >
            <Text style={styles.authButtonText}>
              {auth.status === "ready"
                ? "Session locale prête"
                : "Préparer l'auth"}
            </Text>
          </Pressable>
        </View>

        {!hydrated ? (
          <Text style={styles.loading}>Chargement sécurisé…</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: palette.border, true: palette.primary }}
      />
    </View>
  );
}

function statusCopy(status: string): string {
  switch (status) {
    case "listening":
      return "Écoute active";
    case "processing":
      return "Traitement";
    case "ready":
      return "Prêt à agir";
    case "error":
      return "Action requise";
    case "idle":
    default:
      return "Prêt pour une dictée";
  }
}

function modeLabel(mode: string): string {
  return mode.replace("_", " ");
}

function syncStateLabel(syncState: string): string {
  switch (syncState) {
    case "queued":
      return "Sync en attente";
    case "synced":
      return "Synchronisé";
    case "local":
    default:
      return "Local";
  }
}

function privacyLabel(level: string): string {
  switch (level) {
    case "standard":
      return "Standard";
    case "ephemeral":
      return "Éphémère";
    case "local_first":
    default:
      return "Local d'abord";
  }
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  container: { padding: 20, gap: 18, paddingBottom: 44 },
  hero: { gap: 12, paddingTop: 8 },
  badgeRow: { flexDirection: "row", gap: 8 },
  badge: {
    color: palette.background,
    backgroundColor: palette.primarySoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    fontWeight: "700",
  },
  badgeMuted: {
    color: palette.text,
    backgroundColor: palette.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  title: {
    color: palette.text,
    fontSize: 38,
    fontWeight: "800",
    letterSpacing: -1,
  },
  subtitle: { color: palette.textMuted, fontSize: 16, lineHeight: 24 },
  captureCard: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 28,
    padding: 20,
    alignItems: "center",
    gap: 12,
  },
  sectionEyebrow: {
    color: palette.primarySoft,
    textTransform: "uppercase",
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 1.2,
  },
  captureStatus: { color: palette.text, fontSize: 24, fontWeight: "800" },
  captureHint: {
    color: palette.textMuted,
    textAlign: "center",
    minHeight: 44,
    lineHeight: 22,
  },
  micButton: {
    width: 138,
    height: 138,
    borderRadius: 69,
    backgroundColor: palette.primary,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: palette.primary,
    shadowOpacity: 0.35,
    shadowRadius: 20,
  },
  micButtonActive: { backgroundColor: palette.warning },
  micIcon: { color: palette.text, fontSize: 34, fontWeight: "900" },
  micLabel: {
    color: palette.text,
    fontSize: 17,
    fontWeight: "800",
    marginTop: 4,
  },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  secondaryButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderColor: palette.border,
    borderWidth: 1,
  },
  secondaryButtonText: { color: palette.text },
  section: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { color: palette.text, fontSize: 20, fontWeight: "800" },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actionCard: {
    width: "48%",
    minHeight: 92,
    backgroundColor: palette.surfaceMuted,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    gap: 6,
  },
  disabledCard: { opacity: 0.4 },
  actionLabel: { color: palette.text, fontSize: 16, fontWeight: "800" },
  actionHelper: { color: palette.textMuted, lineHeight: 18 },
  linkText: { color: palette.primarySoft, fontWeight: "700" },
  disabledText: { color: palette.border },
  emptyText: { color: palette.textMuted, lineHeight: 22 },
  historyCard: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: 18,
    padding: 14,
    gap: 8,
  },
  historyMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  historyMode: {
    color: palette.success,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  historyMeta: { color: palette.textMuted },
  historyText: { color: palette.text, lineHeight: 22, fontSize: 15 },
  historyRaw: { color: palette.textMuted, fontSize: 12, lineHeight: 18 },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  settingLabel: { color: palette.text, fontSize: 16 },
  apiConfigBox: {
    backgroundColor: palette.surfaceMuted,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  apiConfigLabel: { color: palette.text, fontWeight: "800" },
  apiConfigInput: {
    color: palette.text,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  privacyRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  privacyPill: {
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  privacyPillActive: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  privacyText: { color: palette.textMuted, fontWeight: "700" },
  privacyTextActive: { color: palette.text },
  privacyNote: { color: palette.textMuted, lineHeight: 20, fontSize: 13 },
  authButton: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    borderColor: palette.border,
    borderWidth: 1,
  },
  authButtonText: { color: palette.text, fontWeight: "800" },
  loading: { color: palette.textMuted, textAlign: "center" },
});
