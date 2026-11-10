import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrivacyLevel } from "./domain";
import { DEFAULT_SETTINGS, normalizeSettings } from "./domain";
import type {
  DownloadAttempt,
  PermissionOutcome,
  PlanInput,
  RecognitionPlatform,
} from "./speechPolicy";
import {
  DOWNLOAD_TIMEOUT_MS,
  LOCALES_TIMEOUT_MS,
  blockedNoticeKind,
  classifySpeechError,
  downloadNoticeKind,
  localeMatches,
  mapDownloadOutcome,
  permissionNoticeKind,
  planRecognition,
  shouldRetryWithSystemService,
  systemServicePlan,
} from "./speechPolicy";

const input = (overrides: Partial<PlanInput>): PlanInput => ({
  platform: "android",
  osVersion: 34,
  privacyLevel: "local_first",
  language: "fr-FR",
  recognitionAvailable: true,
  onDeviceService: true,
  installedLocales: ["fr-FR"],
  localeOnDevice: null,
  allowSystemService: false,
  consentOnce: false,
  ...overrides,
});

describe("planRecognition", () => {
  it("uses the system speech service in Standard, with an honest badge", () => {
    const android = planRecognition(input({ privacyLevel: "standard" }));
    assert.deepEqual(android, {
      route: "system-service",
      requiresOnDevice: false,
      canDownloadModel: false,
      badge: "system-service",
    });
    const ios = planRecognition(
      input({ platform: "ios", osVersion: 17, privacyLevel: "standard" }),
    );
    assert.equal(ios.route, "system-service");
    assert.equal(ios.requiresOnDevice, false);
    assert.equal(ios.badge, "apple-service");
    // Even where the locale could run on the device (decision 8).
    const iosOnDevice = planRecognition(
      input({
        platform: "ios",
        osVersion: 17,
        privacyLevel: "standard",
        localeOnDevice: true,
      }),
    );
    assert.equal(iosOnDevice.route, "system-service");
  });

  it("runs on the device on Android 13+ when the language pack is installed", () => {
    const plan = planRecognition(input({ installedLocales: ["fr-FR"] }));
    assert.deepEqual(plan, {
      route: "on-device",
      requiresOnDevice: true,
      canDownloadModel: false,
      badge: "on-device",
    });
    assert.equal(
      planRecognition(input({ installedLocales: ["fr_fr"] })).route,
      "on-device",
    );
  });

  it("offers the download when the pack is missing, and the service only with consent", () => {
    const blocked = planRecognition(input({ installedLocales: ["en-US"] }));
    assert.equal(blocked.route, "blocked");
    assert.equal(blocked.blockedReason, "model-missing");
    assert.equal(blocked.canDownloadModel, true);
    assert.equal(blocked.requiresOnDevice, false);

    for (const consent of [
      { consentOnce: true },
      { allowSystemService: true },
    ]) {
      const plan = planRecognition(
        input({ installedLocales: ["en-US"], ...consent }),
      );
      assert.equal(plan.route, "system-service");
      assert.equal(plan.requiresOnDevice, false);
      assert.equal(plan.badge, "system-service");
      assert.equal(plan.blockedReason, undefined);
    }
  });

  it("makes a strict on-device attempt when the installed list is unknown", () => {
    const plan = planRecognition(input({ installedLocales: null }));
    assert.equal(plan.route, "on-device");
    assert.equal(plan.requiresOnDevice, true);
  });

  it("treats an empty installed list as a missing pack", () => {
    const plan = planRecognition(input({ installedLocales: [] }));
    assert.equal(plan.blockedReason, "model-missing");
  });

  it("asks for consent on Android 12 and on Android without an on-device service", () => {
    const android12 = planRecognition(
      input({ osVersion: 32, installedLocales: null }),
    );
    assert.equal(android12.route, "blocked");
    assert.equal(android12.blockedReason, "needs-consent");
    assert.equal(android12.canDownloadModel, false);

    const noService = planRecognition(input({ onDeviceService: false }));
    assert.equal(noService.route, "blocked");
    assert.equal(noService.blockedReason, "needs-consent");
  });

  it("uses the per-locale answer on iOS", () => {
    const ios = (localeOnDevice: boolean | null, privacy: PrivacyLevel) =>
      planRecognition(
        input({
          platform: "ios",
          osVersion: 18,
          privacyLevel: privacy,
          onDeviceService: true,
          installedLocales: null,
          localeOnDevice,
        }),
      );
    for (const privacy of ["local_first", "ephemeral"] as const) {
      const onDevice = ios(true, privacy);
      assert.equal(onDevice.route, "on-device");
      assert.equal(onDevice.requiresOnDevice, true);
      assert.equal(onDevice.badge, "on-device");
      for (const unknownOrNo of [false, null]) {
        const plan = ios(unknownOrNo, privacy);
        assert.equal(plan.route, "blocked");
        assert.equal(plan.blockedReason, "needs-consent");
        assert.equal(plan.badge, "apple-service");
      }
    }
    const consented = planRecognition(
      input({
        platform: "ios",
        osVersion: 18,
        localeOnDevice: false,
        consentOnce: true,
      }),
    );
    assert.equal(consented.route, "system-service");
    assert.equal(consented.badge, "apple-service");
  });

  it("asks for consent on the web", () => {
    const plan = planRecognition(
      input({ platform: "web", osVersion: 0, onDeviceService: false }),
    );
    assert.equal(plan.blockedReason, "needs-consent");
  });

  it("is blocked when no recognizer is available", () => {
    for (const privacyLevel of ["standard", "local_first"] as const) {
      const plan = planRecognition(
        input({ recognitionAvailable: false, privacyLevel, consentOnce: true }),
      );
      assert.equal(plan.route, "blocked");
      assert.equal(plan.blockedReason, "unavailable");
      assert.equal(plan.canDownloadModel, false);
    }
  });

  it("keeps its invariants for every combination", () => {
    const platforms: RecognitionPlatform[] = ["ios", "android", "web"];
    const privacyLevels: PrivacyLevel[] = [
      "standard",
      "local_first",
      "ephemeral",
    ];
    let cases = 0;
    for (const platform of platforms)
      for (const osVersion of [26, 30, 31, 32, 33, 34, 35, 36])
        for (const privacyLevel of privacyLevels)
          for (const installedLocales of [null, [], ["fr-FR"]])
            for (const allowSystemService of [false, true])
              for (const consentOnce of [false, true])
                for (const onDeviceService of [false, true])
                  for (const localeOnDevice of [null, false, true])
                    for (const recognitionAvailable of [false, true]) {
                      cases += 1;
                      const plan = planRecognition({
                        platform,
                        osVersion,
                        privacyLevel,
                        language: "fr-FR",
                        recognitionAvailable,
                        onDeviceService,
                        installedLocales,
                        localeOnDevice,
                        allowSystemService,
                        consentOnce,
                      });
                      const label = JSON.stringify({
                        platform,
                        osVersion,
                        privacyLevel,
                        installedLocales,
                        allowSystemService,
                        consentOnce,
                        onDeviceService,
                        localeOnDevice,
                        recognitionAvailable,
                      });
                      assert.equal(
                        plan.requiresOnDevice,
                        plan.route === "on-device",
                        label,
                      );
                      if (platform === "android" && osVersion < 33) {
                        assert.equal(plan.requiresOnDevice, false, label);
                      }
                      if (platform === "web") {
                        assert.equal(plan.requiresOnDevice, false, label);
                      }
                      assert.equal(
                        plan.blockedReason !== undefined,
                        plan.route === "blocked",
                        label,
                      );
                      if (plan.canDownloadModel) {
                        assert.equal(
                          plan.blockedReason,
                          "model-missing",
                          label,
                        );
                      }
                      if (privacyLevel === "standard") {
                        assert.notEqual(plan.route, "on-device", label);
                      } else if (!allowSystemService && !consentOnce) {
                        // Never the system speech service without consent.
                        assert.notEqual(plan.route, "system-service", label);
                      }
                      assert.equal(
                        plan.badge === "on-device",
                        plan.route === "on-device",
                        label,
                      );
                    }
    assert.equal(cases, 3 * 8 * 3 * 3 * 2 * 2 * 2 * 3 * 2);
  });

  it("builds the plan a session switches to after consent", () => {
    assert.deepEqual(systemServicePlan("ios"), {
      route: "system-service",
      requiresOnDevice: false,
      canDownloadModel: false,
      badge: "apple-service",
    });
    assert.equal(systemServicePlan("android").badge, "system-service");
  });

  it("caps the waits", () => {
    assert.equal(LOCALES_TIMEOUT_MS, 1_500);
    assert.equal(DOWNLOAD_TIMEOUT_MS, 120_000);
  });
});

