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

/** What the join screen shows. */
export type JoinScreen =
  /** No sync in this build (or on web): the screen sends the user to Capture. */
  | { kind: "leave" }
  /** Not a usable link: why, and a way to Settings. */
  | { kind: "invalid"; error: unknown }
  /**
   * The question before joining. `ready` is false while this phone's sync
   * key is still being read: a key that could not be read yet might be
   * another vault's, so joining waits.
   */
  | { kind: "confirm"; root: Uint8Array; ready: boolean }
  /** This phone already syncs with this key, or with another one. */
  | { kind: "alreadyJoined" | "otherVaultOn" };

/**
 * The join screen for a plan and what sync shows now (SyncController's
 * view and joinOutcome). Pure, for tests.
 */
export function joinScreenFor(
  plan: JoinPlan,
  status: "loading" | "off" | "on" | null,
  outcome: (root: Uint8Array) => "alreadyJoined" | "otherVaultOn" | null,
): JoinScreen {
  if (plan.kind === "unavailable" || status === null) return { kind: "leave" };
  if (plan.kind === "invalid") return { kind: "invalid", error: plan.error };
  if (status === "on") {
    const answer = outcome(plan.root);
    if (answer) return { kind: answer };
  }
  return { kind: "confirm", root: plan.root, ready: status === "off" };
}
