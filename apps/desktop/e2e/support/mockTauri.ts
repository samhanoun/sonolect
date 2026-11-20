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

/**
 * Makes the page believe it runs inside the desktop app: native commands are
 * answered from an in-page library of saved recordings, and every recording
 * plays the one-second tone fixture.
 *
 * Live recordings are imitated too: audio sent with `capture_append` is
 * counted, and every three seconds of it produces one segment of live text
 * ("Part 1.", "Part 2." and so on) as a `capture-partial` event.
 */
export async function installMockTauri(page: Page, captures: MockCapture[]) {
  await page.addInitScript(
    ({ captures, toneWav }) => {
      window.localStorage.clear();
      const library = structuredClone(captures);
      const calls: { command: string; args: unknown }[] = [];
      const audio = () =>
        Uint8Array.from(atob(toneWav), (char) => char.charCodeAt(0)).buffer;
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
      Object.assign(window, {
        __sonolectE2eNativeCalls: calls,
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
              case "list_local_captures":
                return structuredClone(library);
              case "read_local_capture_audio":
                return audio();
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
    { captures, toneWav },
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