describe("localeMatches", () => {
  const cases: [string, readonly string[], boolean][] = [
    ["fr-FR", ["fr_FR"], true],
    ["fr-FR", ["FR-fr"], true],
    ["fr-FR", ["fr"], true],
    ["fr-FR", ["fr-CA"], true],
    ["fr-FR", ["en-US", " fr-fr "], true],
    ["en-US", ["de-DE"], false],
    ["en-US", [], false],
    ["ar-SA", ["en-US", "fr-FR"], false],
  ];
  for (const [language, installed, expected] of cases) {
    it(`${language} against ${JSON.stringify(installed)}: ${expected}`, () => {
      assert.equal(localeMatches(language, installed), expected);
    });
  }
});

describe("classifySpeechError", () => {
  const android = { requiresOnDevice: true, platform: "android" } as const;
  const ios = { requiresOnDevice: true, platform: "ios" } as const;
  const service = { requiresOnDevice: false, platform: "android" } as const;

  it("treats silence as a benign end and abort as a cancel", () => {
    assert.equal(classifySpeechError("no-speech", android), "benign");
    assert.equal(classifySpeechError("speech-timeout", service), "benign");
    assert.equal(classifySpeechError("aborted", service), "aborted");
  });

  it("maps a missing language by route and platform", () => {
    assert.equal(
      classifySpeechError("language-not-supported", android),
      "modelMissing",
    );
    assert.equal(
      classifySpeechError("language-not-supported", ios),
      "needsConsent",
    );
    assert.equal(
      classifySpeechError("language-not-supported", service),
      "languageNotSupported",
    );
    assert.equal(
      classifySpeechError("language-not-supported", {
        requiresOnDevice: false,
        platform: "ios",
      }),
      "languageNotSupported",
    );
  });

  it("maps every other code to its own notice", () => {
    const table: [string, string][] = [
      ["network", "network"],
      ["not-allowed", "micDenied"],
      ["service-not-allowed", "serviceNotAllowed"],
      ["busy", "busy"],
      ["audio-capture", "audioCapture"],
      ["interrupted", "interrupted"],
      ["start-failed", "startFailed"],
      ["unsupported", "unavailable"],
      ["client", "generic"],
      ["bad-grammar", "generic"],
      ["too-many-requests", "generic"],
      ["unknown", "generic"],
      ["something-new", "generic"],
    ];
    for (const [code, kind] of table) {
      assert.equal(classifySpeechError(code, service), kind, code);
    }
  });
});

