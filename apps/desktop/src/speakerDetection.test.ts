import { strict as assert } from "node:assert";
import { after, before, beforeEach, describe, it } from "node:test";
import { setLocale } from "./i18n";
import type { SavedCaptureSegment, SpeakerTurn } from "./segmentEditor";
import { useSpeakerDetection } from "./speakerDetection";
import { useDesktopStore } from "./store/appStore";

/**
 * The desktop app's side, as a stand-in: the speaker model can be missing,
 * detection reports progress and can be held, as a long recording would
 * hold it, until it finishes or is cancelled.
 */
type Invocation = { cmd: string; args: Record<string, unknown> };
const invocations: Invocation[] = [];
const callbacks = new Map<number, (message: unknown) => void>();
const listeners = new Map<number, { event: string; handler: number }>();
let nextId = 1;

const native = {
  modelReady: true,
  turns: [] as SpeakerTurn[],
  /** Set to hold detection until `release` is called. */
  hold: undefined as
    { promise: Promise<void>; release: () => void } | undefined,
  cancelled: false,
  /** What the next detection fails with, if anything. */
  failure: undefined as string | undefined,
};

function holdDetection() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => (release = resolve));
  native.hold = { promise, release };
}

function emit(event: string, payload: unknown) {
  for (const [id, listener] of listeners)
    if (listener.event === event)
      callbacks.get(listener.handler)?.({ event, id, payload });
}

