import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildOnboardingSteps,
  advanceWizard,
  skipStep,
  completeStep,
  wizardProgress,
  isWizardFinished,
  initWizardState,
} from "./onboardingWizard";
import type { OnboardingChecklist } from "./wisprWorkflow";

describe("onboardingWizard", () => {
  // ── buildOnboardingSteps ───────────────────────────────────────
  describe("buildOnboardingSteps", () => {
    it("returns 4 ordered steps", () => {
      const steps = buildOnboardingSteps();
      assert.strictEqual(steps.length, 4);
    });

    it("steps are in the expected order", () => {
      const steps = buildOnboardingSteps();
      assert.strictEqual(steps[0]!.id, "micPermission");
      assert.strictEqual(steps[1]!.id, "shortcutPrimer");
      assert.strictEqual(steps[2]!.id, "whisperSetup");
      assert.strictEqual(steps[3]!.id, "privacyChoice");
    });

    it("every step has required fields", () => {
      for (const step of buildOnboardingSteps()) {
        assert.ok(step.id, "Missing id");
        assert.ok(step.title, "Missing title");
        assert.ok(step.description, "Missing description");
        assert.ok(step.instruction, "Missing instruction");
        assert.strictEqual(typeof step.checkFn, "function");
        assert.strictEqual(typeof step.skipAllowed, "boolean");
      }
    });
  });

  // ── step progression ───────────────────────────────────────────
  describe("step progression", () => {
    function freshState() {
      return initWizardState({
        micPermission: false,
        shortcutPrimer: false,
        whisperSetup: false,
        privacyChoice: false,
      });
    }

    it("starts at the first incomplete step", () => {
      const state = freshState();
      assert.strictEqual(state.currentStepIndex, 0);
    });

    it("completeStep advances to the next step", () => {
      const state = freshState();
      const next = completeStep(state);
      assert.strictEqual(next.currentStepIndex, 1);
      assert.ok(next.completed.has("micPermission"));
    });

    it("skipStep advances to the next step", () => {
      const state = freshState();
      const next = skipStep(state);
      assert.strictEqual(next.currentStepIndex, 1);
      assert.ok(next.skipped.has("micPermission"));
    });

    it("completing all steps moves index past the end", () => {
      let state = freshState();
      state = completeStep(state);
      state = completeStep(state);
      state = completeStep(state);
      state = completeStep(state);
      assert.strictEqual(state.currentStepIndex, state.steps.length);
    });

    it("mixing complete and skip works correctly", () => {
      let state = freshState();
      state = completeStep(state); // micPermission
      state = skipStep(state); // shortcutPrimer
      state = completeStep(state); // whisperSetup
      assert.strictEqual(state.currentStepIndex, 3);
      assert.ok(state.completed.has("micPermission"));
      assert.ok(state.skipped.has("shortcutPrimer"));
      assert.ok(state.completed.has("whisperSetup"));
    });
  });

  // ── wizardProgress ─────────────────────────────────────────────
  describe("wizardProgress", () => {
    it("reports 0% at the start", () => {
      const state = initWizardState({
        micPermission: false,
        shortcutPrimer: false,
        whisperSetup: false,
        privacyChoice: false,
      });
      const progress = wizardProgress(state);
      assert.strictEqual(progress.completed, 0);
      assert.strictEqual(progress.total, 4);
      assert.strictEqual(progress.percentage, 0);
    });

    it("reports correct percentage after completing steps", () => {
      let state = initWizardState({
        micPermission: false,
        shortcutPrimer: false,
        whisperSetup: false,
        privacyChoice: false,
      });
      state = completeStep(state);
      state = completeStep(state);
      const progress = wizardProgress(state);
      assert.strictEqual(progress.completed, 2);
      assert.strictEqual(progress.percentage, 50);
    });

    it("skipped steps do not count as completed in progress", () => {
      let state = initWizardState({
        micPermission: false,
        shortcutPrimer: false,
        whisperSetup: false,
        privacyChoice: false,
      });
      state = completeStep(state);
      state = skipStep(state);
      const progress = wizardProgress(state);
      assert.strictEqual(progress.completed, 1);
      assert.strictEqual(progress.percentage, 25);
    });
  });

  // ── isWizardFinished ───────────────────────────────────────────
  describe("isWizardFinished", () => {
    it("returns false when steps remain", () => {
      const state = initWizardState({
        micPermission: false,
        shortcutPrimer: false,
        whisperSetup: false,
        privacyChoice: false,
      });
      assert.strictEqual(isWizardFinished(state), false);
    });

    it("returns true when all steps are completed", () => {
      let state = initWizardState({
        micPermission: false,
        shortcutPrimer: false,
        whisperSetup: false,
        privacyChoice: false,
      });
      state = completeStep(state);
      state = completeStep(state);
      state = completeStep(state);
      state = completeStep(state);
      assert.strictEqual(isWizardFinished(state), true);
    });

    it("returns true when all steps are completed or skipped", () => {
      let state = initWizardState({
        micPermission: false,
        shortcutPrimer: false,
        whisperSetup: false,
        privacyChoice: false,
      });
      state = completeStep(state);
      state = skipStep(state);
      state = completeStep(state);
      state = skipStep(state);
      assert.strictEqual(isWizardFinished(state), true);
    });
  });

  // ── initWizardState (resume from partial) ─────────────────────
  describe("initWizardState", () => {
    it("resumes from existing progress", () => {
      const checklist: OnboardingChecklist = {
        micPermission: true,
        shortcutPrimer: true,
        whisperSetup: false,
        privacyChoice: false,
      };
      const state = initWizardState(checklist);
      assert.ok(state.completed.has("micPermission"));
      assert.ok(state.completed.has("shortcutPrimer"));
      assert.strictEqual(state.currentStepIndex, 2);
    });

    it("skips to end when all are already complete", () => {
      const checklist: OnboardingChecklist = {
        micPermission: true,
        shortcutPrimer: true,
        whisperSetup: true,
        privacyChoice: true,
      };
      const state = initWizardState(checklist);
      assert.strictEqual(state.currentStepIndex, state.steps.length);
      assert.strictEqual(isWizardFinished(state), true);
    });

    it("starts at first incomplete when none are done", () => {
      const checklist: OnboardingChecklist = {
        micPermission: false,
        shortcutPrimer: false,
        whisperSetup: false,
        privacyChoice: false,
      };
      const state = initWizardState(checklist);
      assert.strictEqual(state.currentStepIndex, 0);
      assert.strictEqual(state.completed.size, 0);
    });
  });
});
