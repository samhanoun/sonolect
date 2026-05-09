import {
  VOICE_COMMANDS,
  type VoiceCommand,
  stripCommandFromText,
  applyVoiceCommand,
} from "./voiceCommands";

function findTrailingCommand(
  text: string,
): { command: VoiceCommand; matchIndex: number } | null {
  const trimmed = text.trimEnd();
  for (const command of VOICE_COMMANDS) {
    const match = trimmed.match(command.pattern);
    if (match && match.index !== undefined) {
      return { command, matchIndex: match.index };
    }
  }
  return null;
}

export function processTranscriptWithCommands(rawTranscript: string): {
  cleanText: string;
  appliedCommands: string[];
} {
  const appliedCommands: string[] = [];
  let text = rawTranscript;

  let found = findTrailingCommand(text);
  while (found) {
    const { command } = found;
    const stripped = stripCommandFromText(text, command);
    text = applyVoiceCommand(stripped, command);
    appliedCommands.push(command.name);
    found = findTrailingCommand(text);
  }

  return { cleanText: text, appliedCommands };
}
