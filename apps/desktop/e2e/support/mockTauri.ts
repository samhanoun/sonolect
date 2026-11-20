import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

export type MockCapture = {
  id: string;
  createdAtMs: number;
  durationMs: number;
  transcript: string | null;
  error: string | null;
  language: string | null;
  segments?: {
    startMs: number;
    endMs: number;
    text: string;
    speaker?: string;
  }[];
};

export type MockTauriCall = { command: string; args: unknown };

const toneWav = readFileSync(
  new URL("../fixtures/tone.wav", import.meta.url),
).toString("base64");
/** The same tone as the app compresses it. */
const toneOpus = readFileSync(
  new URL("../fixtures/tone.opus", import.meta.url),
).toString("base64");

/**
 * Makes the page believe it runs inside the desktop app: native commands are
 * answered from an in-page library of saved recordings, and every recording
 * plays the one-second tone fixture. A compressed recording sends it as Ogg
 * Opus when the page asks for Ogg, as the app does, and as WAV otherwise.
 *
 * Live recordings are imitated too: audio sent with `capture_append` is
 * counted, and every three seconds of it produces one segment of live text
 * ("Part 1.", "Part 2." and so on) as a `capture-partial` event.
 *
 * With `recorderLimitMs`, the recorder is full after that much audio and
 * refuses more, as the real one does after four hours.
 *
 * `compress_local_captures` compresses each saved recording once and reports
 * what that freed; `compressed` lists recordings that already are. With
 * `unplayableOpus`, the Ogg Opus audio sent is damaged, so the page cannot
 * play it, as in a webview without Opus. With `holdWavReads`, audio asked for
 * as WAV is only sent once `releaseHeldReads` is called, as a long compressed
 * recording takes a while to decode. Pasting into another app always
 * succeeds.
 *
 * With `systemAudio`, the computer's sound can be recorded: once started it
 * adds a second of audio to the live recording every 100 ms, with a level.
 */
