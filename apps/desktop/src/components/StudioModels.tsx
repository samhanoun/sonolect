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
import { useT, type LocaleKeys, type Translator } from "../i18n";

const TASK_NAMES: Record<ModelTask, LocaleKeys> = {
  stt: "studio.task.stt",
  tts: "studio.task.tts",
  text: "studio.task.text",
};
const CATALOG_HINTS: Record<ModelTask, LocaleKeys> = {
  stt: "studio.models.catalogHint.stt",
  tts: "studio.models.catalogHint.tts",
  text: "studio.models.catalogHint.text",
};
/** Provider brand names stay as they are; only "Local Whisper" is translated. */
const providerName = (t: Translator, provider: keyof typeof PROVIDER_NAMES) =>
  provider === "local" ? t("provider.name.local") : PROVIDER_NAMES[provider];
export function StudioModelSelector({
  task,
  inlineStatus = false,
}: {
  task: ModelTask;
  /** Show catalog status beside the selector on pages without a global notice. */
  inlineStatus?: boolean;
}) {
  const {
    preferences,
    models,
    selectModel,
    refreshModels,
    busy,
    setVoice,
    message,
  } = useProviderStore();
  const t = useT();
  const taskName = t(TASK_NAMES[task]);
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
        {t("studio.models.provider")}
        <select
          aria-label={t("studio.models.providerFor", { task: taskName })}
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
              {providerName(t, provider)}
            </option>
          ))}
        </select>
      </label>
      {choice.provider === "local" ? (
        <div className="studio-hint">
          <Cpu size={18} /> {t("studio.models.localHint")}
        </div>
      ) : (
        <>
          <label>
            {t("studio.models.model")}
            <select
              aria-label={t("studio.models.modelFor", { task: taskName })}
              value={choice.model}
              onChange={(event) => {
                selectModel(task, { ...choice, model: event.target.value });
                if (task === "tts") setVoice("");
              }}
            >
              <option value="">{t("studio.models.choose")}</option>
              {choice.model &&
                !available.some((model) => model.id === choice.model) && (
                  <option value={choice.model}>
                    {t("studio.models.savedSelection", {
                      model: choice.model,
                    })}
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
            {busy === choice.provider
              ? t("studio.models.loading")
              : t("studio.models.loadCatalog")}
          </button>
          {inlineStatus && message && (
            <p role="status" className="studio-inline-status">
              {message}
            </p>
          )}
          {!available.length && (
            <p className="studio-muted">{t(CATALOG_HINTS[task])}</p>
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
  const t = useT();
  const router = provider === "openrouter";
  const Icon = router ? Route : Terminal;
  const save = async () => {
    setSaving(true);
    try {
      if (await saveKey(provider, key)) setKey("");
    } finally {
      setSaving(false);
    }
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
              ? t("studio.models.routerTagline")
              : t("studio.models.zenTagline")}
          </p>
        </div>
        <span className={`studio-tag ${keys[provider] ? "green" : ""}`}>
          {keys[provider]
            ? t("studio.models.keySaved")
            : t("studio.models.noKey")}
        </span>
      </div>
      <div className="studio-tags">
        {router ? (
          <>
            <span className="studio-tag green">{t("studio.task.stt")}</span>
            <span className="studio-tag green">{t("studio.task.tts")}</span>
          </>
        ) : (
          <span className="studio-tag amber">
            {t("studio.models.noSpeech")}
          </span>
        )}
        <span className="studio-tag">{t("studio.task.text")}</span>
      </div>
      <label htmlFor={`${provider}-key`}>{t("studio.models.apiKey")}</label>
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
              ? t("studio.models.replaceKey")
              : t("studio.models.pasteKey", {
                  provider: PROVIDER_NAMES[provider],
                })
          }
        />
        <button
          className="studio-button"
          onClick={() => void save()}
          disabled={!key.trim() || saving || !isTauriRuntime()}
        >
          {saving ? t("studio.common.saving") : t("studio.models.saveKey")}
        </button>
      </div>
      <p className="studio-key-note">
        <LockKeyhole size={12} /> {t("studio.models.keyNote")}
      </p>
      <div className="studio-card-actions">
        <button
          className="studio-link"
          onClick={() => void refreshModels(provider)}
          disabled={!!busy}
        >
          {t("studio.models.browse")} <ArrowUpRight size={13} />
        </button>
        {keys[provider] && (
          <button
            className="studio-link muted"
            onClick={() => void removeKey(provider)}
          >
            {t("studio.models.removeKey")}
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
  const t = useT();
  useEffect(() => {
    void refreshKeyStatus();
  }, [refreshKeyStatus]);
  return (
    <div className="studio-page">
      <div className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">{t("studio.models.eyebrow")}</p>
          <h1>{t("studio.models.title")}</h1>
          <p>{t("studio.models.subtitle")}</p>
        </div>
        <span className="studio-chip">
          <ShieldCheck size={15} /> {t("studio.models.chip")}
        </span>
      </div>
      <div className="studio-tabs">
        {(["providers", "stt", "tts", "text"] as const).map((value) => (
          <button
            key={value}
            className={value === tab ? "active" : ""}
            onClick={() => setTab(value)}
          >
            {value === "providers"
              ? t("studio.models.tabProviders")
              : t(TASK_NAMES[value])}
          </button>
        ))}
      </div>
      {!isTauriRuntime() && (
        <p className="studio-notice">{t("studio.models.previewNotice")}</p>
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
              <h3>{t("studio.models.localTitle")}</h3>
              <p>{t("studio.models.localBody")}</p>
            </div>
            <button
              className="studio-button secondary"
              onClick={() => setActiveView("settings")}
            >
              {t("studio.models.manageLocal")} <span>→</span>
            </button>
          </div>
          <div className="studio-grid workflow">
            <section className="studio-card">
              <h3>{t("studio.models.workflowTitle")}</h3>
              <p className="studio-muted">{t("studio.models.workflowBody")}</p>
              {(["stt", "tts", "text"] as const).map((task) => (
                <button
                  key={task}
                  className="studio-workflow-row"
                  onClick={() => setTab(task)}
                >
                  <span>{t(TASK_NAMES[task])}</span>
                  <span>{t("studio.models.chooseModel")}</span>
                </button>
              ))}
            </section>
            <section className="studio-privacy-card">
              <ShieldCheck size={27} />
              <h3>{t("studio.models.controlTitle")}</h3>
              <p>{t("studio.models.controlBody")}</p>
              <span>
                <Check size={13} /> {t("studio.models.privateDefault")}
              </span>
            </section>
          </div>
        </>
      ) : (
        <section className="studio-card">
          <h2>{t(TASK_NAMES[tab])}</h2>
          <p className="studio-muted">{t("studio.models.filtered")}</p>
          <StudioModelSelector task={tab} />
          {tab !== "text" && (
            <p className="studio-notice">{t("studio.models.zenNotice")}</p>
          )}
        </section>
      )}
    </div>
  );
}