describe("shouldRetryWithSystemService", () => {
  const base = {
    code: "language-not-supported",
    requiresOnDevice: true,
    consented: true,
    alreadyRetried: false,
    stopRequested: false,
  };

  it("retries once with consent after a missing language", () => {
    assert.equal(shouldRetryWithSystemService(base), true);
  });

  it("never retries without consent, twice, after Done or for other errors", () => {
    assert.equal(
      shouldRetryWithSystemService({ ...base, consented: false }),
      false,
    );
    assert.equal(
      shouldRetryWithSystemService({ ...base, alreadyRetried: true }),
      false,
    );
    assert.equal(
      shouldRetryWithSystemService({ ...base, stopRequested: true }),
      false,
    );
    assert.equal(
      shouldRetryWithSystemService({ ...base, requiresOnDevice: false }),
      false,
    );
    assert.equal(
      shouldRetryWithSystemService({ ...base, code: "network" }),
      false,
    );
  });
});

describe("mapDownloadOutcome", () => {
  it("maps every expo-speech-recognition 58.0.1 result", () => {
    const table: [DownloadAttempt, string][] = [
      [{ status: "download_success", message: "" }, "installed"],
      [{ status: "opened_dialog", message: "" }, "dialog-opened"],
      [{ status: "download_scheduled", message: "" }, "scheduled"],
      [{ status: "something_else" }, "failed"],
      [
        {
          error: Object.assign(new Error("Android version is too old"), {
            code: "not_supported",
          }),
        },
        "not-supported",
      ],
      [{ error: { message: "not_supported" } }, "not-supported"],
      [
        {
          error: Object.assign(new Error("Failed to download: 5"), {
            code: "error_5",
          }),
        },
        "failed",
      ],
      [{ error: undefined }, "failed"],
      ["timeout", "scheduled"],
    ];
    for (const [attempt, outcome] of table) {
      assert.equal(
        mapDownloadOutcome(attempt),
        outcome,
        JSON.stringify(attempt),
      );
    }
  });

  it("names a notice for every outcome", () => {
    assert.equal(downloadNoticeKind("installed"), "modelInstalled");
    assert.equal(downloadNoticeKind("dialog-opened"), "modelDialogOpened");
    assert.equal(downloadNoticeKind("scheduled"), "modelScheduled");
    assert.equal(downloadNoticeKind("not-supported"), "modelNotSupported");
    assert.equal(downloadNoticeKind("failed"), "modelFailed");
  });
});