const tauri = {
  transformCallback(callback: (message: unknown) => void) {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  },
  unregisterCallback(id: number) {
    callbacks.delete(id);
  },
  async invoke(cmd: string, args: Record<string, unknown> = {}) {
    invocations.push({ cmd, args });
    switch (cmd) {
      case "plugin:event|listen": {
        const id = nextId++;
        listeners.set(id, {
          event: String(args.event),
          handler: Number(args.handler),
        });
        return id;
      }
      case "plugin:event|unlisten":
        listeners.delete(Number(args.eventId));
        return null;
      case "speaker_model_status":
        return { ready: native.modelReady, sizeBytes: 28_281_165 };
      case "download_speaker_model":
        emit("speaker-model-progress", 50);
        emit("speaker-model-progress", 100);
        native.modelReady = true;
        return { ready: true, sizeBytes: 28_281_165 };
      case "detect_speakers": {
        native.cancelled = false;
        emit("speaker-progress", 0);
        emit("speaker-progress", 40);
        await native.hold?.promise;
        if (native.cancelled) throw "Speaker detection was cancelled.";
        if (native.failure) throw native.failure;
        emit("speaker-progress", 100);
        return native.turns;
      }
      case "cancel_speaker_detection":
        native.cancelled = true;
        native.hold?.release();
        return null;
      default:
        return null;
    }
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

const store = () => useDesktopStore.getState();
const flow = () => useSpeakerDetection.getState();
const speakers = () =>
  store().transcriptSegments.map((segment) => segment.speaker);
const called = (cmd: string) =>
  invocations.filter((invocation) => invocation.cmd === cmd);

/** Four sentences of a two-person conversation, saved in the library. */
function open(names: (string | undefined)[] = [], id = "40-1") {
  const texts = ["Hello there.", "How are you?", "Fine, thanks.", "Good."];
  const segments: SavedCaptureSegment[] = texts.map((text, index) => ({
    startMs: index * 2000,
    endMs: index * 2000 + 2000,
    text,
    speaker: names[index] ?? null,
  }));
  store().openCapture({ id, durationMs: 8000, transcript: null, segments });
}

/** Speaker 1 says the first two sentences, speaker 2 the others. */
const twoVoices: SpeakerTurn[] = [
  { startMs: 0, endMs: 3900, speaker: 1 },
  { startMs: 4100, endMs: 8000, speaker: 2 },
];

describe("speaker detection", () => {
  before(() => {
    const globals = globalThis as unknown as Record<string, unknown>;
    globals.window = globalThis;
    globals.__TAURI_INTERNALS__ = tauri;
    globals.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => undefined,
    };
  });

  after(() => setLocale("en"));

  beforeEach(() => {
    invocations.length = 0;
    Object.assign(native, {
      modelReady: true,
      turns: twoVoices,
      hold: undefined,
      cancelled: false,
      failure: undefined,
    });
    useSpeakerDetection.setState({
      current: { step: "idle" },
      outcome: undefined,
      speakers: undefined,
    });
    open();
  });

  it("labels the transcript in one undo step", async () => {
    const result = await store().detectSpeakers({ speakers: 2 });
    assert.deepEqual(result, { status: "labelled", speakers: 2 });
    assert.deepEqual(called("detect_speakers")[0]?.args, {
      id: "40-1",
      speakers: 2,
    });
    assert.deepEqual(speakers(), [
      "Speaker 1",
      "Speaker 1",
      "Speaker 2",
      "Speaker 2",
    ]);
    // The text itself is untouched.
    assert.equal(
      store().transcript,
      "Hello there.\n\nHow are you?\n\nFine, thanks.\n\nGood.",
    );
    store().undoTranscriptEdit();
    assert.deepEqual(speakers(), [undefined, undefined, undefined, undefined]);
    store().redoTranscriptEdit();
    assert.equal(speakers()[2], "Speaker 2");
  });

  it("renames a speaker everywhere in one undo step", async () => {
    await store().detectSpeakers();
    assert.equal(called("detect_speakers")[0]?.args.speakers, null);
    store().renameSpeakerEverywhere("Speaker 2", "Ben");
    assert.deepEqual(speakers(), ["Speaker 1", "Speaker 1", "Ben", "Ben"]);
    store().undoTranscriptEdit();
    assert.deepEqual(speakers(), [
      "Speaker 1",
      "Speaker 1",
      "Speaker 2",
      "Speaker 2",
    ]);
  });

  it("changes nothing when another recording was opened meanwhile", async () => {
    holdDetection();
    const running = store().detectSpeakers();
    await waitFor(
      "detection to start",
      () => called("detect_speakers").length > 0,
    );
    open([], "41-1");
    native.hold?.release();
    assert.deepEqual(await running, { status: "stale" });
    assert.deepEqual(speakers(), [undefined, undefined, undefined, undefined]);
    assert.equal(store().transcriptSegments[0]?.captureId, "41-1");
  });

  it("asks before the first download, then detects with progress", async () => {
    native.modelReady = false;
    const steps: string[] = [];
    const stop = useSpeakerDetection.subscribe(({ current }) => {
      const step =
        "progress" in current
          ? `${current.step} ${current.progress}`
          : current.step;
      if (steps.at(-1) !== step) steps.push(step);
    });
    await flow().start();
    assert.deepEqual(flow().current, {
      step: "consent",
      sizeBytes: 28_281_165,
    });
    assert.equal(called("download_speaker_model").length, 0);
    await flow().download();
    stop();
    assert.deepEqual(steps, [
      "checking",
      "consent",
      "downloading 0",
      "downloading 50",
      "downloading 100",
      "detecting 0",
      "detecting 40",
      "detecting 100",
      "idle",
    ]);
    assert.equal(called("download_speaker_model").length, 1);
    assert.deepEqual(flow().outcome, {
      captureId: "40-1",
      message: "2 speakers found.",
    });
    assert.equal(speakers()[3], "Speaker 2");
  });

  it("does not download when the answer is not now", async () => {
    native.modelReady = false;
    await flow().start();
    await flow().cancel();
    assert.deepEqual(flow().current, { step: "idle" });
    assert.equal(called("download_speaker_model").length, 0);
    assert.equal(called("detect_speakers").length, 0);
  });

  it("keeps typed names unless asked to replace them", async () => {
    open([undefined, undefined, undefined, "Ana"]);
    useSpeakerDetection.setState({ speakers: 2 });
    await flow().start();
    assert.deepEqual(flow().current, { step: "choose" });
    assert.equal(called("detect_speakers").length, 0);
    await flow().choose(false);
    assert.equal(called("detect_speakers")[0]?.args.speakers, 2);
    // Ana's speaker is called Ana everywhere.
    assert.deepEqual(speakers(), ["Speaker 1", "Speaker 1", "Ana", "Ana"]);

    open([undefined, undefined, undefined, "Ana"]);
    await flow().start();
    await flow().choose(true);
    assert.deepEqual(speakers(), [
      "Speaker 1",
      "Speaker 1",
      "Speaker 2",
      "Speaker 2",
    ]);
  });

  it("does not ask again about labels it gave itself", async () => {
    await flow().start();
    assert.equal(speakers()[0], "Speaker 1");
    native.turns = [{ startMs: 0, endMs: 8000, speaker: 1 }];
    await flow().start();
    assert.deepEqual(flow().current, { step: "idle" });
    assert.deepEqual(speakers(), [
      "Speaker 1",
      "Speaker 1",
      "Speaker 1",
      "Speaker 1",
    ]);
    assert.equal(flow().outcome?.message, "1 speaker found.");
  });

  it("cancels a detection that is running", async () => {
    holdDetection();
    const running = flow().start();
    await waitFor(
      "detection to start",
      () => flow().current.step === "detecting",
    );
    await flow().cancel();
    await running;
    assert.equal(called("cancel_speaker_detection").length, 1);
    assert.deepEqual(flow().current, { step: "idle" });
    assert.equal(flow().outcome?.message, "Speaker detection was cancelled.");
    assert.deepEqual(speakers(), [undefined, undefined, undefined, undefined]);
  });

  it("reports in the interface language", async () => {
    setLocale("fr");
    try {
      holdDetection();
      const running = flow().start();
      await waitFor(
        "detection to start",
        () => flow().current.step === "detecting",
      );
      await flow().cancel();
      await running;
      assert.equal(
        flow().outcome?.message,
        "La détection des intervenants a été annulée.",
      );
      native.hold = undefined;
      await flow().start();
      assert.equal(flow().outcome?.message, "2 intervenants trouvés.");
      assert.equal(speakers()[0], "Intervenant 1");
    } finally {
      setLocale("en");
    }
  });

  it("offers the download again when the model was damaged", async () => {
    native.failure =
      "The speaker model was damaged and has been removed. Download it again.";
    // The app removes a damaged model, so it is missing afterwards.
    const invoke = tauri.invoke;
    tauri.invoke = async (cmd, args) => {
      if (cmd === "detect_speakers") native.modelReady = false;
      return invoke(cmd, args);
    };
    try {
      await flow().start();
    } finally {
      tauri.invoke = invoke;
    }
    assert.deepEqual(flow().current, {
      step: "consent",
      sizeBytes: 28_281_165,
    });
    assert.equal(flow().outcome?.message, native.failure);
  });

  it("says so when there is no speech, and changes nothing", async () => {
    native.turns = [];
    const segments = store().transcriptSegments;
    await flow().start();
    assert.equal(
      flow().outcome?.message,
      "No speech was found in this recording.",
    );
    assert.equal(store().transcriptSegments, segments);
  });
});
