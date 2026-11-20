import { strict as assert } from "node:assert";
import { after, before, beforeEach, describe, it } from "node:test";
import { startDictationBubbleBridge } from "./bubbleBridge";
import {
  BUBBLE_ACTION_EVENT,
  BUBBLE_STATE_EVENT,
  type BubbleAction,
  type BubbleState,
  type DictationSource,
} from "./dictationBubble";
import { useDesktopStore, type RecordingState } from "./store/appStore";

/**
 * The bridge runs in the main window and talks to Tauri. Here Tauri is a
 * recording stand-in: every command is noted, events can be delivered to the
 * main window, and the Esc shortcut can be "pressed".
 */
type Invocation = { cmd: string; args: Record<string, unknown> };
type ShortcutEvent = { shortcut: string; id: number; state: string };

const invocations: Invocation[] = [];
const callbacks = new Map<number, (value: unknown) => void>();
const listeners = new Map<string, number>();
/** Every handler ever registered for Escape, including released ones. */
const escapeHandlers: Array<(event: ShortcutEvent) => void> = [];
let escapeHeld = false;
let nextId = 1;

const tauri = {
  transformCallback(callback: (value: unknown) => void) {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  },
  unregisterCallback(id: number) {
    callbacks.delete(id);
  },
  async invoke(cmd: string, args: Record<string, unknown> = {}) {
    invocations.push({ cmd, args });
    if (cmd === "plugin:event|listen") {
      listeners.set(String(args.event), Number(args.handler));
      return Number(args.handler);
    }
    if (cmd === "plugin:global-shortcut|register") {
      const channel = args.handler as {
        onmessage: (event: ShortcutEvent) => void;
      };
      escapeHandlers.push(channel.onmessage);
      escapeHeld = true;
    }
    if (cmd === "plugin:global-shortcut|unregister") escapeHeld = false;
    return undefined;
  },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function waitFor(what: string, check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await tick();
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** Lets the bridge finish what it started: imports, then commands. */
async function settle() {
  for (let round = 0; round < 6; round += 1) await tick();
}

function bubbleSends(action: BubbleAction) {
  const id = listeners.get(BUBBLE_ACTION_EVENT);
  assert.ok(id !== undefined, "the bridge listens for bubble actions");
  callbacks.get(id)?.({ event: BUBBLE_ACTION_EVENT, id, payload: action });
}

function pressEscape(handler = escapeHandlers.at(-1)) {
  handler?.({ shortcut: "Escape", id: 1, state: "Pressed" });
}

function lastBubbleState(): BubbleState {
  const sent = invocations.filter(
    ({ cmd, args }) =>
      cmd === "plugin:event|emit_to" && args.event === BUBBLE_STATE_EVENT,
  );
  const last = sent.at(-1);
  assert.ok(last, "the bridge sent a state to the bubble");
  return last.args.payload as BubbleState;
}

const registrations = () =>
  invocations.filter(({ cmd }) => cmd === "plugin:global-shortcut|register")
    .length;

/** What the store was asked to do, instead of a real microphone. */
const asked = { cancel: 0, stop: 0 };
const original = {
  cancelVoiceCapture: useDesktopStore.getState().cancelVoiceCapture,
  stopVoiceCapture: useDesktopStore.getState().stopVoiceCapture,
};

function capture(source: DictationSource, recordingState: RecordingState) {
  useDesktopStore.setState({
    dictationSource: source,
    dictationOutcome: undefined,
    voiceError: undefined,
    recordingState,
  });
}

describe("bubble bridge: cancelling", () => {
  let stop: () => void = () => undefined;

  before(async () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    globals.window = globalThis;
    globals.__TAURI_INTERNALS__ = tauri;
    globals.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => undefined,
    };
    useDesktopStore.setState({
      cancelVoiceCapture: () => {
        asked.cancel += 1;
      },
      stopVoiceCapture: () => {
        asked.stop += 1;
      },
    });
    stop = startDictationBubbleBridge();
    await waitFor("the bridge to listen for bubble actions", () =>
      listeners.has(BUBBLE_ACTION_EVENT),
    );
    await settle();
  });

  after(async () => {
    stop();
    useDesktopStore.setState(original);
    await settle();
  });

  beforeEach(async () => {
    capture("app", "idle");
    await settle();
    invocations.length = 0;
    asked.cancel = 0;
    asked.stop = 0;
  });

  it("leaves Esc alone during a recording made in the Studio", async () => {
    capture("app", "requesting-permission");
    capture("app", "recording");
    await settle();
    assert.equal(lastBubbleState().phase, "listening");
    assert.equal(lastBubbleState().dictation, false);
    assert.equal(registrations(), 0);
    assert.equal(escapeHeld, false);

    capture("app", "uploading");
    await settle();
    assert.equal(lastBubbleState().phase, "transcribing");
    assert.equal(registrations(), 0);
    assert.equal(escapeHeld, false);
  });

  it("never discards a Studio recording from the bubble", async () => {
    capture("app", "recording");
    await settle();
    bubbleSends("cancel");
    assert.equal(asked.cancel, 0);

    capture("app", "uploading");
    await settle();
    bubbleSends("cancel");
    assert.equal(asked.cancel, 0);
  });

  it("still stops a Studio recording from the bubble", async () => {
    capture("app", "recording");
    await settle();
    bubbleSends("finish");
    assert.equal(asked.stop, 1);
    assert.equal(asked.cancel, 0);
  });

  it("takes Esc for a dictation, and Esc cancels it", async () => {
    for (const source of ["bubble", "hotkey"] as const) {
      capture(source, "recording");
      await waitFor(
        `Esc to be registered for a ${source} dictation`,
        () => escapeHeld,
      );
      assert.equal(lastBubbleState().dictation, true);
      const before = asked.cancel;
      pressEscape();
      assert.equal(asked.cancel, before + 1, source);

      capture(source, "uploading");
      await settle();
      assert.equal(escapeHeld, true, "kept while transcribing");
      pressEscape();
      assert.equal(asked.cancel, before + 2, source);

      capture(source, "idle");
      await waitFor("Esc to be released", () => !escapeHeld);
    }
  });

  it("cancels a dictation from the bubble's ✕", async () => {
    capture("bubble", "recording");
    await settle();
    bubbleSends("cancel");
    assert.equal(asked.cancel, 1);
  });

  it("gives Esc back as soon as the dictation is over", async () => {
    capture("hotkey", "recording");
    await waitFor("Esc to be registered", () => escapeHeld);
    useDesktopStore.setState({
      recordingState: "completed",
      dictationOutcome: { kind: "inserted", text: "Hello" },
    });
    await waitFor("Esc to be released", () => !escapeHeld);
    assert.equal(lastBubbleState().phase, "inserted");
  });

  it("ignores a late Esc once a Studio recording has taken over", async () => {
    capture("bubble", "recording");
    await waitFor("Esc to be registered", () => escapeHeld);
    const stale = escapeHandlers.at(-1);

    capture("bubble", "idle");
    capture("app", "recording");
    // The key press that was already on its way when Esc was released.
    pressEscape(stale);
    assert.equal(asked.cancel, 0);
    await waitFor("Esc to be released", () => !escapeHeld);
  });
});
