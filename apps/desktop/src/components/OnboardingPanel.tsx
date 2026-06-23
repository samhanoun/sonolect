import { Check } from "lucide-react";
import { useDesktopStore } from "../store/appStore";
import {
  isOnboardingComplete,
  onboardingProgress,
  type OnboardingChecklist,
} from "../wisprWorkflow";

const ITEMS: Array<{
  key: keyof OnboardingChecklist;
  title: string;
  detail: string;
}> = [
  {
    key: "micPermission",
    title: "Microphone permission",
    detail: "Verify the app can request and receive audio input.",
  },
  {
    key: "shortcutPrimer",
    title: "Global shortcut primer",
    detail: "Learn the hands-free toggle and push-to-talk hotkeys.",
  },
  {
    key: "whisperSetup",
    title: "Whisper setup",
    detail: "Configure a local Whisper command/model or confirm offline mode.",
  },
  {
    key: "privacyChoice",
    title: "Privacy choice",
    detail: "Choose local-first or cloud-assisted processing and retention.",
  },
];

/** First-run setup checklist, ported to the migrated Tailwind design. */
export default function OnboardingPanel() {
  const checklist = useDesktopStore((s) => s.onboardingChecklist);
  const setOnboardingStep = useDesktopStore((s) => s.setOnboardingStep);
  const percent = onboardingProgress(checklist);
  const done = isOnboardingComplete(checklist);

  return (
    <div
      className="flex-1 p-10 bg-[#0A0A0A] text-[#F0F0F0] flex flex-col h-full overflow-y-auto artistic-aura"
      id="onboarding-panel"
    >
      <div className="absolute top-[-100px] right-[-100px] w-[500px] h-[500px] bg-sky-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="mb-8 pb-6 border-b border-white/5 relative z-10">
        <h2 className="text-3xl font-light text-white tracking-tight">
          First-run{" "}
          <span className="text-slate-500 italic font-serif">Setup</span>
        </h2>
        <p className="text-[11px] uppercase tracking-widest text-slate-500 mt-1.5">
          {done
            ? "Sonolect is ready for dictation"
            : `${percent}% complete · finish setup before relying on dictation`}
        </p>
        <div className="mt-4 h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full bg-white transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <div className="space-y-3 relative z-10 max-w-2xl">
        {ITEMS.map((item) => {
          const checked = checklist[item.key];
          return (
            <label
              key={item.key}
              className={`flex items-start gap-4 p-5 rounded-2xl border cursor-pointer transition-all ${
                checked
                  ? "bg-white/5 border-white/10"
                  : "bg-[#0C0C0C] border-white/5 hover:border-white/10"
              }`}
            >
              <span
                className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center border ${
                  checked
                    ? "bg-white border-white"
                    : "border-white/20 bg-transparent"
                }`}
              >
                {checked && <Check className="w-3.5 h-3.5 text-black" />}
              </span>
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={(e) => setOnboardingStep(item.key, e.target.checked)}
              />
              <span>
                <span className="block text-sm text-white font-medium">
                  {item.title}
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  {item.detail}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
