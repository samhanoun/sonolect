export type VoiceCommand = {
  pattern: RegExp;
  action: string;
  description: string;
  category: "editing" | "navigation" | "formatting" | "control";
};

export type VoiceCommandResult = {
  matched: boolean;
  command?: VoiceCommand;
  remainingText: string;
  action?: string;
};

export const VOICE_COMMANDS: VoiceCommand[] = [
  // ── editing ──────────────────────────────────────────────────────
  {
    pattern: /\bdelete that$/i,
    action: "editing:deleteLast",
    description: "Remove the last sentence",
    category: "editing",
  },
  {
    pattern: /\bdelete all$/i,
    action: "editing:deleteAll",
    description: "Clear the entire transcript",
    category: "editing",
  },
  {
    pattern: /\bundo that$/i,
    action: "editing:undo",
    description: "Undo the last change",
    category: "editing",
  },
  {
    pattern: /\bredo that$/i,
    action: "editing:redo",
    description: "Redo the last undone change",
    category: "editing",
  },
  {
    pattern: /\bselect all$/i,
    action: "editing:selectAll",
    description: "Select the entire transcript",
    category: "editing",
  },

  // ── navigation ───────────────────────────────────────────────────
  {
    pattern: /\bnew line$/i,
    action: "navigation:newLine",
    description: "Insert a line break",
    category: "navigation",
  },
  {
    pattern: /\bnew paragraph$/i,
    action: "navigation:newParagraph",
    description: "Insert a paragraph break",
    category: "navigation",
  },
  {
    pattern: /\bgo back$/i,
    action: "navigation:goBack",
    description: "Undo (same as undo that)",
    category: "navigation",
  },

  // ── formatting ───────────────────────────────────────────────────
  {
    pattern: /\bbold that$/i,
    action: "formatting:bold",
    description: "Wrap the last word in bold (**word**)",
    category: "formatting",
  },
  {
    pattern: /\bcapitalize that$/i,
    action: "formatting:capitalize",
    description: "Uppercase the last word",
    category: "formatting",
  },
  {
    pattern: /\blowercase that$/i,
    action: "formatting:lowercase",
    description: "Lowercase the last word",
    category: "formatting",
  },
  {
    pattern: /\bperiod$/i,
    action: "formatting:period",
    description: "Insert a period (.)",
    category: "formatting",
  },
  {
    pattern: /\bcomma$/i,
    action: "formatting:comma",
    description: "Insert a comma (,)",
    category: "formatting",
  },
  {
    pattern: /\bquestion mark$/i,
    action: "formatting:questionMark",
    description: "Insert a question mark (?)",
    category: "formatting",
  },

  // ── control ──────────────────────────────────────────────────────
  {
    pattern: /\bstop recording$/i,
    action: "control:stopRecording",
    description: "Stop the current recording session",
    category: "control",
  },
  {
    pattern: /\bcancel$/i,
    action: "control:cancel",
    description: "Cancel the current operation",
    category: "control",
  },
  {
    pattern: /\binsert that$/i,
    action: "control:insert",
    description: "Trigger insertion into the active app",
    category: "control",
  },
];

/**
 * Parse a voice command from the end of a dictated text.
 * Commands must appear at the END of the dictation to avoid
 * false positives in normal speech like "I need to delete that file".
 */
export function parseVoiceCommand(text: string): VoiceCommandResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { matched: false, remainingText: trimmed };
  }

  for (const command of VOICE_COMMANDS) {
    const match = trimmed.match(command.pattern);
    if (match) {
      const matchStart = match.index ?? 0;
      const remaining = trimmed.slice(0, matchStart).trim();
      return {
        matched: true,
        command,
        remainingText: remaining,
        action: command.action,
      };
    }
  }

  return { matched: false, remainingText: trimmed };
}

/**
 * Execute a voice command against the current text, returning the
 * modified text and any side-effect action to dispatch.
 */
export function executeVoiceCommand(
  command: VoiceCommand,
  currentText: string,
): { text: string; action?: string } {
  switch (command.action) {
    case "editing:deleteLast": {
      // Remove the last sentence (everything after the last sentence-ending punctuation)
      const sentences = currentText.split(/(?<=[.!?])\s+/);
      if (sentences.length <= 1) return { text: "" };
      sentences.pop();
      return { text: sentences.join(" ") };
    }

    case "editing:deleteAll":
      return { text: "" };

    case "editing:undo":
      return { text: currentText, action: "editing:undo" };

    case "editing:redo":
      return { text: currentText, action: "editing:redo" };

    case "editing:selectAll":
      return { text: currentText, action: "editing:selectAll" };

    case "navigation:newLine":
      return { text: currentText + "\n" };

    case "navigation:newParagraph":
      return { text: currentText + "\n\n" };

    case "navigation:goBack":
      return { text: currentText, action: "editing:undo" };

    case "formatting:bold": {
      const words = currentText.split(/\s+/);
      if (words.length === 0) return { text: currentText };
      const lastWord = words.pop()!;
      const boldWord = `**${lastWord}**`;
      return {
        text: words.length > 0 ? words.join(" ") + " " + boldWord : boldWord,
      };
    }

    case "formatting:capitalize": {
      const words = currentText.split(/\s+/);
      if (words.length === 0) return { text: currentText };
      const lastWord = words[words.length - 1];
      if (lastWord !== undefined) {
        words[words.length - 1] = lastWord.toUpperCase();
      }
      return { text: words.join(" ") };
    }

    case "formatting:lowercase": {
      const words = currentText.split(/\s+/);
      if (words.length === 0) return { text: currentText };
      const lastWord = words[words.length - 1];
      if (lastWord !== undefined) {
        words[words.length - 1] = lastWord.toLowerCase();
      }
      return { text: words.join(" ") };
    }

    case "formatting:period":
      return { text: currentText + "." };

    case "formatting:comma":
      return { text: currentText + "," };

    case "formatting:questionMark":
      return { text: currentText + "?" };

    case "control:stopRecording":
      return { text: currentText, action: "recording:stop" };

    case "control:cancel":
      return { text: currentText, action: "control:cancel" };

    case "control:insert":
      return { text: currentText, action: "editing:insert" };

    default:
      return { text: currentText };
  }
}

/**
 * Quick check whether text ends with any known voice command pattern.
 */
export function isVoiceCommandEnabled(text: string): boolean {
  const trimmed = text.trim();
  return VOICE_COMMANDS.some((cmd) => cmd.pattern.test(trimmed));
}

/**
 * Strip all voice command phrases from text. Useful when the user
 * accidentally speaks a command in the middle of normal dictation.
 */
export function stripVoiceCommands(text: string): string {
  let result = text;
  for (const command of VOICE_COMMANDS) {
    // Build a global version of the pattern (without end-of-string anchor)
    const source = command.pattern.source.replace(/\$$/, "");
    const globalPattern = new RegExp(source, "gi");
    result = result.replace(globalPattern, "");
  }
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Return a list of all available voice commands for a help UI.
 */
export function getVoiceCommandHelp(): Array<{
  command: string;
  description: string;
  category: string;
}> {
  return VOICE_COMMANDS.map((cmd) => {
    // Extract the human-readable command string from the regex source
    const readable = cmd.pattern.source
      .replace(/^\\b/, "")
      .replace(/\$$/, "")
      .replace(/\\/g, "");
    return {
      command: readable,
      description: cmd.description,
      category: cmd.category,
    };
  });
}
