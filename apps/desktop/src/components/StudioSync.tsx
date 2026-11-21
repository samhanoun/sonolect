/**
 * The Sync card in the settings. It shows only when this build has a sync
 * server; in the browser preview of such a build it says that sync works
 * in the installed app, and nothing more.
 */
import { type FormEvent, useEffect, useState } from "react";
import { Cloud, QrCode, RefreshCw } from "lucide-react";
import type { QrMatrix } from "@sonolect/sync-core";

import { isTauriRuntime } from "../desktopNative";
import { useT } from "../i18n";
import type { SyncPairing } from "../sync/syncController";
import {
  syncActionErrorText,
  syncNoticeTexts,
  syncProblemText,
} from "../sync/syncMessages";
import { SYNC_IN_BUILD, getSyncController, useSyncView } from "../sync/useSync";

/** Light modules around the code, as QR readers expect. */
const QUIET_ZONE = 4;

/** A QR code, dark on light whatever the theme, so that phones can read it. */
export function QrCodeSvg({ qr, label }: { qr: QrMatrix; label: string }) {
  const side = qr.size + QUIET_ZONE * 2;
  let path = "";
  qr.modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
    }),
  );
  return (
    <svg
      className="studio-sync-qr"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
    >
      <rect width={side} height={side} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

type Busy = "" | "on" | "join" | "off" | "code";

export function StudioSync() {
  const t = useT();
  const view = useSyncView();
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState<SyncPairing | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  // Sync turned off by itself (the vault was deleted elsewhere): close what
  // only makes sense while it is on, the code first.
  useEffect(() => {
    if (view.phase === "on") return;
    setPairing(null);
    setConfirmOff(false);
  }, [view.phase]);

  if (!isTauriRuntime()) {
    if (!SYNC_IN_BUILD) return null;
    return (
      <section className="studio-card studio-sync" aria-labelledby="sync-title">
        <SyncHeading />
        <p className="studio-muted">{t("studio.sync.preview")}</p>
      </section>
    );
  }
  const sync = getSyncController();
  if (!sync || !view.available) return null;

  const act = async (kind: Busy, action: () => Promise<void>) => {
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      setError(syncActionErrorText(failure, t));
    } finally {
      setBusy("");
    }
  };
  const turnOn = () =>
    act("on", async () => {
      await sync.turnOn();
      // The code is what the other devices need next.
      setPairing(await sync.pairing());
    });
  const join = (event: FormEvent) => {
    event.preventDefault();
    void act("join", async () => {
      await sync.join(code);
      setCode("");
      setJoinOpen(false);
    });
  };
  const toggleCode = () => {
    if (pairing) {
      setPairing(null);
      return;
    }
    void act("code", async () => setPairing(await sync.pairing()));
  };
  const turnOff = (deleteServerCopy: boolean) =>
    act("off", async () => {
      await sync.turnOff({ deleteServerCopy });
      setPairing(null);
      setConfirmOff(false);
      setNotice(t("studio.sync.notesKept"));
    });

  const server = view.server
    ? t("studio.sync.server", { server: view.server })
    : "";
  const problem = view.problem ? syncProblemText(view.problem, t) : "";

  return (
    <section className="studio-card studio-sync" aria-labelledby="sync-title">
      <SyncHeading />
      {view.phase === "on" ? (
        <>
          <p className="studio-sync-state">
            <strong>{t("studio.sync.onState")}</strong> {server}
          </p>
          <p className="studio-muted" aria-live="polite">
            {view.syncing
              ? t("studio.sync.syncing")
              : view.lastSyncAt
                ? t("studio.sync.lastSync", {
                    time: new Date(view.lastSyncAt).toLocaleString(t.locale),
                  })
                : t("studio.sync.neverSynced")}
          </p>
          {problem && (
            <div role="status" className="studio-notice studio-sync-problem">
              <span>{problem}</span>
              {view.problem?.kind === "unauthorized" && !confirmOff && (
                <button
                  className="studio-link"
                  onClick={() => setConfirmOff(true)}
                >
                  {t("studio.sync.turnOff")}
                </button>
              )}
            </div>
          )}
          {syncNoticeTexts(view.notices, t).map((text) => (
            <p key={text} role="status" className="studio-notice">
              {text}
            </p>
          ))}
          <div className="studio-sync-actions">
            <button
              className="studio-button secondary"
              disabled={view.syncing || !!busy}
              onClick={() => sync.syncNow()}
            >
              <RefreshCw size={15} />
              {t("studio.sync.syncNow")}
            </button>
            <button
              className="studio-button secondary"
              aria-expanded={!!pairing}
              disabled={!!busy}
              onClick={toggleCode}
            >
              <QrCode size={15} />
              {pairing ? t("studio.sync.hideCode") : t("studio.sync.showCode")}
            </button>
            <button
              className="studio-button secondary"
              disabled={!!busy}
              onClick={() => setConfirmOff(true)}
            >
              {t("studio.sync.turnOff")}
            </button>
          </div>
          {pairing && (
            <div className="studio-sync-code">
              <QrCodeSvg qr={pairing.qr} label={t("studio.sync.qrLabel")} />
              <div>
                <p className="studio-muted">{t("studio.sync.codeHint")}</p>
                <p className="studio-sync-code-text">
                  <span>{t("studio.sync.codeLabel")}</span>
                  <code>{pairing.code}</code>
                </p>
                <p className="studio-sync-warning">
                  {t("studio.sync.warning")}
                </p>
              </div>
            </div>
          )}
          {confirmOff && (
            <div
              className="studio-sync-off"
              role="group"
              aria-labelledby="sync-off-question"
            >
              <p id="sync-off-question">
                <strong>{t("studio.sync.turnOffQuestion")}</strong>
              </p>
              <div className="studio-sync-choice">
                <button
                  className="studio-button secondary"
                  disabled={!!busy}
                  onClick={() => void turnOff(false)}
                >
                  {t("studio.sync.keepServer")}
                </button>
                <p className="studio-muted">
                  {t("studio.sync.keepServerHint")}
                </p>
              </div>
              <div className="studio-sync-choice">
                <button
                  className="studio-button danger"
                  disabled={!!busy}
                  onClick={() => void turnOff(true)}
                >
                  {t("studio.sync.deleteServer")}
                </button>
                <p className="studio-muted">
                  {t("studio.sync.deleteServerHint")}
                </p>
              </div>
              {busy === "off" ? (
                <p className="studio-muted" role="status">
                  {t("studio.sync.turningOff")}
                </p>
              ) : (
                <button
                  className="studio-link"
                  onClick={() => setConfirmOff(false)}
                >
                  {t("studio.sync.cancel")}
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="studio-sync-state">
            <strong>{t("studio.sync.offState")}</strong> {server}
          </p>
          {problem && (
            <p role="status" className="studio-notice">
              {problem}
              {view.problem?.kind === "deleted"
                ? ` ${t("studio.sync.notesKept")}`
                : ""}
            </p>
          )}
          <div className="studio-sync-actions">
            <button
              className="studio-button"
              disabled={view.phase !== "off" || !!busy}
              onClick={() => void turnOn()}
            >
              <Cloud size={15} />
              {busy === "on"
                ? t("studio.sync.turningOn")
                : t("studio.sync.turnOn")}
            </button>
            <button
              className="studio-button secondary"
              aria-expanded={joinOpen}
              disabled={view.phase !== "off" || !!busy}
              onClick={() => {
                setJoinOpen(!joinOpen);
                setError("");
              }}
            >
              {t("studio.sync.join")}
            </button>
          </div>
          {joinOpen && (
            <form className="studio-sync-join" onSubmit={join}>
              <label>
                {t("studio.sync.joinLabel")}
                <input
                  value={code}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <p className="studio-sync-warning">{t("studio.sync.warning")}</p>
              <div className="studio-sync-actions">
                <button
                  type="submit"
                  className="studio-button"
                  disabled={!code.trim() || !!busy}
                >
                  {busy === "join"
                    ? t("studio.sync.joining")
                    : t("studio.sync.joinSubmit")}
                </button>
                <button
                  type="button"
                  className="studio-link"
                  disabled={!!busy}
                  onClick={() => {
                    setJoinOpen(false);
                    setCode("");
                    setError("");
                  }}
                >
                  {t("studio.sync.cancel")}
                </button>
              </div>
            </form>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="studio-notice studio-sync-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="studio-notice">
          {notice}
        </p>
      )}
      <p className="studio-muted">{t("studio.sync.audioStays")}</p>
    </section>
  );
}

function SyncHeading() {
  const t = useT();
  return (
    <div className="studio-card-heading">
      <div className="studio-icon">
        <Cloud size={25} />
      </div>
      <div>
        <h3 id="sync-title">{t("studio.sync.title")}</h3>
        <p>{t("studio.sync.subtitle")}</p>
      </div>
    </div>
  );
}
