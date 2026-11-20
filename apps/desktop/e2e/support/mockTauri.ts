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
 */
export async function installMockTauri(page: Page, captures: MockCapture[]) {
  await page.addInitScript(
    ({ captures, toneWav }) => {
      window.localStorage.clear();
      const library = structuredClone(captures);
      const calls: { command: string; args: unknown }[] = [];
      const audio = () =>
        Uint8Array.from(atob(toneWav), (char) => char.charCodeAt(0)).buffer;
      Object.assign(window, {
        __sonolectE2eNativeCalls: calls,
        __TAURI_INTERNALS__: {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { label: "main", windowLabel: "main" },
          },
          transformCallback: () => Math.floor(Math.random() * 1e9),
          unregisterCallback: () => {},
          convertFileSrc: (path: string) => path,
          invoke: async (command: string, args: Record<string, unknown>) => {
            calls.push({ command, args });
            switch (command) {
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
