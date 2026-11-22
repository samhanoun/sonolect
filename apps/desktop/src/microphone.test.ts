import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  MIC_DEVICE_KEY,
  listMicrophones,
  loadMicDeviceId,
  microphoneConstraints,
  meterPosition,
  micTestBlocked,
  microphoneName,
  openMicrophone,
  saveMicDeviceId,
} from "./microphone";

const device = (kind: MediaDeviceKind, deviceId: string, label = "") =>
  ({
    kind,
    deviceId,
    label,
    groupId: "g",
    toJSON: () => ({}),
  }) as MediaDeviceInfo;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

describe("microphone choice", () => {
  it("lists real microphones once, without the system aliases", async () => {
    const microphones = await listMicrophones({
      enumerateDevices: async () => [
        device("audioinput", "default", "Default - Headset"),
        device("audioinput", "communications", "Communications - Headset"),
        device("audioinput", "abc", " Headset (USB) "),
        device("audioinput", "abc", "Headset (USB)"),
        device("audiooutput", "out", "Speakers"),
        device("videoinput", "cam", "Camera"),
        device("audioinput", "def", ""),
        device("audioinput", "", ""),
      ],
    });
    assert.deepEqual(microphones, [
      { deviceId: "abc", label: "Headset (USB)" },
      { deviceId: "def", label: "" },
    ]);
  });

  it("lists nothing where the webview cannot enumerate devices", async () => {
    assert.deepEqual(await listMicrophones(undefined), []);
  });

  it("names a microphone the system does not name by its position", () => {
    const name = (position: number) => `Microphone ${position}`;
    assert.equal(
      microphoneName({ deviceId: "a", label: "USB mic" }, 0, name),
      "USB mic",
    );
    assert.equal(
      microphoneName({ deviceId: "b", label: "" }, 1, name),
      "Microphone 2",
    );
  });

  it("asks for the exact microphone, or any when none is chosen", () => {
    assert.deepEqual(microphoneConstraints(""), { audio: true });
    assert.deepEqual(microphoneConstraints("abc"), {
      audio: { deviceId: { exact: "abc" } },
    });
  });

  it("remembers the choice and forgets it for the system default", () => {
    const storage = memoryStorage();
    assert.equal(loadMicDeviceId(storage), "");
    saveMicDeviceId("abc", storage);
    assert.equal(storage.values.get(MIC_DEVICE_KEY), "abc");
    assert.equal(loadMicDeviceId(storage), "abc");
    saveMicDeviceId("", storage);
    assert.equal(storage.values.has(MIC_DEVICE_KEY), false);
    assert.equal(loadMicDeviceId(undefined), "");
  });

  it("opens the chosen microphone", async () => {
    const asked: MediaStreamConstraints[] = [];
    const stream = {} as MediaStream;
    const opened = await openMicrophone("abc", {
      getUserMedia: async (constraints) => {
        asked.push(constraints ?? {});
        return stream;
      },
    });
    assert.equal(opened.stream, stream);
    assert.equal(opened.fellBack, false);
    assert.deepEqual(asked, [{ audio: { deviceId: { exact: "abc" } } }]);
  });

  it("falls back to the system default when the microphone is unplugged", async () => {
    for (const name of ["OverconstrainedError", "NotFoundError"]) {
      const asked: MediaStreamConstraints[] = [];
      const stream = {} as MediaStream;
      const opened = await openMicrophone("gone", {
        getUserMedia: async (constraints) => {
          asked.push(constraints ?? {});
          if (asked.length === 1)
            throw Object.assign(new Error(name), { name });
          return stream;
        },
      });
      assert.equal(opened.fellBack, true);
      assert.equal(opened.stream, stream);
      assert.deepEqual(asked[1], { audio: true });
    }
  });

  it("does not hide a refused permission behind the fallback", async () => {
    let calls = 0;
    await assert.rejects(
      openMicrophone("abc", {
        getUserMedia: async () => {
          calls += 1;
          throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
        },
      }),
      /denied/,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      openMicrophone("", {
        getUserMedia: async () => {
          throw Object.assign(new Error("none"), { name: "NotFoundError" });
        },
      }),
      /none/,
    );
  });

  it("places loudness on a decibel meter", () => {
    assert.equal(meterPosition(0), 0);
    assert.equal(meterPosition(Number.NaN), 0);
    assert.equal(meterPosition(0.0005), 0);
    assert.equal(meterPosition(1), 1);
    assert.equal(meterPosition(4), 1);
    assert.ok(Math.abs(meterPosition(0.1) - 2 / 3) < 1e-9);
    assert.ok(Math.abs(meterPosition(0.01) - 1 / 3) < 1e-9);
  });

  it("keeps the test off during a dictation, and after a failed one in the app", () => {
    const states = [
      "idle",
      "requesting-permission",
      "recording",
      "uploading",
      "completed",
      "error",
    ] as const;
    const blocked = (native: boolean) =>
      states.filter((state) => micTestBlocked(state, native));
    assert.deepEqual(blocked(true), [
      "requesting-permission",
      "recording",
      "uploading",
      "error",
    ]);
    // The browser preview refuses before the microphone opens: after that
    // refusal, the test is still the way to check a microphone.
    assert.deepEqual(blocked(false), [
      "requesting-permission",
      "recording",
      "uploading",
    ]);
  });
});
