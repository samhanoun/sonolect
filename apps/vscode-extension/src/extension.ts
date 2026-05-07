/**
 * Sonolect Voice — VS Code extension entry point.
 *
 * This is a minimal scaffold that delegates all voice-to-code logic
 * to the @sonolect/sdk `ideClient` module. The extension handles
 * only VS Code lifecycle, UI, and editor integration.
 */
import type * as vscode from "vscode";
import type {
  IdeContext,
  IdeDictationResult,
} from "@sonolect/sdk/src/ideClient";
import {
  detectCodeLanguage,
  buildCodeContext,
  formatForCode,
  suggestInsertMode,
  buildCodePrompt,
} from "@sonolect/sdk/src/ideClient";

/* ── State ────────────────────────────────────────────────────────── */

let statusBarItem: vscode.StatusBarItem | undefined;
let isRecording = false;

/* ── Activation ───────────────────────────────────────────────────── */

export function activate(context: vscode.ExtensionContext): void {
  const vscodeApi = require("vscode") as typeof vscode;

  // Create status bar item
  statusBarItem = vscodeApi.window.createStatusBarItem(
    vscodeApi.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.command = "sonolect.toggleDictation";
  updateStatusBar();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register commands
  context.subscriptions.push(
    vscodeApi.commands.registerCommand("sonolect.startDictation", () =>
      startDictation(vscodeApi),
    ),
  );

  context.subscriptions.push(
    vscodeApi.commands.registerCommand("sonolect.stopDictation", () =>
      stopDictation(vscodeApi),
    ),
  );

  context.subscriptions.push(
    vscodeApi.commands.registerCommand("sonolect.toggleDictation", () => {
      if (isRecording) {
        stopDictation(vscodeApi);
      } else {
        startDictation(vscodeApi);
      }
    }),
  );
}

export function deactivate(): void {
  statusBarItem?.dispose();
  statusBarItem = undefined;
  isRecording = false;
}

/* ── Status bar ───────────────────────────────────────────────────── */

function updateStatusBar(): void {
  if (!statusBarItem) return;

  if (isRecording) {
    statusBarItem.text = "$(mic-filled) Recording...";
    statusBarItem.tooltip = "Sonolect: Click to stop dictation";
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = "$(mic) Sonolect";
    statusBarItem.tooltip = "Sonolect: Click to start dictation";
    statusBarItem.backgroundColor = undefined;
  }
}

/* ── Dictation lifecycle ──────────────────────────────────────────── */

function getEditorContext(vscodeApi: typeof vscode): IdeContext | undefined {
  const editor = vscodeApi.window.activeTextEditor;
  if (!editor) return undefined;

  const document = editor.document;
  const selection = editor.selection;
  const position = selection.active;

  const fileName = document.fileName;
  const language = detectCodeLanguage(fileName);
  const selectedText = editor.document.getText(selection) || undefined;

  // Grab a few surrounding lines for context
  const startLine = Math.max(0, position.line - 5);
  const endLine = Math.min(document.lineCount - 1, position.line + 5);
  const surroundingRange = new vscodeApi.Range(startLine, 0, endLine, 999);
  const surroundingText = document.getText(surroundingRange);

  return buildCodeContext(fileName, language, selectedText, surroundingText);
}

function startDictation(vscodeApi: typeof vscode): void {
  if (isRecording) {
    vscodeApi.window.showInformationMessage(
      "Sonolect: Already recording. Use Ctrl+Shift+M to toggle.",
    );
    return;
  }

  const context = getEditorContext(vscodeApi);
  if (!context) {
    vscodeApi.window.showWarningMessage(
      "Sonolect: Open a file in the editor first.",
    );
    return;
  }

  isRecording = true;
  updateStatusBar();

  // Build a Whisper prompt from the code context
  const _prompt = buildCodePrompt(context);

  // TODO: Connect to Sonolect recording service via SDK.
  // For now this is a scaffold — the actual recording pipeline
  // (microphone → Whisper → text) will be wired in a future PR.
  vscodeApi.window.showInformationMessage(
    `Sonolect: Dictation started (${context.language})`,
  );
}

function stopDictation(vscodeApi: typeof vscode): void {
  if (!isRecording) return;

  isRecording = false;
  updateStatusBar();

  // TODO: Stop the active recording session and get the result.
  vscodeApi.window.showInformationMessage("Sonolect: Dictation stopped.");
}

/**
 * Insert a dictation result into the active editor.
 */
export function insertResult(
  vscodeApi: typeof vscode,
  result: IdeDictationResult,
): void {
  const editor = vscodeApi.window.activeTextEditor;
  if (!editor) return;

  const context = getEditorContext(vscodeApi);
  const language = context?.language ?? "plaintext";

  // Format the text for the current code language
  const formatted = formatForCode(result.text, language);

  // Determine insert position
  const insertMode =
    result.insertPosition !== "cursor" && context
      ? result.insertPosition
      : context
        ? suggestInsertMode(context, formatted)
        : "cursor";

  void editor.edit((editBuilder) => {
    switch (insertMode) {
      case "selection": {
        editBuilder.replace(editor.selection, formatted);
        break;
      }
      case "newline": {
        const line = editor.selection.active.line;
        const lineEnd = editor.document.lineAt(line).range.end;
        editBuilder.insert(lineEnd, "\n" + formatted);
        break;
      }
      case "cursor":
      default: {
        editBuilder.insert(editor.selection.active, formatted);
        break;
      }
    }
  });
}
