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
import { useT } from "./i18n";

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
  const t = useT();
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
      <section className="glass-card management-panel" aria-labelledby="onboarding-heading-done">
        <p className="section-title">{t("onboarding.sectionTitle")}</p>
        <h3 id="onboarding-heading-done">{t("onboarding.readyTitle")}</h3>
        <p>{t("onboarding.readyDescription")}</p>
        <div className="setup-progress" role="progressbar" aria-valuenow={100} aria-valuemin={0} aria-valuemax={100} aria-label={t("onboarding.sectionTitle")}>
          <span style={{ width: "100%" }} />
        </div>
        <p className="editor-meta" role="status" aria-live="polite" style={{ marginTop: "1rem" }}>
          {progress.completed}/{progress.total} {t("onboarding.stepsCompleted")}
        </p>
      </section>
    );
  }

  return (
    <section className="glass-card management-panel" aria-labelledby="onboarding-heading">
      <p className="section-title">{t("onboarding.sectionTitle")}</p>
      <h3 id="onboarding-heading">{t("onboarding.setupTitle")}</h3>

      <div className="setup-progress" role="progressbar" aria-valuenow={progress.percentage} aria-valuemin={0} aria-valuemax={100} aria-label={t("onboarding.sectionTitle")}>
        <span style={{ width: `${progress.percentage}%` }} />
      </div>
      <p className="editor-meta" role="status" aria-live="polite" style={{ marginBottom: "1rem" }}>
        Step {wizard.currentStepIndex + 1} {t("onboarding.stepOf")} {wizard.steps.length} ·{" "}
        {progress.percentage}% {t("onboarding.percentComplete")}
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
              {t("onboarding.back")}
            </button>
            {currentStep.skipAllowed ? (
              <button
                className="ghost-button"
                onClick={handleSkip}
                type="button"
              >
                {t("onboarding.skip")}
              </button>
            ) : null}
            <button
              className="primary-button compact"
              onClick={handleComplete}
              type="button"
            >
              {t("onboarding.complete")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="preference-list" role="list" aria-label={t("onboarding.sectionTitle")} style={{ marginTop: "1rem" }}>
        {wizard.steps.map((step, i) => {
          const done = wizard.completed.has(step.id);
          const skipped = wizard.skipped.has(step.id);
          const active = i === wizard.currentStepIndex;
          return (
            <div
              className={`preference-row${active ? " check-row" : ""}`}
              key={step.id}
              role="listitem"
              aria-current={active ? "step" : undefined}
            >
              <div>
                <strong>
                  {done ? `${t("onboarding.donePrefix")} ` : skipped ? `${t("onboarding.skippedPrefix")} ` : ""}
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
