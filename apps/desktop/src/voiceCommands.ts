export type VoiceCommand = {
  pattern: RegExp;
  name: string;
  action: string;
  description: string;
};

export const VOICE_COMMANDS: VoiceCommand[] = [
  {
    pattern: /\bdelete that$/i,
    name: "delete that",
    action: "delete_last_segment",
    description: "deletes last dictated segment",
  },
  {
    pattern: /\bundo that$/i,
    name: "undo that",
    action: "undo",
    description: "undo last action",
  },
  {
    pattern: /\bredo that$/i,
    name: "redo that",
    action: "redo",
    description: "redo",
  },
  {
    pattern: /\bnew line$/i,
    name: "new line",
    action: "insert_newline",
    description: "insert newline",
  },
  {
    pattern: /\bnew paragraph$/i,
    name: "new paragraph",
    action: "insert_double_newline",
    description: "insert double newline",
  },
  {
    pattern: /\bbold that$/i,
    name: "bold that",
    action: "bold",
    description: "wrap last segment in **bold**",
  },
  {
    pattern: /\bitalic that$/i,
    name: "italic that",
    action: "italic",
    description: "wrap in *italic*",
  },
  {
    pattern: /\bcapitalize that$/i,
    name: "capitalize that",
    action: "capitalize",
    description: "capitalize last word",
  },
  {
    pattern: /\buppercase that$/i,
    name: "uppercase that",
    action: "uppercase",
    description: "UPPERCASE last segment",
  },
  {
    pattern: /\blowercase that$/i,
    name: "lowercase that",
    action: "lowercase",
    description: "lowercase last segment",
  },
  {
    pattern: /\bperiod$/i,
    name: "period",
    action: "insert_period",
    description: 'insert "."',
  },
  {
    pattern: /\bcomma$/i,
    name: "comma",
    action: "insert_comma",
    description: 'insert ","',
  },
  {
    pattern: /\bquestion mark$/i,
    name: "question mark",
    action: "insert_question_mark",
    description: 'insert "?"',
  },
  {
    pattern: /\bexclamation mark$/i,
    name: "exclamation mark",
    action: "insert_exclamation_mark",
    description: 'insert "!"',
  },
  {
    pattern: /\bcolon$/i,
    name: "colon",
    action: "insert_colon",
    description: 'insert ":"',
  },
  {
    pattern: /\bsemicolon$/i,
    name: "semicolon",
    action: "insert_semicolon",
    description: 'insert ";"',
  },
  {
    pattern: /\bopen quote$/i,
    name: "open quote",
    action: "insert_open_quote",
    description: "insert open quote",
  },
  {
    pattern: /\bclose quote$/i,
    name: "close quote",
    action: "insert_close_quote",
    description: "insert close quote",
  },
  {
    pattern: /\bselect all$/i,
    name: "select all",
    action: "select_all",
    description: "select all text",
  },
];

export function matchVoiceCommand(text: string): VoiceCommand | null {
  const trimmed = text.trimEnd();
  for (const command of VOICE_COMMANDS) {
    if (command.pattern.test(trimmed)) {
      return command;
    }
  }
  return null;
}

function getLastSegment(text: string): { before: string; segment: string } {
  const trimmed = text.trimEnd();
  const sentenceBreak = Math.max(
    trimmed.lastIndexOf(". "),
    trimmed.lastIndexOf(".\n"),
    trimmed.lastIndexOf("\n"),
  );
  if (sentenceBreak === -1) {
    return { before: "", segment: trimmed };
  }
  const splitAt =
    trimmed[sentenceBreak] === "\n" ? sentenceBreak + 1 : sentenceBreak + 2;
  return { before: trimmed.slice(0, splitAt), segment: trimmed.slice(splitAt) };
}

function getLastWord(text: string): { before: string; word: string } {
  const match = text.match(/^(.*?)(\S+)$/s);
  if (!match) {
    return { before: text, word: "" };
  }
  return { before: match[1] ?? "", word: match[2] ?? "" };
}

export function applyVoiceCommand(text: string, command: VoiceCommand): string {
  switch (command.action) {
    case "delete_last_segment": {
      const { before } = getLastSegment(text);
      return before;
    }
    case "undo":
      return text;
    case "redo":
      return text;
    case "insert_newline":
      return text + "\n";
    case "insert_double_newline":
      return text + "\n\n";
    case "bold": {
      const { before, segment } = getLastSegment(text);
      return before + "**" + segment + "**";
    }
    case "italic": {
      const { before, segment } = getLastSegment(text);
      return before + "*" + segment + "*";
    }
    case "capitalize": {
      const { before, word } = getLastWord(text);
      return before + word.charAt(0).toUpperCase() + word.slice(1);
    }
    case "uppercase": {
      const { before, segment } = getLastSegment(text);
      return before + segment.toUpperCase();
    }
    case "lowercase": {
      const { before, segment } = getLastSegment(text);
      return before + segment.toLowerCase();
    }
    case "insert_period":
      return text + ".";
    case "insert_comma":
      return text + ",";
    case "insert_question_mark":
      return text + "?";
    case "insert_exclamation_mark":
      return text + "!";
    case "insert_colon":
      return text + ":";
    case "insert_semicolon":
      return text + ";";
    case "insert_open_quote":
      return text + '"';
    case "insert_close_quote":
      return text + '"';
    case "select_all":
      return text;
    default:
      return text;
  }
}

export function stripCommandFromText(
  text: string,
  command: VoiceCommand,
): string {
  return text.replace(command.pattern, "").trimEnd();
}
