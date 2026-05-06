import React, { useState, useMemo } from "react";
import type { OnboardingChecklist } from "./wisprWorkflow";
import {
  initWizardState,
  advanceWizard,
  completeStep,
  skipStep,
  wizardProgress,
  isWizardFinished,
  type WizardState,
} from "./onboardingWizard";

export type OnboardingViewProps = {
  checklist: OnboardingChecklist;
  onComplete: (step: keyof OnboardingChecklist) => void;
  onSkip: (step: keyof OnboardingChecklist) => void;
};

export function OnboardingView({
  checklist,
  onComplete,
  onSkip,
}: OnboardingViewProps) {
  const [wizard, setWizard] = useState<WizardState>(() =>
    initWizardState(checklist),
  );

  const progress = useMemo(() => wizardProgress(wizard), [wizard]);
  const finished = useMemo(() => isWizardFinished(wizard), [wizard]);
  const currentStep = wizard.steps[wizard.currentStepIndex];

  function handleComplete() {
    if (!currentStep) return;
    onComplete(currentStep.id);
    setWizard((prev) => completeStep(prev));
  }

  function handleSkip() {
    if (!currentStep) return;
    onSkip(currentStep.id);
    setWizard((prev) => skipStep(prev));
  }

  function handleBack() {
    setWizard((prev) => {
      if (prev.currentStepIndex <= 0) return prev;
      return { ...prev, currentStepIndex: prev.currentStepIndex - 1 };
    });
  }

  if (finished) {
    return (
      <section className="glass-card management-panel">
        <p className="section-title">First-run setup</p>
        <h3>Sonolect is ready for dictation</h3>
        <p>
          All onboarding steps are complete. You can re-run setup anytime from
          the sidebar.
        </p>
        <div className="setup-progress">
          <span style={{ width: "100%" }} />
        </div>
        <p className="editor-meta" style={{ marginTop: "1rem" }}>
          {progress.completed}/{progress.total} steps completed
        </p>
      </section>
    );
  }

  return (
    <section className="glass-card management-panel">
      <p className="section-title">First-run setup</p>
      <h3>Complete setup before relying on dictation</h3>

      <div className="setup-progress">
        <span style={{ width: `${progress.percentage}%` }} />
      </div>
      <p className="editor-meta" style={{ marginBottom: "1rem" }}>
        Step {wizard.currentStepIndex + 1} of {wizard.steps.length} ·{" "}
        {progress.percentage}% complete
      </p>

      {currentStep ? (
        <div className="glass-card" style={{ padding: "1.5rem" }}>
          <p className="section-title">{currentStep.title}</p>
          <p style={{ marginTop: "0.5rem" }}>{currentStep.description}</p>
          <p className="editor-meta" style={{ marginTop: "0.75rem" }}>
            {currentStep.instruction}
          </p>

          <div className="inline-actions" style={{ marginTop: "1rem" }}>
            <button
              className="ghost-button"
              onClick={handleBack}
              disabled={wizard.currentStepIndex === 0}
              type="button"
            >
              Back
            </button>
            {currentStep.skipAllowed ? (
              <button
                className="ghost-button"
                onClick={handleSkip}
                type="button"
              >
                Skip
              </button>
            ) : null}
            <button
              className="primary-button compact"
              onClick={handleComplete}
              type="button"
            >
              Complete
            </button>
          </div>
        </div>
      ) : null}

      <div className="preference-list" style={{ marginTop: "1rem" }}>
        {wizard.steps.map((step, i) => {
          const done = wizard.completed.has(step.id);
          const skipped = wizard.skipped.has(step.id);
          const active = i === wizard.currentStepIndex;
          return (
            <div
              className={`preference-row${active ? " check-row" : ""}`}
              key={step.id}
            >
              <div>
                <strong>
                  {done ? "[done] " : skipped ? "[skipped] " : ""}
                  {step.title}
                </strong>
                <p className="editor-meta">{step.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
