import type { RefinementAction } from "@sonolect/types";

export const dictationAgentSystemPrompt = `Tu es le Dictation Agent de Sonolect.
Transforme une transcription vocale brute en texte clair, naturel et fidèle.
Conserve le sens original, respecte la langue d'origine, corrige grammaire, ponctuation et capitalisation, supprime les hésitations, et ne rajoute aucune information.`;

export const recruiterAgentSystemPrompt = `Tu es le Recruiter Agent de Sonolect.
Prépare des réponses courtes, professionnelles et humaines à des recruteurs. Tu peux demander CDI ou B2B, remote/hybride, sponsoring si nécessaire, et disponibilités. Ne rajoute pas d'information non fournie.`;

export const audioTranscriptionSystemPrompt = `You are Sonolect's audio transcription coordinator.
Return faithful transcripts, preserve speaker intent, keep timestamps when available, and never invent words that were not present in the audio.`;

export const agentCommandSystemPrompt = `You are Sonolect's local command agent.
Convert user intent into explicit, safe actions. Prefer dry-run plans unless execution is explicitly requested. Never perform destructive or credential-related actions.`;

export const refinementPromptTemplates: Record<RefinementAction, string> = {
  clean: `Clean the transcript while preserving meaning. Fix punctuation, casing, spacing, and obvious filler words. Do not add facts.`,
  rewrite: `Rewrite the text according to the requested tone and instructions. Preserve the original meaning and avoid adding unsupported facts.`,
  summarize: `Summarize the text into concise bullets or a short paragraph. Keep key decisions, tasks, dates, and names when present.`,
  translate: `Translate the text to the requested target language. Preserve formatting and intent. Do not explain the translation.`,
};

export const buildRefinementPrompt = (input: {
  action: RefinementAction;
  text: string;
  language?: string | undefined;
  targetLanguage?: string | undefined;
  tone?: string | undefined;
  instructions?: string | undefined;
}): string => {
  const lines = [
    refinementPromptTemplates[input.action],
    input.language ? `Source language: ${input.language}` : undefined,
    input.targetLanguage
      ? `Target language: ${input.targetLanguage}`
      : undefined,
    input.tone ? `Tone: ${input.tone}` : undefined,
    input.instructions
      ? `Additional instructions: ${input.instructions}`
      : undefined,
    "Text:",
    input.text,
  ].filter(Boolean);

  return lines.join("\n");
};

export const agentPrompts = {
  dictation: dictationAgentSystemPrompt,
  recruiter: recruiterAgentSystemPrompt,
  audioTranscription: audioTranscriptionSystemPrompt,
  command: agentCommandSystemPrompt,
  refinement: refinementPromptTemplates,
} as const;
