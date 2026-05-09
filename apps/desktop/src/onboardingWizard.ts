import type { OnboardingChecklist } from "./wisprWorkflow";
import { checkPermission, detectPlatform } from "./platformPermissions";

export type OnboardingStep = {
  id: keyof OnboardingChecklist;
  title: string;
  description: string;
  instruction: string;
  checkFn: () => boolean | Promise<boolean>;
  skipAllowed: boolean;
};

export type WizardState = {
  currentStepIndex: number;
  steps: OnboardingStep[];
  completed: Set<string>;
  skipped: Set<string>;
};

export function buildOnboardingSteps(): OnboardingStep[] {
  return [
    {
      id: "micPermission",
      title: "Allow Microphone Access",
      description:
        "Sonolect needs microphone permission to capture your voice.",
      instruction:
        "Click 'Allow' when your browser or OS prompts for microphone access.",
      checkFn: async () => {
        try {
          const result = await checkPermission("microphone");
          return result.status === "granted";
        } catch {
          // Fallback: check if getUserMedia API is available
          return (
            typeof navigator !== "undefined" &&
            typeof navigator.mediaDevices !== "undefined" &&
            typeof navigator.mediaDevices.getUserMedia === "function"
          );
        }
      },
      skipAllowed: false,
    },
    {
      id: "shortcutPrimer",
      title: "Learn Your Shortcuts",
      description:
        "Toggle recording with Cmd+Shift+R and push-to-talk with Cmd+Shift+T.",
      instruction:
        "Review the shortcuts above, then click 'Done' to acknowledge.",
      checkFn: async () => {
        const platform = detectPlatform();
        if (platform === "macos") {
          try {
            const result = await checkPermission("accessibility");
            // If accessibility is denied on macOS, the step is not auto-complete
            // but we still return true so the user can acknowledge shortcuts.
            // The PermissionGuard component handles blocking if needed.
            return result.status === "granted";
          } catch {
            return true;
          }
        }
        return true;
      },
      skipAllowed: true,
    },
    {
      id: "whisperSetup",
      title: "Set Up Local Whisper",
      description:
        "Configure a local Whisper model for private, offline transcription.",
      instruction:
        "Select a Whisper model size and verify the engine is ready.",
      checkFn: () => false,
      skipAllowed: true,
    },
    {
      id: "privacyChoice",
      title: "Choose Privacy Level",
      description:
        "Decide whether transcription happens locally or in the cloud.",
      instruction:
        "Select 'Local only' for maximum privacy or 'Cloud' for faster processing. Your choice can be changed later in settings.",
      checkFn: () => false,
      skipAllowed: false,
    },
  ];
}

function findNextIncompleteIndex(state: WizardState): number {
  for (let i = 0; i < state.steps.length; i++) {
    const stepId = state.steps[i]!.id;
    if (!state.completed.has(stepId) && !state.skipped.has(stepId)) {
      return i;
    }
  }
  return state.steps.length;
}

export function advanceWizard(state: WizardState): WizardState {
  const nextIndex = findNextIncompleteIndex(state);
  return { ...state, currentStepIndex: nextIndex };
}

export function skipStep(state: WizardState): WizardState {
  const currentStep = state.steps[state.currentStepIndex];
  if (!currentStep) return state;
  const skipped = new Set(state.skipped);
  skipped.add(currentStep.id);
  const next: WizardState = { ...state, skipped };
  return advanceWizard(next);
}

export function completeStep(state: WizardState): WizardState {
  const currentStep = state.steps[state.currentStepIndex];
  if (!currentStep) return state;
  const completed = new Set(state.completed);
  completed.add(currentStep.id);
  const next: WizardState = { ...state, completed };
  return advanceWizard(next);
}

export function wizardProgress(state: WizardState): {
  completed: number;
  total: number;
  percentage: number;
} {
  const total = state.steps.length;
  const completed = state.completed.size;
  const percentage = total === 0 ? 100 : Math.round((completed / total) * 100);
  return { completed, total, percentage };
}

export function isWizardFinished(state: WizardState): boolean {
  return state.steps.every(
    (step) => state.completed.has(step.id) || state.skipped.has(step.id),
  );
}

export function initWizardState(checklist: OnboardingChecklist): WizardState {
  const steps = buildOnboardingSteps();
  const completed = new Set<string>();
  const skipped = new Set<string>();

  for (const step of steps) {
    if (checklist[step.id]) {
      completed.add(step.id);
    }
  }

  const state: WizardState = {
    currentStepIndex: 0,
    steps,
    completed,
    skipped,
  };

  return advanceWizard(state);
}