describe("permission and blocked notices", () => {
  it("names the permission that is off", () => {
    const table: [PermissionOutcome, string | null][] = [
      [{ status: "granted" }, null],
      [{ status: "unsupported" }, "unavailable"],
      [
        { status: "denied", which: "microphone", canAskAgain: true },
        "micDenied",
      ],
      [
        { status: "denied", which: "microphone", canAskAgain: false },
        "micBlocked",
      ],
      [
        {
          status: "denied",
          which: "speech",
          canAskAgain: false,
          restricted: true,
        },
        "speechRestricted",
      ],
      [
        { status: "denied", which: "speech", canAskAgain: false },
        "speechDenied",
      ],
    ];
    for (const [outcome, kind] of table) {
      assert.equal(
        permissionNoticeKind(outcome),
        kind,
        JSON.stringify(outcome),
      );
    }
  });

  it("names a notice for every blocked reason", () => {
    assert.equal(blockedNoticeKind("unavailable"), "unavailable");
    assert.equal(blockedNoticeKind("model-missing"), "modelMissing");
    assert.equal(blockedNoticeKind("needs-consent"), "needsConsent");
  });
});

describe("consent setting", () => {
  it("is off by default and only a boolean turns it on", () => {
    assert.equal(DEFAULT_SETTINGS.allowSystemService, false);
    assert.equal(normalizeSettings({}).allowSystemService, false);
    assert.equal(
      normalizeSettings({ allowSystemService: "yes" as never })
        .allowSystemService,
      false,
    );
    assert.equal(
      normalizeSettings({ allowSystemService: 1 as never }).allowSystemService,
      false,
    );
    assert.equal(
      normalizeSettings({ allowSystemService: true }).allowSystemService,
      true,
    );
  });
});