export async function installMockTauri(
  page: Page,
  captures: MockCapture[],
  options: {
    /** false: the recorder cannot start, as when no speech model is installed. */
    recorder?: boolean;
    /** The recorder takes this much audio, then refuses more. */
    recorderLimitMs?: number;
    /** true: this computer's sound can be recorded. */
    systemAudio?: boolean;
    /** Recordings already kept as Opus. */
    compressed?: string[];
    /** true: the Ogg Opus audio sent cannot be played. */
    unplayableOpus?: boolean;
    /** true: audio asked for as WAV waits for `releaseHeldReads`. */
    holdWavReads?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({
      captures,
      toneWav,
      toneOpus,
      recorder,
      recorderLimitMs,
      systemAudio,
      compressedIds,
      unplayableOpus,
      holdWavReads,
    }) => {
      window.localStorage.clear();
      const library = structuredClone(captures);
      /** Recordings already turned into Opus. */
      const compressed = new Set<string>(compressedIds);
      const calls: { command: string; args: unknown }[] = [];
      /** WAV reads waiting to be answered, with `holdWavReads`. */
      const heldReads: (() => void)[] = [];
      const bytes = (base64: string) =>
        Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;
      const audio = (id: unknown, format: unknown) => {
        format ??= "wav";
        if (format !== "wav" && format !== "ogg") throw "Invalid audio format.";
        if (format === "wav" || !compressed.has(id as string))
          return bytes(toneWav);
        // Ogg's signature and nothing a decoder can use.
        if (unplayableOpus)
          return new TextEncoder().encode("OggS" + "\0".repeat(60)).buffer;
        return bytes(toneOpus);
      };
      // Event plumbing, as @tauri-apps/api/event expects it.
      const callbacks = new Map<number, (message: unknown) => void>();
      const listeners = new Map<number, { event: string; handler: number }>();
      let nextId = 1;
      const emit = (event: string, payload: unknown) => {
        for (const [id, listener] of listeners)
          if (listener.event === event)
            callbacks.get(listener.handler)?.({ event, id, payload });
      };
      type Segment = { startMs: number; endMs: number; text: string };
      let live: { id: string; bytes: number; segments: Segment[] } | undefined;
      const BYTES_PER_PART = 3 * 32000;
      const hear = (final: boolean) => {
        if (!live) return;
        const heard: Segment[] = [];
        const whole = Math.floor(live.bytes / BYTES_PER_PART);
        const parts =
          final && live.bytes > whole * BYTES_PER_PART ? whole + 1 : whole;
        for (let part = live.segments.length; part < parts; part++)
          heard.push({
            startMs: part * 3000,
            endMs: Math.min((part + 1) * 3000, Math.round(live.bytes / 32)),
            text: `Part ${part + 1}.`,
          });
        if (!heard.length) return;
        live.segments.push(...heard);
        emit("capture-partial", { captureId: live.id, segments: heard });
      };
      let systemFeed: ReturnType<typeof setInterval> | undefined;
      Object.assign(window, {
        __sonolectE2eNativeCalls: calls,
        __sonolectE2eReleaseReads: () => {
          for (const answer of heldReads.splice(0)) answer();
        },
        __sonolectE2eEmit: emit,
        __sonolectE2eListening: (event: string) =>
          [...listeners.values()].some((listener) => listener.event === event),
        __TAURI_INTERNALS__: {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { label: "main", windowLabel: "main" },
          },
          transformCallback: (callback: (message: unknown) => void) => {
            const id = nextId++;
            callbacks.set(id, callback);
            return id;
          },
          unregisterCallback: (id: number) => callbacks.delete(id),
          convertFileSrc: (path: string) => path,
          invoke: async (
            command: string,
            args: Record<string, unknown>,
            options?: { headers?: Record<string, string> },
          ) => {
            if (command === "capture_append") {
              const pcm = args as unknown as Uint8Array;
              const capture = options?.headers?.["x-sonolect-capture"];
              calls.push({ command, args: { capture, bytes: pcm.length } });
              if (!live || live.id !== capture)
                throw "This recording is no longer in progress.";
              if (recorderLimitMs && live.bytes >= recorderLimitMs * 32)
                throw "The recording reached the four-hour limit.";
              live.bytes += pcm.length;
              hear(false);
              return Math.round(live.bytes / 32);
            }
            calls.push({ command, args });
            switch (command) {
              case "plugin:event|listen": {
                const id = nextId++;
                listeners.set(id, {
                  event: args.event as string,
                  handler: args.handler as number,
                });
                return id;
              }
              case "plugin:event|unlisten":
                listeners.delete(args.eventId as number);
                return null;
              case "capture_begin":
                if (!recorder)
                  throw "Install the local speech model in Settings first.";
                live = {
                  id: `1700000000001-${nextId++}`,
                  bytes: 0,
                  segments: [],
                };
                return live.id;
              case "capture_finish": {
                if (!live || live.id !== args.id)
                  throw "This recording is no longer in progress.";
                hear(true);
                const finished = live;
                live = undefined;
                if (!finished.bytes) throw "No audio was recorded.";
                const text = finished.segments
                  .map((segment) => segment.text)
                  .join(" ");
                library.unshift({
                  id: finished.id,
                  createdAtMs: Date.now(),
                  durationMs: Math.round(finished.bytes / 32),
                  transcript: text,
                  error: null,
                  language: "en",
                  segments: finished.segments,
                });
                return {
                  text,
                  segments: finished.segments,
                  language: "en",
                  captureId: finished.id,
                };
              }
              case "capture_cancel":
                live = undefined;
                return null;
              case "check_system_audio_available":
                return systemAudio;
              case "start_system_audio_capture":
                if (!systemAudio)
                  throw "There is no playback device to record.";
                if (!live || live.id !== args.id)
                  throw "This recording is no longer in progress.";
                clearInterval(systemFeed);
                systemFeed = setInterval(() => {
                  if (!live) return;
                  live.bytes += 32000;
                  hear(false);
                  emit("system-audio-level", 0.6);
                }, 100);
                return null;
              case "stop_system_audio_capture":
                clearInterval(systemFeed);
                systemFeed = undefined;
                return null;
              case "insert_text_into_active_app":
                return {
                  ok: true,
                  method: "native-insert",
                  status: "Inserted dictation into the active app.",
                };
              case "list_local_captures":
                return structuredClone(library);
              case "read_local_capture_audio": {
                const sent = audio(args.id, args.format);
                if (!holdWavReads || (args.format ?? "wav") !== "wav")
                  return sent;
                return new Promise((resolve) =>
                  heldReads.push(() => resolve(sent)),
                );
              }
              case "update_local_capture": {
                const capture = library.find((item) => item.id === args.id);
                if (!capture)
                  throw "This recording is no longer in your library.";
                capture.transcript = args.transcript as string;
                capture.segments = args.segments as typeof capture.segments;
                return null;
              }
              case "purge_local_captures":
                return 0;
              case "compress_local_captures": {
                // A WAV is 32 bytes a millisecond; Opus is about a tenth.
                const fresh = library.filter(
                  (item) => !compressed.has(item.id),
                );
                fresh.forEach((item) => compressed.add(item.id));
                return {
                  recordings: fresh.length,
                  bytesFreed: fresh.reduce(
                    (total, item) => total + item.durationMs * 29,
                    0,
                  ),
                  failed: 0,
                };
              }
              case "provider_key_status":
                return false;
              case "local_model_status":
                return { ready: true, path: "ggml-base.bin" };
              default:
                return null;
            }
          },
        },
        __TAURI_EVENT_PLUGIN_INTERNALS__: {
          unregisterListener: (_event: string, id: number) =>
            listeners.delete(id),
        },
      });
    },
    {
      captures,
      toneWav,
      toneOpus,
      recorder: options.recorder ?? true,
      recorderLimitMs: options.recorderLimitMs,
      systemAudio: options.systemAudio ?? false,
      compressedIds: options.compressed ?? [],
      unplayableOpus: options.unplayableOpus ?? false,
      holdWavReads: options.holdWavReads ?? false,
    },
  );
}

/** Sends the audio of every WAV read held back with `holdWavReads`. */
export function releaseHeldReads(page: Page) {
  return page.evaluate(() =>
    (
      window as typeof window & { __sonolectE2eReleaseReads: () => void }
    ).__sonolectE2eReleaseReads(),
  );
}

export function nativeCalls(page: Page, command: string) {
  return page.evaluate(
    (command) =>
      (
        window as typeof window & {
          __sonolectE2eNativeCalls: MockTauriCall[];
        }
      ).__sonolectE2eNativeCalls.filter((call) => call.command === command),
    command,
  );
}

/**
 * Delivers an event to the page as if the native side had emitted it, once
 * the page listens for it (listeners are registered after the first render).
 */
export async function emitNativeEvent(
  page: Page,
  event: string,
  payload: unknown,
) {
  type Hooks = {
    __sonolectE2eEmit: (event: string, payload: unknown) => void;
    __sonolectE2eListening: (event: string) => boolean;
  };
  await page.waitForFunction(
    (event) => (window as typeof window & Hooks).__sonolectE2eListening(event),
    event,
  );
  await page.evaluate(
    ({ event, payload }) =>
      (window as typeof window & Hooks).__sonolectE2eEmit(event, payload),
    { event, payload },
  );
}
