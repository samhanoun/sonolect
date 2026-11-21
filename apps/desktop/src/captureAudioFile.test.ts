import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  captureAudioFilename,
  downloadFile,
  readCaptureAudioFile,
} from "./captureAudioFile";
import type { NativeCall } from "./privacyControls";

const bytes = (text: string) =>
  Uint8Array.from(text, (char) => char.charCodeAt(0)).buffer;
const OGG = bytes("OggS\0\x02\0\0\0\0\0\0\0\0");
const WAV = bytes("RIFF\x24\0\0\0WAVEfmt ");
// 21 November 2026, 14:05 local time.
const MADE = new Date(2026, 10, 21, 14, 5, 59).getTime();

function device(audio: ArrayBuffer) {
  const calls: {
    command: string;
    args: Record<string, unknown> | undefined;
  }[] = [];
  const call = (async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    return audio;
  }) as NativeCall;
  return { call, calls };
}

describe("saving a recording's audio", () => {
  it("names the file after when it was made and what it is kept as", () => {
    assert.equal(
      captureAudioFilename(MADE, "audio/ogg"),
      "sonolect-recording-2026-11-21-1405.opus",
    );
    assert.equal(
      captureAudioFilename(MADE, "audio/wav"),
      "sonolect-recording-2026-11-21-1405.wav",
    );
  });

  it("reads the file the recording is kept as, not a playback copy", async () => {
    const { call, calls } = device(OGG);
    const file = await readCaptureAudioFile(call, {
      id: "capture-1",
      createdAtMs: MADE,
    });
    assert.deepEqual(calls, [
      {
        command: "read_local_capture_audio",
        args: { id: "capture-1", format: "file" },
      },
    ]);
    assert.equal(file.blob.type, "audio/ogg");
    assert.equal(file.blob.size, OGG.byteLength);
    assert.deepEqual(
      new Uint8Array(await file.blob.arrayBuffer()),
      new Uint8Array(OGG),
    );
    assert.equal(file.filename, "sonolect-recording-2026-11-21-1405.opus");
  });

  it("saves a recording still kept as WAV as a WAV", async () => {
    const { call } = device(WAV);
    const file = await readCaptureAudioFile(call, {
      id: "capture-2",
      createdAtMs: MADE,
    });
    assert.equal(file.blob.type, "audio/wav");
    assert.equal(file.filename, "sonolect-recording-2026-11-21-1405.wav");
  });

  it("hands the file to a download link and lets the URL go after", async () => {
    const clicked: { href: string; download: string }[] = [];
    const revoked: string[] = [];
    const link = {
      href: "",
      download: "",
      click() {
        clicked.push({ href: this.href, download: this.download });
      },
    };
    const page = {
      createElement: (tag: string) => {
        assert.equal(tag, "a");
        return link;
      },
    } as unknown as Pick<Document, "createElement">;
    const blob = new Blob([OGG], { type: "audio/ogg" });
    let made: Blob | undefined;
    downloadFile({ blob, filename: "sonolect-recording.opus" }, page, {
      createObjectURL: (object: Blob | MediaSource) => {
        made = object as Blob;
        return "blob:recording";
      },
      revokeObjectURL: (url: string) => void revoked.push(url),
    });
    assert.equal(made, blob);
    assert.deepEqual(clicked, [
      { href: "blob:recording", download: "sonolect-recording.opus" },
    ]);
    assert.deepEqual(revoked, []);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.deepEqual(revoked, ["blob:recording"]);
  });
});
