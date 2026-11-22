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
  onlineTextProblem,
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

/**
 * The text an online edit sends: the note cleaned on the phone, with the
 * dictionary and the snippets applied, so the dictionary itself is never
 * sent.
 */
export function onlineText(
  turn: Pick<TranscriptTurn, "rawText" | "language">,
  mode: RefinementMode,
  dictionary: readonly DictionaryEntry[],
  snippets: readonly Snippet[],
): string {
  return refineLocally(turn.rawText, mode, {
    language: turn.language,
    dictionary,
    snippets,
  });
}

export type OnlineEditPlan =
  | OnlinePlan
  /**
   * The note cannot be sent at all: nothing is left to send, or it is too
   * long. Nobody is asked and nothing is sent; the notice says why.
   */
  | { kind: "unsendable"; notice: OnlineNoticeKind };

/**
 * planOnlineRefine, with the key status of the chosen provider. Given the
 * note's text (onlineText), a note that could never be sent is not asked
 * for.
 */
export function planOnlineEdit(input: {
  mode: RefinementMode;
  settings: PlanSettings;
  keySaved: Readonly<ProviderKeyStatus>;
  web: boolean;
  consentedNow: boolean;
  /** The note was made in Ephemeral: it is asked for like one. */
  ephemeralNote?: boolean | undefined;
  text?: string | undefined;
}): OnlineEditPlan {
  const editing = normalizeOnlineEditing(input.settings.onlineEditing);
  const plan = planOnlineRefine({
    mode: input.mode,
    settings: input.settings,
    hasKey: editing ? input.keySaved[editing.provider] : false,
    web: input.web,
    consentedNow: input.consentedNow,
    ephemeralNote: input.ephemeralNote === true,
  });
  if (
    (plan.kind === "ask" || plan.kind === "send") &&
    input.text !== undefined
  ) {
    const problem = onlineTextProblem(input.text);
    if (problem === "empty") {
      return { kind: "unsendable", notice: "onlineNothingToSend" };
    }
    if (problem === "tooLong") {
      return { kind: "unsendable", notice: "onlineTooLong" };
    }
  }
  return plan;
}

/** What the store keeps about the refinement in progress. */
export interface RefiningState {
  refining: boolean;
  refiningId: string | null;
  refiningMode: RefinementMode | null;
  sendingTo: OnlineProvider | null;
}

/**
 * The refinement a note's card shows as busy, or null. Only the note being
 * refined shows it: a note dictated or typed meanwhile keeps its chips.
 */
export function refiningFor(
  state: Readonly<RefiningState>,
  noteId: string,
): { mode: RefinementMode | null; sendingTo: OnlineProvider | null } | null {
  return state.refining && state.refiningId === noteId
    ? { mode: state.refiningMode, sendingTo: state.sendingTo }
    : null;
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
  const { turn, mode } = input;
  // On the phone first: the dictionary and the snippets are applied here,
  // so only the cleaned text is sent, never the dictionary itself. A note
  // with nothing to send, or too long, is not asked for.
  const text = onlineText(turn, mode, input.dictionary, input.snippets);
  const plan = planOnlineEdit({
    ...input,
    text,
    consentedNow: consentCovers(input.consentedTo, input.settings),
  });
  if (plan.kind === "unsendable") {
    return { kind: "failed", notice: plan.notice };
  }
  if (plan.kind === "ask") return { kind: "ask", editing: plan.editing };
  if (plan.kind !== "send" || !isOnlineMode(mode)) {
    return { kind: "local" };
  }
  const { editing } = plan;
  input.onSend?.(editing);
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
  // The answer can take a minute. If the note's text was edited here, or
  // came in from another device meanwhile, the answer is for the old text:
  // the newer text is kept, and the user can send it again.
  if (
    current.rawText !== turn.rawText ||
    current.refinedText !== turn.refinedText
  ) {
    return { kind: "failed", notice: "onlineNoteChanged" };
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
