import { parsePairing, parsePairingParams } from "@sonolect/sync-core";

/**
 * Reading a sync code: from the join link (sonolect://sync/join?v=1&k=…,
 * the QR code) or typed in Settings. The link carries only the key; the
 * server comes from the build. Unknown parameters are ignored.
 */
export type JoinPlan =
  /** This build has no sync server: the link goes to Capture. */
  | { kind: "unavailable" }
  /** Not a usable code: say why (messages.ts pairingErrorText). */
  | { kind: "invalid"; error: unknown }
  /** Ask first, then join. */
  | { kind: "confirm"; root: Uint8Array };

/** The join screen's plan for its link parameters (expo-router's useLocalSearchParams). */
export function joinPlanForLink(
  syncUrl: string | null,
  params: Record<string, string | readonly string[] | undefined>,
): JoinPlan {
  if (!syncUrl) return { kind: "unavailable" };
  try {
    return { kind: "confirm", root: parsePairingParams(params) };
  } catch (error) {
    return { kind: "invalid", error };
  }
}

/** The plan for a code typed or pasted in Settings: the 56 characters or a whole link. */
export function joinPlanForText(
  syncUrl: string | null,
  text: string,
): JoinPlan {
  if (!syncUrl) return { kind: "unavailable" };
  try {
    return { kind: "confirm", root: parsePairing(text) };
  } catch (error) {
    return { kind: "invalid", error };
  }
}
