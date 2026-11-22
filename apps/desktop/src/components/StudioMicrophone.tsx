import { useCallback, useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { useT } from "../i18n";
import {
  CAPTURE_SOURCES,
  nativeSystemAudio,
  openPcmSource,
  type CaptureSource,
  type PcmSource,
} from "../liveCaptureNative";
import {
  listMicrophones,
  meterPosition,
  micTestBlocked,
  microphoneName,
  openMicrophone,
  type Microphone,
} from "../microphone";
import { pcmLevel } from "../pcmStream";
import { useDesktopStore } from "../store/appStore";
import { isTauriRuntime } from "../desktopNative";

/** How long a microphone test listens before it stops by itself. */
const TEST_MS = 15_000;
/** How much of the level is left after each block of audio (about 60 ms). */
const LEVEL_DECAY = 0.8;

/**
 * Settings card for the microphone: which one records, and a level meter to
 * check that it hears you before a dictation depends on it.
 */
export function MicrophoneSettings() {
  const t = useT();
  const micDeviceId = useDesktopStore((state) => state.micDeviceId);
  const setMicDeviceId = useDesktopStore((state) => state.setMicDeviceId);
  const recordingState = useDesktopStore((state) => state.recordingState);
  const captureSource = useDesktopStore((state) => state.captureSource);
  const setCaptureSource = useDesktopStore((state) => state.setCaptureSource);
  // Offered where the app can record what is playing on this computer.
  const [systemAudio, setSystemAudio] = useState(false);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let current = true;
    void nativeSystemAudio.available().then((available) => {
      if (current) setSystemAudio(available);
    });
    return () => {
      current = false;
    };
  }, []);
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [message, setMessage] = useState("");
  const test = useRef<{ stream: MediaStream; source?: PcmSource } | undefined>(
    undefined,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(0);

  const refresh = useCallback(async () => {
    try {
      setMicrophones(await listMicrophones());
    } catch {
      setMicrophones([]);
    }
  }, []);

  const stopTest = useCallback(async () => {
    clearTimeout(timer.current);
    const current = test.current;
    test.current = undefined;
    setTesting(false);
    held.current = 0;
    setLevel(0);
    if (!current) return;
    await current.source?.close().catch(() => undefined);
    current.stream.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    void refresh();
    const devices = navigator.mediaDevices;
    if (!devices?.addEventListener) return;
    const changed = () => void refresh();
    devices.addEventListener("devicechange", changed);
    return () => devices.removeEventListener("devicechange", changed);
  }, [refresh]);

  // A test never outlives the page, and never competes with a dictation.
  useEffect(() => () => void stopTest(), [stopTest]);
  const busy = micTestBlocked(recordingState, isTauriRuntime());
  useEffect(() => {
    if (busy) void stopTest();
  }, [busy, stopTest]);

  const startTest = async () => {
    setMessage("");
    try {
      const { stream, fellBack } = await openMicrophone(micDeviceId);
      const current: { stream: MediaStream; source?: PcmSource } = { stream };
      test.current = current;
      setTesting(true);
      if (fellBack) setMessage(t("studio.mic.fellBack"));
      // Names are only given once access is allowed: list again.
      void refresh();
      const source = await openPcmSource(stream, (block) => {
        if (test.current !== current) return;
        // Rises at once and falls back gently, like a hardware meter, so
        // short sounds stay visible.
        held.current = Math.max(pcmLevel(block), held.current * LEVEL_DECAY);
        setLevel(held.current);
      });
      if (test.current !== current) {
        await source.close().catch(() => undefined);
        return;
      }
      current.source = source;
      timer.current = setTimeout(() => void stopTest(), TEST_MS);
    } catch {
      await stopTest();
      setMessage(t("error.micPermissionDenied"));
    }
  };

  const known = microphones.some(
    (microphone) => microphone.deviceId === micDeviceId,
  );
  const unnamed = microphones.some((microphone) => !microphone.label);
  const percent = Math.round(meterPosition(level) * 100);

  return (
    <section className="studio-card">
      <div className="studio-card-heading">
        <div className="studio-icon">
          <Mic size={25} />
        </div>
        <div>
          <h3>{t("studio.mic.title")}</h3>
          <p>{t("studio.mic.meta")}</p>
        </div>
      </div>
      {(systemAudio || captureSource === "system") && (
        <label>
          {t("studio.source.label")}
          <select
            value={captureSource}
            disabled={busy}
            onChange={(event) =>
              setCaptureSource(event.target.value as CaptureSource)
            }
          >
            {CAPTURE_SOURCES.map((source) => (
              <option value={source} key={source}>
                {t(`studio.source.${source}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      {captureSource === "system" && (
        <p className="studio-muted">{t("studio.source.systemHint")}</p>
      )}
      <label>
        {t("studio.mic.choose")}
        <select
          value={micDeviceId}
          onChange={(event) => {
            void stopTest();
            setMessage("");
            setMicDeviceId(event.target.value);
          }}
        >
          <option value="">{t("studio.mic.systemDefault")}</option>
          {microphones.map((microphone, index) => (
            <option value={microphone.deviceId} key={microphone.deviceId}>
              {microphoneName(microphone, index, (position) =>
                t("studio.mic.numbered", { position }),
              )}
            </option>
          ))}
          {micDeviceId && !known && (
            <option value={micDeviceId}>{t("studio.mic.notConnected")}</option>
          )}
        </select>
      </label>
      {micDeviceId && !known && (
        <p className="studio-muted">{t("studio.mic.notConnectedHint")}</p>
      )}
      {unnamed && !testing && (
        <p className="studio-muted">{t("studio.mic.namesHint")}</p>
      )}
      <div className="studio-mic-test">
        <button
          className="studio-button secondary"
          disabled={busy}
          onClick={() => void (testing ? stopTest() : startTest())}
        >
          <Mic size={15} />
          {testing ? t("studio.mic.stopTest") : t("studio.mic.test")}
        </button>
        <div
          className={`studio-mic-meter ${testing ? "live" : ""}`}
          role="meter"
          aria-label={t("studio.mic.level")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <i style={{ width: `${percent}%` }} />
        </div>
      </div>
      {testing && <p className="studio-muted">{t("studio.mic.testHint")}</p>}
      {message && <p className="studio-inline-status">{message}</p>}
    </section>
  );
}
