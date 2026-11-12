import { useEffect, useState } from "react";

import type { CompanionSettings } from "./domain";
import {
  getRecognitionEnvironment,
  subscribeRecognitionEnvironment,
} from "./speech";
import type { RecognitionPlan } from "./speechPolicy";
import { planRecognition } from "./speechPolicy";

/**
 * The plan the next dictation would follow, for the Capture screen's badge
 * and service note. Null until it is known. It is read again when the
 * dictation language or the privacy settings change, and when the device may
 * have changed: after a language pack download, and when the app comes back
 * to the foreground (both invalidate the recognition environment). Paused
 * while a dictation runs, so no locale query competes with the recognizer.
 */
export function useRecognitionPlan(
  settings: Pick<
    CompanionSettings,
    "language" | "privacyLevel" | "allowSystemService"
  >,
  paused: boolean,
): RecognitionPlan | null {
  const { language, privacyLevel, allowSystemService } = settings;
  const key = `${language}|${privacyLevel}|${String(allowSystemService)}`;
  const [version, setVersion] = useState(0);
  const [known, setKnown] = useState<{
    key: string;
    plan: RecognitionPlan;
  } | null>(null);

  useEffect(
    () => subscribeRecognitionEnvironment(() => setVersion((v) => v + 1)),
    [],
  );

  useEffect(() => {
    if (paused) return;
    let current = true;
    getRecognitionEnvironment(language)
      .then((environment) => {
        if (!current) return;
        setKnown({
          key,
          plan: planRecognition({
            ...environment,
            privacyLevel,
            language,
            allowSystemService,
            consentOnce: false,
          }),
        });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [key, language, privacyLevel, allowSystemService, paused, version]);

  return known?.key === key ? known.plan : null;
}
