import {
  parseVoiceCommand,
  executeVoiceCommand,
  type VoiceCommandResult,
} from "./voiceCommands";

export type VoiceCommandPipeline = {
  enableVoiceCommands: boolean;
  commandHistory: VoiceCommandResult[];
};

export type VoiceCommandPipelineOptions = {
  enableVoiceCommands?: boolean;
};

export type VoiceCommandPipelineResult = {
  finalText: string;
  commandsExecuted: VoiceCommandResult[];
  sideEffects: string[];
};

/**
 * Process raw transcript text through the voice command pipeline.
 *
 * This sits BETWEEN Whisper output and polishDictation — it intercepts
 * voice commands before the text is polished. The pipeline:
 *
 *   1. Check if voice commands are enabled
 *   2. Parse commands from the end of raw text
 *   3. Execute commands against the current transcript
 *   4. Return modified text + any side effects (like "stop recording")
 */
export function processTranscriptWithCommands(
  rawText: string,
  currentTranscript: string,
  options: VoiceCommandPipelineOptions = {},
): VoiceCommandPipelineResult {
  const { enableVoiceCommands = true } = options;

  // If voice commands are disabled, pass through unchanged
  if (!enableVoiceCommands) {
    return {
      finalText: rawText,
      commandsExecuted: [],
      sideEffects: [],
    };
  }

  const commandsExecuted: VoiceCommandResult[] = [];
  const sideEffects: string[] = [];

  let textToProcess = rawText.trim();
  let workingTranscript = currentTranscript;

  // Keep parsing commands from the end of the text.
  // This allows chaining, e.g. "hello world new paragraph bold that"
  // but in practice most utterances have at most one trailing command.
  let safety = 10; // prevent infinite loops
  while (safety-- > 0) {
    const parsed = parseVoiceCommand(textToProcess);
    if (!parsed.matched || !parsed.command) {
      break;
    }

    commandsExecuted.push(parsed);

    // Combine remaining dictated text with the current transcript
    const combinedText = workingTranscript
      ? workingTranscript +
        (parsed.remainingText ? " " + parsed.remainingText : "")
      : parsed.remainingText;

    const result = executeVoiceCommand(parsed.command, combinedText);
    workingTranscript = result.text;

    if (result.action) {
      sideEffects.push(result.action);
    }

    // Continue parsing from remaining text (there may be chained commands)
    textToProcess = parsed.remainingText;
  }

  // If no commands were matched, return raw text as final
  if (commandsExecuted.length === 0) {
    return {
      finalText: rawText,
      commandsExecuted: [],
      sideEffects: [],
    };
  }

  return {
    finalText: workingTranscript,
    commandsExecuted,
    sideEffects,
  };
}
