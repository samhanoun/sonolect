import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { SYNC_URL } from "../features";
import type { Strings } from "../i18n";
import { formatNoteDate } from "../library";
import type { Pairing, SyncController } from "../sync/controller";
import { joinPlanForText } from "../sync/joinLink";
import {
  actionErrorText,
  pairingErrorText,
  syncStatusLines,
} from "../sync/messages";
import { qrPath } from "../sync/qr";
import { useSyncView } from "../sync/useSync";
import { showFailure } from "./actions";
import { Button, Card, Label, inputColors } from "./components";
import { choose } from "./confirm";
import { FadeIn } from "./glass";
import { colors, fonts, glass, radius, space } from "./theme";

/** Groups of the typed code per line: 4 lines that fit any phone. */
const GROUPS_PER_LINE = 4;
/** The QR code's largest side, in points. */
const QR_MAX_SIZE = 232;

/**
 * Settings' Sync section, in builds with a sync server (never on web): turn
 * sync on and show the code for another device, join with a code, turn it
 * off keeping or deleting the server copy, and what sync is doing in plain
 * words. Every view of the code, and the field that takes one, says that
 * joining shares every note.
 */
export function SyncSection({
  sync,
  t,
  locale,
  noteCount,
  enterIndex,
}: {
  sync: SyncController;
  t: Strings;
  /** Formatting locale for the last sync time (library.ts formattingLocale). */
  locale: string | undefined;
  /** The notes this phone would share when it joins. */
  noteCount: number;
  enterIndex?: number;
}) {
  const view = useSyncView(sync);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [entering, setEntering] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [joinRoot, setJoinRoot] = useState<Uint8Array | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // One action at a time: a second tap while one runs does nothing.
  const acting = useRef(false);
  const on = view?.status === "on";

  // The code goes away with sync (turned off here, or deleted elsewhere).
  useEffect(() => {
    if (!on) setPairing(null);
  }, [on]);

  if (!view) return null;
  const lines = syncStatusLines(t, view, (ms) =>
    formatNoteDate(new Date(ms).toISOString(), locale),
  );
  const busy = view.busy;

  const act = async (action: () => Promise<void>) => {
    if (acting.current) return;
    acting.current = true;
    setMessage(null);
    try {
      await action();
    } finally {
      acting.current = false;
    }
  };

  const closeEntry = () => {
    setEntering(false);
    setCode("");
    setCodeError(null);
    setJoinRoot(null);
  };

  const turnOn = () =>
    act(async () => {
      try {
        await sync.turnOn();
        setPairing(await sync.pairing());
      } catch (error) {
        setMessage(actionErrorText(t, error));
      }
    });

  const showCode = () =>
    act(async () => {
      try {
        setPairing(await sync.pairing());
      } catch (error) {
        setMessage(actionErrorText(t, error));
      }
    });

  const checkCode = () => {
    const plan = joinPlanForText(SYNC_URL, code);
    if (plan.kind === "confirm") {
      setCodeError(null);
      setJoinRoot(plan.root);
    } else {
      setCodeError(
        plan.kind === "invalid"
          ? pairingErrorText(t, plan.error)
          : t.sync.pairingErrors.invalid,
      );
    }
  };

  const join = (root: Uint8Array) =>
    act(async () => {
      try {
        const result = await sync.join(root);
        closeEntry();
        if (result === "alreadyJoined") setMessage(t.sync.alreadyJoined);
        if (result === "otherVaultOn") setMessage(t.sync.otherVaultOn);
      } catch (error) {
        setMessage(actionErrorText(t, error));
      }
    });

  const turnOff = () =>
    act(async () => {
      const choice = await choose({
        title: t.sync.turnOffTitle,
        message: t.sync.turnOffMessage,
        choices: [
          { value: "keep", label: t.sync.keepServerCopy },
          {
            value: "delete",
            label: t.sync.deleteServerCopy,
            destructive: true,
          },
        ],
        cancelLabel: t.common.cancel,
      });
      if (!choice) return;
      try {
        await sync.turnOff(choice === "delete");
      } catch (error) {
        if (choice === "delete") showFailure(t.sync.deleteFailed);
        else setMessage(actionErrorText(t, error));
      }
    });

  return (
    <FadeIn
      {...(enterIndex === undefined ? {} : { index: enterIndex })}
      style={styles.section}
    >
      <Label heading>{t.sync.title}</Label>
      <Card>
        {view.status === "off" && !entering ? (
          <Text style={styles.body}>{t.sync.intro}</Text>
        ) : null}
        {lines.status ? (
          <Text style={styles.status}>{lines.status}</Text>
        ) : null}
        {lines.problem ? (
          <Text style={[styles.help, view.problem && styles.problem]}>
            {lines.problem}
          </Text>
        ) : null}
        {message ? (
          <Text style={[styles.help, styles.problem]}>{message}</Text>
        ) : null}

        {view.status === "off" && joinRoot ? (
          <JoinConfirmation
            t={t}
            noteCount={noteCount}
            busy={busy}
            onJoin={() => void join(joinRoot)}
            onCancel={closeEntry}
          />
        ) : null}
        {view.status === "off" && entering && !joinRoot ? (
          <>
            <Text style={styles.fieldLabel} nativeID="sync-code-label">
              {t.sync.codeLabel}
            </Text>
            <TextInput
              accessibilityLabelledBy="sync-code-label"
              accessibilityLabel={t.sync.codeLabel}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect={false}
              spellCheck={false}
              placeholder={t.sync.codePlaceholder}
              placeholderTextColor={colors.muted}
              value={code}
              onChangeText={(value) => {
                setCode(value);
                setCodeError(null);
              }}
              onSubmitEditing={checkCode}
              multiline
              style={[styles.input, codeError ? styles.inputError : null]}
              {...inputColors}
            />
            {codeError ? (
              <Text style={[styles.help, styles.problem]}>{codeError}</Text>
            ) : null}
            <Text style={styles.warning}>{t.sync.shareWarning}</Text>
            <View style={styles.row}>
              <Button
                variant="primary"
                label={t.sync.codeNext}
                disabled={!code.trim()}
                onPress={checkCode}
              />
              <Button label={t.common.cancel} onPress={closeEntry} />
            </View>
          </>
        ) : null}
        {view.status === "off" && !entering ? (
          <View style={styles.row}>
            <Button
              variant="primary"
              label={t.sync.turnOn}
              disabled={busy}
              onPress={() => void turnOn()}
            />
            <Button
              label={t.sync.join}
              disabled={busy}
              onPress={() => {
                setMessage(null);
                setEntering(true);
              }}
            />
          </View>
        ) : null}

        {on && pairing ? <PairingCode t={t} pairing={pairing} /> : null}
        {on ? (
          <View style={styles.row}>
            <Button
              label={pairing ? t.sync.hideCode : t.sync.showCode}
              disabled={busy}
              onPress={() => {
                if (pairing) setPairing(null);
                else void showCode();
              }}
            />
            <Button
              variant="danger"
              label={t.sync.turnOff}
              disabled={busy}
              onPress={() => void turnOff()}
            />
          </View>
        ) : null}
      </Card>
    </FadeIn>
  );
}

