import { exportTranscript } from "./transcriptExport";
import { insertTextIntoActiveApp } from "./desktopNative";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionContext = {
  hasTranscript: boolean;
  hasPolishedPreview: boolean;
  isOnline: boolean;
  clipboardAvailable: boolean;
  nativeInsertionAvailable: boolean;
};

export type ActionItem = {
  id: string;
  label: string;
  icon: string;
  category: "output" | "create" | "share";
  handler: string;
  enabled?: (context: ActionContext) => boolean;
};

export type ActionResult = {
  actionId: string;
  success: boolean;
  message: string;
};

// ---------------------------------------------------------------------------
// Create-category pure transforms
// ---------------------------------------------------------------------------

function createNote(text: string): string {
  const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `Note (${timestamp}):\n\n${text}`;
}

function draftEmailReply(text: string): string {
  return `Hi,\n\nThank you for your message.\n\n${text}\n\nBest regards`;
}

function createTask(text: string): string {
  const lines = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.map((line) => `- [ ] ${line}`).join("\n");
}

function summarize(text: string): string {
  // Simple extractive summary: take first two sentences
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 2) return text;
  return `${sentences.slice(0, 2).join(" ")} [${sentences.length - 2} more sentences omitted]`;
}

function createBulletPoints(text: string): string {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.map((s) => `- ${s}`).join("\n");
}

const TRANSFORM_MAP: Record<string, (text: string) => string> = {
  "create-note": createNote,
  "draft-email-reply": draftEmailReply,
  "create-task": createTask,
  summarize: summarize,
  "create-bullet-points": createBulletPoints,
};

// ---------------------------------------------------------------------------
// Default actions
// ---------------------------------------------------------------------------

export function getDefaultActions(): ActionItem[] {
  return [
    // Output
    {
      id: "copy-to-clipboard",
      label: "Copy to Clipboard",
      icon: "clipboard",
      category: "output",
      handler: "copy-to-clipboard",
      enabled: (ctx) => ctx.hasTranscript && ctx.clipboardAvailable,
    },
    {
      id: "insert-into-app",
      label: "Insert into App",
      icon: "arrow-right",
      category: "output",
      handler: "insert-into-app",
      enabled: (ctx) => ctx.hasTranscript && ctx.nativeInsertionAvailable,
    },
    {
      id: "export-markdown",
      label: "Export as Markdown",
      icon: "file-text",
      category: "output",
      handler: "export-markdown",
      enabled: (ctx) => ctx.hasTranscript,
    },
    {
      id: "export-text",
      label: "Export as Text",
      icon: "file",
      category: "output",
      handler: "export-text",
      enabled: (ctx) => ctx.hasTranscript,
    },
    {
      id: "export-srt",
      label: "Export as SRT",
      icon: "subtitles",
      category: "output",
      handler: "export-srt",
      enabled: (ctx) => ctx.hasTranscript,
    },
    {
      id: "export-json",
      label: "Export as JSON",
      icon: "braces",
      category: "output",
      handler: "export-json",
      enabled: (ctx) => ctx.hasTranscript,
    },
    // Create
    {
      id: "create-note",
      label: "Create Note",
      icon: "sticky-note",
      category: "create",
      handler: "create-note",
      enabled: (ctx) => ctx.hasTranscript,
    },
    {
      id: "draft-email-reply",
      label: "Draft Email Reply",
      icon: "mail",
      category: "create",
      handler: "draft-email-reply",
      enabled: (ctx) => ctx.hasTranscript,
    },
    {
      id: "create-task",
      label: "Create Task",
      icon: "check-square",
      category: "create",
      handler: "create-task",
      enabled: (ctx) => ctx.hasTranscript,
    },
    {
      id: "summarize",
      label: "Summarize",
      icon: "align-left",
      category: "create",
      handler: "summarize",
      enabled: (ctx) => ctx.hasTranscript,
    },
    {
      id: "create-bullet-points",
      label: "Create Bullet Points",
      icon: "list",
      category: "create",
      handler: "create-bullet-points",
      enabled: (ctx) => ctx.hasTranscript,
    },
    // Share
    {
      id: "share-via-link",
      label: "Share via Link",
      icon: "link",
      category: "share",
      handler: "share-via-link",
      enabled: (ctx) => ctx.hasTranscript && ctx.isOnline,
    },
    {
      id: "send-to-slack",
      label: "Send to Slack",
      icon: "slack",
      category: "share",
      handler: "send-to-slack",
      enabled: (ctx) => ctx.hasTranscript && ctx.isOnline,
    },
  ];
}

// ---------------------------------------------------------------------------
// Filtering and grouping
// ---------------------------------------------------------------------------

export function getAvailableActions(
  actions: ActionItem[],
  context: ActionContext,
): ActionItem[] {
  return actions.filter((action) => {
    if (!action.enabled) return true;
    return action.enabled(context);
  });
}

export function getActionsByCategory(
  actions: ActionItem[],
): Map<string, ActionItem[]> {
  const grouped = new Map<string, ActionItem[]>();
  for (const action of actions) {
    const existing = grouped.get(action.category);
    if (existing) {
      existing.push(action);
    } else {
      grouped.set(action.category, [action]);
    }
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export async function executeAction(
  actionId: string,
  text: string,
  context: ActionContext,
): Promise<ActionResult> {
  try {
    // ── Copy to clipboard ────────────────────────────────────────────
    if (actionId === "copy-to-clipboard") {
      if (!context.clipboardAvailable) {
        return { actionId, success: false, message: "Clipboard not available" };
      }
      await navigator.clipboard.writeText(text);
      return { actionId, success: true, message: "Copied to clipboard" };
    }

    // ── Insert into active app ───────────────────────────────────────
    if (actionId === "insert-into-app") {
      const result = await insertTextIntoActiveApp(text);
      return {
        actionId,
        success: result.ok,
        message: result.status,
      };
    }

    // ── Export actions ───────────────────────────────────────────────
    if (actionId === "export-markdown") {
      const exported = exportTranscript({ format: "md", transcript: text });
      return { actionId, success: true, message: `Exported: ${exported.filename}` };
    }
    if (actionId === "export-text") {
      const exported = exportTranscript({ format: "txt", transcript: text });
      return { actionId, success: true, message: `Exported: ${exported.filename}` };
    }
    if (actionId === "export-srt") {
      const exported = exportTranscript({ format: "srt", transcript: text });
      return { actionId, success: true, message: `Exported: ${exported.filename}` };
    }
    if (actionId === "export-json") {
      const exported = exportTranscript({ format: "json", transcript: text });
      return { actionId, success: true, message: `Exported: ${exported.filename}` };
    }

    // ── Create-category transforms ──────────────────────────────────
    const transformFn = TRANSFORM_MAP[actionId];
    if (transformFn) {
      const result = transformFn(text);
      // For now, copy the transformed result to clipboard if available
      if (context.clipboardAvailable) {
        await navigator.clipboard.writeText(result);
        return {
          actionId,
          success: true,
          message: `Created and copied to clipboard`,
        };
      }
      return { actionId, success: true, message: `Created successfully` };
    }

    // ── Share placeholders ──────────────────────────────────────────
    if (actionId === "share-via-link") {
      return {
        actionId,
        success: false,
        message: "Share via link: coming soon",
      };
    }
    if (actionId === "send-to-slack") {
      return {
        actionId,
        success: false,
        message: "Send to Slack: coming soon",
      };
    }

    return { actionId, success: false, message: `Unknown action: ${actionId}` };
  } catch (error) {
    return {
      actionId,
      success: false,
      message: error instanceof Error ? error.message : "Action failed",
    };
  }
}
