import { useEffect, useState } from "react";
import {
  Cpu,
  LockKeyhole,
  RefreshCw,
  Route,
  ShieldCheck,
  Terminal,
  ArrowUpRight,
  Check,
} from "lucide-react";
import { useDesktopStore } from "../store/appStore";
import {
  useProviderStore,
  modelsForTask,
  PROVIDER_NAMES,
  type ProviderId,
  type ModelTask,
} from "../providerSettings";
import { isTauriRuntime } from "../desktopNative";

const TASK_NAMES = {
  stt: "Speech to text",
  tts: "Text to speech",
  text: "Text editing",
};
export function StudioModelSelector({ task }: { task: ModelTask }) {
  const { preferences, models, selectModel, refreshModels, busy, setVoice } =
    useProviderStore();
  const choice = preferences[task];
  const available =
    choice.provider === "local"
      ? []
      : modelsForTask(models[choice.provider], task);
  const providers =
    task === "stt"
      ? (["local", "openrouter"] as const)
      : task === "tts"
        ? (["openrouter"] as const)
        : (["openrouter", "opencode"] as const);
  return (
    <div className="studio-model-select">
      <label>
        Provider
        <select
          aria-label={`${TASK_NAMES[task]} provider`}
          value={choice.provider}
          onChange={(event) => {
            selectModel(task, {
              provider: event.target.value as typeof choice.provider,
              model: "",
            });
            if (task === "tts") setVoice("");
          }}
        >
          {providers.map((provider) => (
            <option key={provider} value={provider}>
              {PROVIDER_NAMES[provider]}
            </option>
          ))}
        </select>
      </label>
      {choice.provider === "local" ? (
        <div className="studio-hint">
          <Cpu size={18} /> Your installed Whisper model runs on this computer.
        </div>
      ) : (
        <>
          <label>
            Model
            <select
              aria-label={`${TASK_NAMES[task]} model`}
              value={choice.model}
              onChange={(event) => {
                selectModel(task, { ...choice, model: event.target.value });
                if (task === "tts") setVoice("");
              }}
            >
              <option value="">Choose a compatible model</option>
              {choice.model &&
                !available.some((model) => model.id === choice.model) && (
                  <option value={choice.model}>
                    {choice.model} · saved selection
                  </option>
                )}
              {available.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="studio-button ghost"
            disabled={!!busy}
            onClick={() => void refreshModels(choice.provider as ProviderId)}
          >
            <RefreshCw size={15} />
            {busy === choice.provider ? "Loading models…" : "Load live catalog"}
          </button>
          {!available.length && (
            <p className="studio-muted">
              Load the live catalog to see models that support{" "}
              {TASK_NAMES[task].toLowerCase()}. No audio or text is sent when
              loading models.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ProviderCard({ provider }: { provider: ProviderId }) {
  const { keys, saveKey, removeKey, refreshModels, busy } = useProviderStore();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const router = provider === "openrouter";
  const Icon = router ? Route : Terminal;
  const save = async () => {
    setSaving(true);
    try { if (await saveKey(provider, key)) setKey(""); }
    finally { setSaving(false); }
  };
  return (
    <section className="studio-card provider-card">
      <div className="studio-card-heading">
        <div className="studio-icon">
          <Icon size={24} />
        </div>
        <div>
          <h3>{PROVIDER_NAMES[provider]}</h3>
          <p>
            {router
              ? "One key, many speech models"
              : "Models for thoughtful text editing"}
          </p>
        </div>
        <span className={`studio-tag ${keys[provider] ? "green" : ""}`}>
          {keys[provider] ? "KEY SAVED" : "NO KEY SAVED"}
        </span>
      </div>
      <div className="studio-tags">
        {router ? (
          <>
            <span className="studio-tag green">Speech to text</span>
            <span className="studio-tag green">Text to speech</span>
          </>
        ) : (
          <span className="studio-tag amber">
            Dedicated speech not available
          </span>
        )}
        <span className="studio-tag">Text editing</span>
      </div>
      <label htmlFor={`${provider}-key`}>API key</label>
      <div className="studio-input-action">
        <input
          id={`${provider}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={
            keys[provider]
              ? "Paste a new key to replace the saved key"
              : `Paste your ${PROVIDER_NAMES[provider]} key`
          }
        />
        <button
          className="studio-button"
          onClick={() => void save()}
          disabled={!key.trim() || saving || !isTauriRuntime()}
        >
          {saving ? "Saving…" : "Save key"}
        </button>
      </div>
      <p className="studio-key-note">
        <LockKeyhole size={12} /> Stored in Windows Credential Manager. Never in
        browser preferences.
      </p>
      <div className="studio-card-actions">
        <button
          className="studio-link"
          onClick={() => void refreshModels(provider)}
          disabled={!!busy}
        >
          Browse models <ArrowUpRight size={13} />
        </button>
        {keys[provider] && (
          <button
            className="studio-link muted"
            onClick={() => void removeKey(provider)}
          >
            Remove saved key
          </button>
        )}
      </div>
    </section>
  );
}

export default function StudioModels() {
  const [tab, setTab] = useState<ModelTask | "providers">("providers");
  const { refreshKeyStatus, message } = useProviderStore();
  const setActiveView = useDesktopStore((state) => state.setActiveView);
  useEffect(() => {
    void refreshKeyStatus();
  }, [refreshKeyStatus]);
  return (
    <div className="studio-page">
      <div className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">MAKE IT YOURS</p>
          <h1>Your models. Your choice.</h1>
          <p>Choose how Sonolect listens, speaks, and refines your words.</p>
        </div>
        <span className="studio-chip">
          <ShieldCheck size={15} /> Keys stay on your device
        </span>
      </div>
      <div className="studio-tabs">
        {(["providers", "stt", "tts", "text"] as const).map((value) => (
          <button
            key={value}
            className={value === tab ? "active" : ""}
            onClick={() => setTab(value)}
          >
            {value === "providers" ? "Providers" : TASK_NAMES[value]}
          </button>
        ))}
      </div>
      {!isTauriRuntime() && (
        <p className="studio-notice">
          Browser preview. Open the Windows app to save keys and run native
          speech.
        </p>
      )}
      {message && (
        <p role="status" className="studio-notice">
          {message}
        </p>
      )}
      {tab === "providers" ? (
        <>
          <div className="studio-grid two">
            <ProviderCard provider="openrouter" />
            <ProviderCard provider="opencode" />
          </div>
          <div className="studio-local-callout">
            <div className="studio-icon">
              <Cpu size={25} />
            </div>
            <div>
              <h3>Prefer to keep it local?</h3>
              <p>
                Whisper runs on your computer. No API key. No account. No audio
                uploads.
              </p>
            </div>
            <button
              className="studio-button secondary"
              onClick={() => setActiveView("settings")}
            >
              Manage local model <span>→</span>
            </button>
          </div>
          <div className="studio-grid workflow">
            <section className="studio-card">
              <h3>Set up your voice workflow</h3>
              <p className="studio-muted">
                Each task can use a different model.
              </p>
              {(["stt", "tts", "text"] as const).map((task) => (
                <button
                  key={task}
                  className="studio-workflow-row"
                  onClick={() => setTab(task)}
                >
                  <span>{TASK_NAMES[task]}</span>
                  <span>Choose model →</span>
                </button>
              ))}
            </section>
            <section className="studio-privacy-card">
              <ShieldCheck size={27} />
              <h3>Always in your control.</h3>
              <p>
                Adding a key doesn’t change your processing mode. Audio and text
                only go online when you choose cloud processing.
              </p>
              <span>
                <Check size={13} /> PRIVATE BY DEFAULT
              </span>
            </section>
          </div>
        </>
      ) : (
        <section className="studio-card">
          <h2>{TASK_NAMES[tab]}</h2>
          <p className="studio-muted">
            Models are filtered by the provider’s published capabilities.
          </p>
          <StudioModelSelector task={tab} />
          {tab !== "text" && (
            <p className="studio-notice">
              OpenCode Zen is available for text editing. Its public API does
              not currently advertise dedicated speech models.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