/** The QR code of the join link, and the typed code in groups of 4. */
function PairingCode({ t, pairing }: { t: Strings; pairing: Pairing }) {
  const qr = useMemo(() => qrPath(pairing.link), [pairing.link]);
  // Whole points per module: no seams between the rows of dark modules.
  const side = Math.max(3, Math.floor(QR_MAX_SIZE / qr.size)) * qr.size;
  const lines: string[] = [];
  for (let i = 0; i < pairing.groups.length; i += GROUPS_PER_LINE)
    lines.push(pairing.groups.slice(i, i + GROUPS_PER_LINE).join(" "));
  return (
    <View style={styles.pairing}>
      <View
        style={styles.qr}
        accessible
        accessibilityRole="image"
        accessibilityLabel={t.sync.qrLabel}
      >
        <Svg width={side} height={side} viewBox={`0 0 ${qr.size} ${qr.size}`}>
          <Rect width={qr.size} height={qr.size} fill="#FFFFFF" />
          <Path d={qr.path} fill="#000000" />
        </Svg>
      </View>
      <Text
        selectable
        style={styles.code}
        accessibilityLabel={`${t.sync.codeLabel}: ${pairing.groups.join(", ")}`}
      >
        {lines.join("\n")}
      </Text>
      <Text style={styles.warning}>{t.sync.shareWarning}</Text>
      <Text style={styles.help}>{t.sync.codeHelp}</Text>
    </View>
  );
}

/**
 * The question before joining (Settings and the join link): how many notes
 * this phone shares, and with whom.
 */
export function JoinConfirmation({
  t,
  noteCount,
  busy,
  ready = true,
  onJoin,
  onCancel,
}: {
  t: Strings;
  noteCount: number;
  busy: boolean;
  /** False while joining must wait (the join link, before the key is read). */
  ready?: boolean;
  onJoin: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.confirm}>
      <Text accessibilityRole="header" style={styles.confirmTitle}>
        {t.sync.joinTitle}
      </Text>
      <Text style={styles.body}>{t.sync.joinNotes(noteCount)}</Text>
      <Text style={styles.warning}>{t.sync.shareWarning}</Text>
      <View style={styles.row}>
        <Button
          variant="primary"
          label={t.sync.joinConfirm}
          disabled={busy || !ready}
          onPress={onJoin}
        />
        <Button label={t.common.cancel} disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  status: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.text,
  },
  help: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
  },
  problem: { color: colors.danger },
  warning: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 19,
    color: colors.amber,
  },
  fieldLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.text,
  },
  input: {
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: glass.well,
    borderWidth: 1,
    borderColor: colors.lineInteractive,
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 15,
    textAlignVertical: "top",
  },
  inputError: { borderColor: colors.danger },
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  pairing: { gap: space.md, alignItems: "center" },
  qr: {
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: "#FFFFFF",
  },
  code: {
    fontFamily: fonts.mono,
    fontSize: 17,
    lineHeight: 28,
    letterSpacing: 1,
    color: colors.text,
    textAlign: "center",
  },
  confirm: { gap: space.sm },
  confirmTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    color: colors.text,
  },
});
