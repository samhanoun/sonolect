import { useEffect, useState } from "react";
import { Shield, Globe, Cpu, Check } from "lucide-react";
import { useDesktopStore, API_URL } from "../store/appStore";
import { STT_LANGUAGES } from "../sttLanguages";
import { isVoiceApiConfigured } from "../voiceApi";
import {
  buildWhisperCommandPreview,
  commandArgsJsonForEnv,
  getWhisperSetupStatus,
  validateWhisperConfig,
} from "../whisperSetup";

const sectionClass =
  "bg-[#0C0C0C] border border-white/5 rounded-2xl p-6 space-y-4";
const labelClass =
  "block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2";
const inputClass =
  "w-full bg-[#0E0E0E] border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-white/20 transition-all";

/**
 * Settings panel, designed in the migrated Tailwind style and bound to the real
 * desktop store (privacy, locale, STT language, local Whisper setup).
 */
export default function SettingsPanel() {
  const privacyLevel = useDesktopStore((s) => s.privacyLevel);
  const setPrivacyLevel = useDesktopStore((s) => s.setPrivacyLevel);
  const locale = useDesktopStore((s) => s.locale);
  const setLocale = useDesktopStore((s) => s.setLocale);
  const sttLanguage = useDesktopStore((s) => s.sttLanguage);
  const setSttLanguage = useDesktopStore((s) => s.setSttLanguage);
  const whisperConfig = useDesktopStore((s) => s.whisperConfig);
  const setWhisperConfig = useDesktopStore((s) => s.setWhisperConfig);

  const [commandJson, setCommandJson] = useState(() =>
    JSON.stringify(whisperConfig.command, null, 2),
  );
  const [diagnostic, setDiagnostic] = useState<string | undefined>();

  useEffect(() => {
    setCommandJson(JSON.stringify(whisperConfig.command, null, 2));
  }, [whisperConfig.command]);

  const whisperStatus = getWhisperSetupStatus(whisperConfig);
  const whisperErrors = validateWhisperConfig(whisperConfig);

  const saveCommandJson = () => {
    try {
      const parsed = JSON.parse(commandJson) as unknown;
      if (
        !Array.isArray(parsed) ||
        !parsed.every((a) => typeof a === "string")
      ) {
        setDiagnostic("Command must be a JSON array of strings.");
        return;
      }
      setWhisperConfig({ ...whisperConfig, command: parsed });
      setDiagnostic("Command saved.");
    } catch {
      setDiagnostic("Invalid JSON.");
    }
  };

  const pill = (active: boolean) =>
    `px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all ${
      active
        ? "bg-white text-black border-white"
        : "bg-transparent text-slate-400 border-white/10 hover:border-white/30"
    }`;

  return (
    <div
      className="flex-1 p-10 bg-[#0A0A0A] text-[#F0F0F0] flex flex-col h-full overflow-y-auto artistic-aura"
      id="settings-panel"
    >
      <div className="absolute top-[-100px] right-[-100px] w-[500px] h-[500px] bg-sky-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="mb-10 pb-6 border-b border-white/5 relative z-10">
        <h2 className="text-3xl font-light text-white tracking-tight">
          Preferences{" "}
          <span className="text-slate-500 italic font-serif">
            &amp; Privacy
          </span>
        </h2>
        <p className="text-[11px] uppercase tracking-widest text-slate-500 mt-1.5">
          Control how Sonolect captures, transcribes, and stores your dictation.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative z-10">
        {/* Privacy */}
        <section className={sectionClass} id="settings-privacy">
          <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400">
            <Shield className="w-3.5 h-3.5" /> Processing mode
          </h3>
          <div className="flex gap-3">
            <button
              type="button"
              className={pill(privacyLevel === "local")}
              onClick={() => setPrivacyLevel("local")}
            >
              Local-first
            </button>
            <button
              type="button"
              className={pill(privacyLevel === "cloud")}
              onClick={() => setPrivacyLevel("cloud")}
            >
              Cloud-assisted
            </button>
          </div>
          <ul className="text-[11px] text-slate-500 space-y-1 list-disc pl-4">
            <li>Audio auto-deletes after processing unless retained.</li>
            <li>Exports are text-only by default.</li>
          </ul>
          <p className="text-[11px] text-slate-500">
            Local API:{" "}
            <code className="text-slate-300">
              {API_URL || "VITE_SONOLECT_API_URL not set"}
            </code>{" "}
            · {isVoiceApiConfigured() ? "configured" : "offline"}
          </p>
        </section>

        {/* Language */}
        <section className={sectionClass} id="settings-language">
          <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400">
            <Globe className="w-3.5 h-3.5" /> Language
          </h3>
          <div>
            <span className={labelClass}>Interface locale</span>
            <div className="flex gap-3">
              <button
                type="button"
                className={pill(locale === "en")}
                onClick={() => setLocale("en")}
              >
                EN
              </button>
              <button
                type="button"
                className={pill(locale === "fr")}
                onClick={() => setLocale("fr")}
              >
                FR
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="stt-language" className={labelClass}>
              Speech-to-text language
            </label>
            <select
              id="stt-language"
              className={`${inputClass} cursor-pointer`}
              value={sttLanguage}
              onChange={(e) => setSttLanguage(e.target.value)}
            >
              {STT_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.nativeName} ({lang.name})
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Whisper / offline engine */}
        <section
          className={`${sectionClass} lg:col-span-2`}
          id="settings-whisper"
        >
          <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400">
            <Cpu className="w-3.5 h-3.5" /> Local Whisper engine (offline
            fallback)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="whisper-model-path" className={labelClass}>
                Model path
              </label>
              <input
                id="whisper-model-path"
                className={inputClass}
                value={whisperConfig.modelPath}
                onChange={(e) =>
                  setWhisperConfig({
                    ...whisperConfig,
                    modelPath: e.target.value,
                  })
                }
                placeholder="C:/Models/ggml-base.en.bin"
              />
            </div>
            <div>
              <label htmlFor="whisper-model-name" className={labelClass}>
                Model name
              </label>
              <input
                id="whisper-model-name"
                className={inputClass}
                value={whisperConfig.modelName}
                onChange={(e) =>
                  setWhisperConfig({
                    ...whisperConfig,
                    modelName: e.target.value,
                  })
                }
                placeholder="base.en"
              />
            </div>
          </div>
          <div>
            <label htmlFor="whisper-command" className={labelClass}>
              Command (JSON array of arguments)
            </label>
            <textarea
              id="whisper-command"
              className={`${inputClass} font-mono`}
              rows={4}
              spellCheck={false}
              value={commandJson}
              onChange={(e) => setCommandJson(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={saveCommandJson}
              className="px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest bg-white text-black hover:bg-slate-200 transition-all flex items-center gap-2"
            >
              <Check className="w-3.5 h-3.5" /> Save command
            </button>
            <button
              type="button"
              onClick={() => setDiagnostic(whisperStatus.message)}
              className="px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest bg-transparent border border-white/10 text-slate-400 hover:border-white/30 transition-all"
            >
              Validate
            </button>
            <button
              type="button"
              onClick={() => {
                const command = [
                  "whisper-cli",
                  "--model",
                  "{model}",
                  "--file",
                  "{audioPath}",
                  "--output-json",
                ];
                setWhisperConfig({
                  ...whisperConfig,
                  command,
                  modelName: "base.en",
                });
                setCommandJson(JSON.stringify(command, null, 2));
                setDiagnostic("Recommended template applied.");
              }}
              className="px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest bg-transparent border border-white/10 text-slate-400 hover:border-white/30 transition-all"
            >
              Use recommended command template
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            <strong className="text-slate-300">Status:</strong>{" "}
            {whisperStatus.message}
          </p>
          {whisperErrors.length > 0 && (
            <ul className="text-[11px] text-red-400 space-y-1 list-disc pl-4">
              {whisperErrors.map((err) => (
                <li key={err.code}>{err.message}</li>
              ))}
            </ul>
          )}
          {whisperConfig.command.length > 0 && (
            <div className="text-[11px] text-slate-500 space-y-1">
              <p>
                <strong className="text-slate-300">Preview:</strong>{" "}
                <code className="text-slate-300">
                  {buildWhisperCommandPreview(whisperConfig)}
                </code>
              </p>
              <p>
                <strong className="text-slate-300">Env value:</strong>{" "}
                <code className="text-slate-300">
                  {commandArgsJsonForEnv(whisperConfig)}
                </code>
              </p>
            </div>
          )}
          {diagnostic && (
            <p role="status" className="text-[11px] text-cyan-400">
              {diagnostic}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
