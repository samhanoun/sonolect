import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * The sync scanner (SyncScanner.tsx) and its button in the Sync section
 * need React Native and a camera, so these read their source. The code
 * gives full access to every synced note: it comes only from Sonolect's
 * own scanner or from the typed code, never from a link, and the camera
 * runs only while the scanner is on screen.
 */
const scanner = readFileSync(path.join(__dirname, "SyncScanner.tsx"), "utf8");
const section = readFileSync(path.join(__dirname, "SyncSection.tsx"), "utf8");
const app = path.join(__dirname, "..", "..");

/** The app's own source files: app/ and src/, without tests. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sources(file);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
  });
}

describe("the sync scanner", () => {
  it("reads QR codes only, with the back camera", () => {
    assert.match(
      scanner,
      /barcodeScannerSettings=\{\{ barcodeTypes: \["qr"\] \}\}/,
    );
    assert.match(scanner, /facing="back"/);
  });

  it("acts once on a Sonolect code, and keeps scanning past other codes", () => {
    assert.match(
      scanner,
      /if \(done\.current \|\| data === last\.current\) return;/,
    );
    assert.match(
      scanner,
      /const result = readScannedCode\(data\);\s*if \(result\.kind === "confirm"\) \{\s*done\.current = true;\s*onScanned\(result\.root\);\s*return;\s*\}/,
    );
    assert.match(scanner, /t\.sync\.scanNotSonolect/);
  });

  it("closes, releasing the camera, when Settings or the app is left", () => {
    assert.match(
      scanner,
      /useFocusEffect\(useCallback\(\(\) => \(\) => close\.current\(\), \[\]\)\);/,
    );
    assert.match(
      scanner,
      /AppState\.addEventListener\("change", \(state\) => \{\s*if \(state !== "active"\) close\.current\(\);/,
    );
    assert.match(scanner, /onRequestClose=\{onClose\}/);
    // The camera view lives only inside the scanner, mounted while scanning.
    assert.match(
      section,
      /\{view\.status === "off" && scanning \? \(\s*<SyncScanner/,
    );
    assert.match(section, /if \(!off\) setScanning\(false\);/);
  });

  it("asks for the camera first, and offers the typed code when refused", () => {
    assert.match(
      section,
      /const permission = await requestCameraPermission\(\);\s*if \(permission\.granted\) setScanning\(true\);\s*else setScanProblem\(permission\.canAskAgain \? "denied" : "blocked"\);/,
    );
    // Refused once: Scan code asks again. Refused for good: the settings.
    assert.match(
      section,
      /scanProblem === "denied"\s*\?\s*t\.sync\.cameraNeeded\s*:\s*t\.sync\.cameraDenied/,
    );
    assert.match(
      section,
      /scanProblem === "blocked" \? \(\s*<View style=\{styles\.row\}>\s*<Button\s*label=\{t\.capture\.actions\.openSettings\}/,
    );
    assert.match(section, /label=\{t\.sync\.join\}/);
  });

  it("asks before joining, as a typed code does", () => {
    assert.match(
      section,
      /const scanned = \(root: Uint8Array\) => \{\s*setScanning\(false\);\s*setJoinRoot\(root\);\s*\};/,
    );
    assert.match(
      section,
      /view\.status === "off" && joinRoot \? \(\s*<JoinConfirmation/,
    );
  });
});

describe("no link carries the key", () => {
  it("has no join route", () => {
    assert.equal(existsSync(path.join(app, "app", "sync")), false);
  });

  it("reads codes only in pairingInput.ts, used by the scanner and the code field", () => {
    const files = [
      ...sources(path.join(app, "app")),
      ...sources(path.join(app, "src")),
    ].map((file) => path.relative(app, file));
    const parsing = files.filter(
      (file) =>
        // A developer check against a running server, not part of the app.
        file !== path.join("src", "sync", "liveCheck.ts") &&
        /parsePairing/.test(readFileSync(path.join(app, file), "utf8")),
    );
    assert.deepEqual(parsing, [path.join("src", "sync", "pairingInput.ts")]);
    const readers = files.filter((file) =>
      /from "\.\.\/sync\/pairingInput"/.test(
        readFileSync(path.join(app, file), "utf8"),
      ),
    );
    assert.deepEqual(readers.sort(), [
      path.join("src", "ui", "SyncScanner.tsx"),
      path.join("src", "ui", "SyncSection.tsx"),
    ]);
  });
});
