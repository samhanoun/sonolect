export type CommandCategory =
  "recording" | "editing" | "navigation" | "export" | "settings" | "data";

export type CommandContext = {
  isRecording?: boolean;
  hasTranscript?: boolean;
  hasSelection?: boolean;
  hasHistory?: boolean;
};

export type Command = {
  id: string;
  label: string;
  hint: string;
  shortcut?: string;
  category: CommandCategory;
  action: string;
  enabled?: (context: CommandContext) => boolean;
};

export const DEFAULT_COMMANDS: Command[] = [
  // ── recording ──────────────────────────────────────────────────
  {
    id: "recording.start",
    label: "Start Recording",
    hint: "Begin a new voice capture session",
    shortcut: "CmdOrCtrl+Shift+R",
    category: "recording",
    action: "recording:start",
    enabled: (ctx) => !ctx.isRecording,
  },
  {
    id: "recording.stop",
    label: "Stop Recording",
    hint: "End the current recording session",
    shortcut: "CmdOrCtrl+Shift+S",
    category: "recording",
    action: "recording:stop",
    enabled: (ctx) => ctx.isRecording === true,
  },
  {
    id: "recording.ptt",
    label: "Toggle Push-to-Talk",
    hint: "Hold to record, release to stop",
    shortcut: "CmdOrCtrl+Shift+T",
    category: "recording",
    action: "recording:ptt",
  },

  // ── editing ────────────────────────────────────────────────────
  {
    id: "editing.undo",
    label: "Undo",
    hint: "Undo the last edit",
    shortcut: "CmdOrCtrl+Z",
    category: "editing",
    action: "editing:undo",
    enabled: (ctx) => ctx.hasTranscript === true,
  },
  {
    id: "editing.redo",
    label: "Redo",
    hint: "Redo the last undone edit",
    shortcut: "CmdOrCtrl+Shift+Z",
    category: "editing",
    action: "editing:redo",
    enabled: (ctx) => ctx.hasTranscript === true,
  },
  {
    id: "editing.transform",
    label: "Transform Transcript",
    hint: "Apply formatting and cleanup to the transcript",
    category: "editing",
    action: "editing:transform",
    enabled: (ctx) => ctx.hasTranscript === true,
  },
  {
    id: "editing.style",
    label: "Apply Style Preset",
    hint: "Apply a predefined style to the transcript",
    category: "editing",
    action: "editing:style",
    enabled: (ctx) => ctx.hasTranscript === true,
  },
  {
    id: "editing.copy",
    label: "Copy Transcript",
    hint: "Copy the current transcript to clipboard",
    shortcut: "CmdOrCtrl+Shift+C",
    category: "editing",
    action: "editing:copy",
    enabled: (ctx) => ctx.hasTranscript === true,
  },
  {
    id: "editing.insert",
    label: "Insert into App",
    hint: "Insert polished text into the active application",
    shortcut: "CmdOrCtrl+Shift+V",
    category: "editing",
    action: "editing:insert",
    enabled: (ctx) => ctx.hasTranscript === true,
  },

  // ── navigation ─────────────────────────────────────────────────
  {
    id: "navigation.history",
    label: "Open History",
    hint: "Browse past transcription sessions",
    shortcut: "CmdOrCtrl+H",
    category: "navigation",
    action: "navigation:history",
  },
  {
    id: "navigation.dictionary",
    label: "Open Dictionary",
    hint: "Manage personal dictionary entries",
    shortcut: "CmdOrCtrl+D",
    category: "navigation",
    action: "navigation:dictionary",
  },
  {
    id: "navigation.snippets",
    label: "Open Snippets",
    hint: "Manage slash command snippets",
    category: "navigation",
    action: "navigation:snippets",
  },
  {
    id: "navigation.settings",
    label: "Open Settings",
    hint: "Configure application preferences",
    shortcut: "CmdOrCtrl+,",
    category: "navigation",
    action: "navigation:settings",
  },
  {
    id: "navigation.onboarding",
    label: "Open Onboarding",
    hint: "Re-run the setup wizard",
    category: "navigation",
    action: "navigation:onboarding",
  },

  // ── export ─────────────────────────────────────────────────────
  {
    id: "export.markdown",
    label: "Export as Markdown",
    hint: "Download transcript as a .md file",
    category: "export",
    action: "export:markdown",
    enabled: (ctx) => ctx.hasTranscript === true,
  },
  {
    id: "export.srt",
    label: "Export as SRT",
    hint: "Download transcript as SubRip subtitles",
    category: "export",
    action: "export:srt",
    enabled: (ctx) => ctx.hasTranscript === true,
  },
  {
    id: "export.vtt",
    label: "Export as VTT",
    hint: "Download transcript as WebVTT subtitles",
    category: "export",
    action: "export:vtt",
    enabled: (ctx) => ctx.hasTranscript === true,
  },
  {
    id: "export.json",
    label: "Export as JSON",
    hint: "Download transcript as structured JSON",
    category: "export",
    action: "export:json",
    enabled: (ctx) => ctx.hasTranscript === true,
  },
  {
    id: "export.text",
    label: "Export as Text",
    hint: "Download transcript as plain text",
    category: "export",
    action: "export:text",
    enabled: (ctx) => ctx.hasTranscript === true,
  },

  // ── data ───────────────────────────────────────────────────────
  {
    id: "data.clearHistory",
    label: "Clear History",
    hint: "Remove all saved transcription sessions",
    category: "data",
    action: "data:clearHistory",
    enabled: (ctx) => ctx.hasHistory === true,
  },
  {
    id: "data.privacy",
    label: "Privacy Settings",
    hint: "Control data storage and processing preferences",
    category: "data",
    action: "data:privacy",
  },
  {
    id: "data.importDictionary",
    label: "Import Dictionary",
    hint: "Import dictionary entries from a file",
    category: "data",
    action: "data:importDictionary",
  },
  {
    id: "data.exportDictionary",
    label: "Export Dictionary",
    hint: "Export dictionary entries to a file",
    category: "data",
    action: "data:exportDictionary",
  },
];

export function searchCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(q) ||
      cmd.hint.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q),
  );
}

export function getCommandsByCategory(
  commands: Command[],
): Map<CommandCategory, Command[]> {
  const map = new Map<CommandCategory, Command[]>();
  for (const cmd of commands) {
    const list = map.get(cmd.category) ?? [];
    list.push(cmd);
    map.set(cmd.category, list);
  }
  return map;
}

export function getCommandShortcutMap(
  commands: Command[],
): Map<string, Command> {
  const map = new Map<string, Command>();
  for (const cmd of commands) {
    if (cmd.shortcut) {
      map.set(cmd.shortcut, cmd);
    }
  }
  return map;
}
