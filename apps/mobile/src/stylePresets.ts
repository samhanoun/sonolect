export type StylePreset = {
  id: string;
  label: string;
  description: string;
  transform: (text: string) => string;
};

function conciseTransform(text: string): string {
  const fillerWords =
    /\b(very|really|just|actually|basically)\b\s*/gi;
  const redundantPhrases: [RegExp, string][] = [
    [/\bin order to\b/gi, "to"],
    [/\bdue to the fact that\b/gi, "because"],
    [/\bat this point in time\b/gi, "now"],
    [/\bin the event that\b/gi, "if"],
    [/\bfor the purpose of\b/gi, "to"],
    [/\bin spite of the fact that\b/gi, "although"],
    [/\bas a matter of fact\b/gi, "in fact"],
    [/\beach and every\b/gi, "every"],
    [/\bfirst and foremost\b/gi, "first"],
  ];

  let result = text.replace(fillerWords, "");
  for (const [pattern, replacement] of redundantPhrases) {
    result = result.replace(pattern, replacement);
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

function professionalTransform(text: string): string {
  // Expand contractions
  const contractions: [RegExp, string][] = [
    [/\bdon't\b/gi, "do not"],
    [/\bwon't\b/gi, "will not"],
    [/\bcan't\b/gi, "cannot"],
    [/\bdidn't\b/gi, "did not"],
    [/\bdoesn't\b/gi, "does not"],
    [/\bisn't\b/gi, "is not"],
    [/\baren't\b/gi, "are not"],
    [/\bwasn't\b/gi, "was not"],
    [/\bweren't\b/gi, "were not"],
    [/\bhasn't\b/gi, "has not"],
    [/\bhaven't\b/gi, "have not"],
    [/\bhadn't\b/gi, "had not"],
    [/\bwouldn't\b/gi, "would not"],
    [/\bcouldn't\b/gi, "could not"],
    [/\bshouldn't\b/gi, "should not"],
    [/\bI'm\b/g, "I am"],
    [/\bi'm\b/gi, "I am"],
    [/\bwe're\b/gi, "we are"],
    [/\bthey're\b/gi, "they are"],
    [/\byou're\b/gi, "you are"],
    [/\bit's\b/gi, "it is"],
    [/\bthat's\b/gi, "that is"],
    [/\blet's\b/gi, "let us"],
    [/\bI've\b/g, "I have"],
    [/\bi've\b/gi, "I have"],
    [/\bwe've\b/gi, "we have"],
    [/\bthey've\b/gi, "they have"],
    [/\byou've\b/gi, "you have"],
    [/\bI'll\b/g, "I will"],
    [/\bi'll\b/gi, "I will"],
    [/\bwe'll\b/gi, "we will"],
    [/\bthey'll\b/gi, "they will"],
    [/\byou'll\b/gi, "you will"],
    [/\bI'd\b/g, "I would"],
    [/\bi'd\b/gi, "I would"],
    [/\bwe'd\b/gi, "we would"],
    [/\bthey'd\b/gi, "they would"],
    [/\byou'd\b/gi, "you would"],
  ];

  let result = text;
  for (const [pattern, replacement] of contractions) {
    result = result.replace(pattern, replacement);
  }

  // Capitalize first letter of each sentence
  result = result.replace(/(^|[.!?]\s+)([a-z])/g, (_match, prefix: string, letter: string) =>
    `${prefix}${letter.toUpperCase()}`,
  );

  // Ensure period endings for sentences
  const sentences = result
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`));

  return sentences.join(" ");
}

function casualTransform(text: string): string {
  const contractions: [RegExp, string][] = [
    [/\bdo not\b/gi, "don't"],
    [/\bwill not\b/gi, "won't"],
    [/\bcannot\b/gi, "can't"],
    [/\bcan not\b/gi, "can't"],
    [/\bdid not\b/gi, "didn't"],
    [/\bdoes not\b/gi, "doesn't"],
    [/\bis not\b/gi, "isn't"],
    [/\bare not\b/gi, "aren't"],
    [/\bwas not\b/gi, "wasn't"],
    [/\bwere not\b/gi, "weren't"],
    [/\bhas not\b/gi, "hasn't"],
    [/\bhave not\b/gi, "haven't"],
    [/\bhad not\b/gi, "hadn't"],
    [/\bwould not\b/gi, "wouldn't"],
    [/\bcould not\b/gi, "couldn't"],
    [/\bshould not\b/gi, "shouldn't"],
    [/\bI am\b/g, "I'm"],
    [/\bwe are\b/gi, "we're"],
    [/\bthey are\b/gi, "they're"],
    [/\byou are\b/gi, "you're"],
    [/\bit is\b/gi, "it's"],
    [/\bthat is\b/gi, "that's"],
    [/\blet us\b/gi, "let's"],
    [/\bI have\b/g, "I've"],
    [/\bwe have\b/gi, "we've"],
    [/\bthey have\b/gi, "they've"],
    [/\byou have\b/gi, "you've"],
    [/\bI will\b/g, "I'll"],
    [/\bwe will\b/gi, "we'll"],
    [/\bthey will\b/gi, "they'll"],
    [/\byou will\b/gi, "you'll"],
    [/\bI would\b/g, "I'd"],
    [/\bwe would\b/gi, "we'd"],
    [/\bthey would\b/gi, "they'd"],
    [/\byou would\b/gi, "you'd"],
  ];

  let result = text;
  for (const [pattern, replacement] of contractions) {
    result = result.replace(pattern, replacement);
  }

  // Lowercase first letter of each sentence (except "I")
  result = result.replace(/(^|[.!?]\s+)([A-Z])/g, (_match, prefix: string, letter: string) => {
    if (letter === "I") return `${prefix}${letter}`;
    return `${prefix}${letter.toLowerCase()}`;
  });

  return result;
}

function technicalTransform(text: string): string {
  // Convert comma-separated sequences that follow "first/then/next/finally" into bullet points
  let result = text;

  // Detect numbered step patterns: "first X then Y then Z" -> numbered list
  const stepPattern =
    /\b(?:first|step one)[,:]?\s+(.+?)(?:\.\s*|\s+)(?:then|next|step two)[,:]?\s+(.+?)(?:\.\s*|\s+)(?:then|finally|lastly|step three)[,:]?\s+(.+?)(?:\.|$)/gi;

  result = result.replace(stepPattern, (_match, s1: string, s2: string, s3: string) =>
    `1. ${s1.trim()}; 2. ${s2.trim()}; 3. ${s3.trim()}.`,
  );

  // Replace "and" joining independent clauses with semicolons
  // Only when both sides look like independent clauses (have a verb-like structure)
  result = result.replace(
    /([^,;.]+(?:is|are|was|were|will|can|should|must|has|have|do|does)[^,;.]*),\s*and\s+([^,;.]+(?:is|are|was|were|will|can|should|must|has|have|do|does)[^,;.]*)/gi,
    "$1; $2",
  );

  return result;
}

const BUILT_IN_PRESETS: StylePreset[] = [
  {
    id: "concise",
    label: "Concise",
    description: "Remove redundancy, shorten sentences, keep meaning",
    transform: conciseTransform,
  },
  {
    id: "professional",
    label: "Professional",
    description: "Formal tone, proper grammar, business-appropriate",
    transform: professionalTransform,
  },
  {
    id: "casual",
    label: "Casual",
    description: "Conversational, contractions, friendly",
    transform: casualTransform,
  },
  {
    id: "technical",
    label: "Technical",
    description: "Precise terminology, structured, no ambiguity",
    transform: technicalTransform,
  },
  {
    id: "custom",
    label: "Custom",
    description: "Pass-through for manual editing",
    transform: (text: string) => text,
  },
];

export function getStylePresets(): StylePreset[] {
  return BUILT_IN_PRESETS;
}

export function applyStylePreset(text: string, presetId: string): string {
  const preset = BUILT_IN_PRESETS.find((p) => p.id === presetId);
  if (!preset) {
    throw new Error(`Unknown style preset: ${presetId}`);
  }
  return preset.transform(text);
}
