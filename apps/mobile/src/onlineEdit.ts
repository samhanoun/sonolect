import type {
  CompanionSettings,
  DictionaryEntry,
  RefinementMode,
  Snippet,
  TranscriptTurn,
} from "./domain";
import type { OnlineNoticeKind } from "./notices";
import { onlineFailureNotice } from "./notices";
import type { OnlineEditing, OnlinePlan, OnlineProvider } from "./onlineRefine";
import {
  isOnlineMode,
  normalizeOnlineEditing,
  planOnlineRefine,
  refineOnline,
} from "./onlineRefine";
import type { ProviderKeyStatus } from "./providerKeys";
import { refineLocally } from "./refine";

/**
 * The store's Rewrite and Reply with the user's own key: the consent plan,
 * then one request. Pure, so tests can drive it with a mocked fetch and a
 * fake SecureStore; store.ts passes the real ones and applies the outcome.
 */

type PlanSettings = Pick<CompanionSettings, "privacyLevel"> & {
  onlineEditing?: unknown;
};

/** planOnlineRefine, with the key status of the chosen provider. */
export function planOnlineEdit(input: {
  mode: RefinementMode;
  settings: PlanSettings;
  keySaved: Readonly<ProviderKeyStatus>;
  web: boolean;
  consentedNow: boolean;
  /** The note was made in Ephemeral: it is asked for like one. */
  ephemeralNote?: boolean | undefined;
}): OnlinePlan {
  const editing = normalizeOnlineEditing(input.settings.onlineEditing);
  return planOnlineRefine({
    mode: input.mode,
    settings: input.settings,
    hasKey: editing ? input.keySaved[editing.provider] : false,
    web: input.web,
    consentedNow: input.consentedNow,
    ephemeralNote: input.ephemeralNote === true,
  });
}

export type OnlineEditOutcome =
  /** Not an online edit: the store refines on the phone, as before. */
  | { kind: "local" }
  /** The user has not agreed yet. Nothing was read or sent. */
  | { kind: "ask"; editing: OnlineEditing }
  /** The model's text on the note as it is now. rawText is kept. */
  | { kind: "applied"; turn: TranscriptTurn }
  /** Nothing changed; the notice says why. */
  | { kind: "failed"; notice: OnlineNoticeKind }
  /**
   * The note was deleted, or the data erased, during the request: nothing
   * is written and nothing is shown.
   */
  | { kind: "stale" };

/** A provider and a model, as the consent dialog named them. */
export type OnlineChoice = Pick<OnlineEditing, "provider" | "model">;

/**
 * Whether the consent given in the dialog covers the current choice. A
 * consent names a provider and a model; it never carries over to others.
 */
export function consentCovers(
  consentedTo: OnlineChoice | undefined,
  settings: { onlineEditing?: unknown },
): boolean {
  const editing = normalizeOnlineEditing(settings.onlineEditing);
  return (
    consentedTo !== undefined &&
    editing !== undefined &&
    consentedTo.provider === editing.provider &&
    consentedTo.model === editing.model
  );
}

export interface OnlineEditInput {
  /** The note when the user tapped. */
  turn: TranscriptTurn;
  mode: RefinementMode;
  /** What the user agreed to send this note to, in the dialog. */
  consentedTo?: OnlineChoice | undefined;
  web: boolean;
  settings: PlanSettings;
  /**
   * The note was dictated or typed in Ephemeral. "Send without asking"
   * never covers it, even after the user left Ephemeral.
   */
  ephemeralNote?: boolean | undefined;
  keySaved: Readonly<ProviderKeyStatus>;
  dictionary: readonly DictionaryEntry[];
  snippets: readonly Snippet[];
  /** Reads the key from SecureStore. Called once, at send time. */
  readKey: (provider: OnlineProvider) => Promise<string | undefined>;
  /**
   * The note as it is now, or undefined when it was deleted or the data
   * was erased since the tap. Called after each wait.
   */
  current: () => TranscriptTurn | undefined;
  /** Called once the plan is to send, before the key is read. */
  onSend?: (editing: OnlineEditing) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * One online edit. Never throws, and the key never leaves this function
 * except in the request's headers.
 */
export async function runOnlineEdit(
  input: OnlineEditInput,
): Promise<OnlineEditOutcome> {
  const plan = planOnlineEdit({
    ...input,
    consentedNow: consentCovers(input.consentedTo, input.settings),
  });
  if (plan.kind === "ask") return { kind: "ask", editing: plan.editing };
  if (plan.kind !== "send" || !isOnlineMode(input.mode)) {
    return { kind: "local" };
  }
  const { editing } = plan;
  const { turn, mode } = input;
  input.onSend?.(editing);
  // On the phone first: the dictionary and the snippets are applied here,
  // so only the cleaned text is sent, never the dictionary itself.
  const text = refineLocally(turn.rawText, mode, {
    language: turn.language,
    dictionary: input.dictionary,
    snippets: input.snippets,
  });
  let key: string | undefined;
  try {
    key = await input.readKey(editing.provider);
  } catch {
    key = undefined;
  }
  // The note may have been deleted, or the data erased, while the key was
  // read: then it is not sent at all.
  if (!input.current()) return { kind: "stale" };
  if (!key) return { kind: "failed", notice: "onlineSetup" };
  const result = await refineOnline({
    choice: editing,
    key,
    mode,
    text,
    language: turn.language,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
  const current = input.current();
  if (!current) return { kind: "stale" };
  if (result.status === "failed") {
    return { kind: "failed", notice: onlineFailureNotice(result.reason) };
  }
  return {
    kind: "applied",
    turn: {
      ...current,
      mode,
      refinedText: result.text,
      syncState:
        current.syncState === "synced" || current.syncState === "queued"
          ? "queued"
          : current.syncState,
    },
  };
}
