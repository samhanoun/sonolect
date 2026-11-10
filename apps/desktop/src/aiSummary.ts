export type SummaryStyle =
  "brief" | "detailed" | "bullets" | "action-items" | "meeting-notes";

export type SummaryResult = {
  style: SummaryStyle;
  text: string;
  actionItems: string[];
  keyDecisions: string[];
  generatedAt: string;
};

type GenerateSummaryOptions = {
  apiKey?: string;
  provider?: "openai" | "anthropic";
};

export async function generateSummary(
  transcript: string,
  style: SummaryStyle,
  options?: GenerateSummaryOptions,
): Promise<SummaryResult> {
  if (!options?.apiKey) {
    return localFallbackSummary(transcript, style);
  }

  try {
    const text = await callCloudLLM(
      transcript,
      style,
      options.apiKey,
      options.provider ?? "openai",
    );
    return {
      style,
      text,
      actionItems: extractActionItems(text),
      keyDecisions: extractKeyDecisions(text),
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return localFallbackSummary(transcript, style);
  }
}

export function extractActionItems(text: string): string[] {
  const patterns = [
    /(?:^|\.\s+|\n)([^.\n]*?\b(?:need to|should|will|must)\b[^.\n]*)/gi,
    /(?:action item:\s*)([^\n.]+)/gi,
    /(?:TODO:\s*)([^\n.]+)/gi,
    /(?:task:\s*)([^\n.]+)/gi,
  ];

  const items = new Set<string>();
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const item = match[1]!.trim();
      if (item.length > 0) {
        items.add(item);
      }
    }
  }
  return [...items];
}

export function extractKeyDecisions(text: string): string[] {
  const pattern =
    /(?:^|\.\s+|\n)([^.\n]*?\b(?:decided|agreed|conclusion|resolved|determined)\b[^.\n]*)/gi;

  const decisions = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const decision = match[1]!.trim();
    if (decision.length > 0) {
      decisions.add(decision);
    }
  }
  return [...decisions];
}

export function localFallbackSummary(
  transcript: string,
  style: SummaryStyle,
): SummaryResult {
  const sentences = splitSentences(transcript);
  let text: string;

  switch (style) {
    case "brief":
      text =
        sentences.slice(0, 3).join(". ") + (sentences.length > 0 ? "." : "");
      break;
    case "detailed":
      text = sentences.join(". ") + (sentences.length > 0 ? "." : "");
      break;
    case "bullets":
      text = sentences.map((s) => `- ${s}`).join("\n");
      break;
    case "action-items":
      text =
        extractActionItems(transcript)
          .map((item) => `- [ ] ${item}`)
          .join("\n") || "No action items found.";
      break;
    case "meeting-notes": {
      const actionItems = extractActionItems(transcript);
      const decisions = extractKeyDecisions(transcript);
      const parts: string[] = [];
      parts.push("## Summary");
      parts.push(
        sentences.slice(0, 3).join(". ") + (sentences.length > 0 ? "." : ""),
      );
      if (decisions.length > 0) {
        parts.push("\n## Key Decisions");
        parts.push(decisions.map((d) => `- ${d}`).join("\n"));
      }
      if (actionItems.length > 0) {
        parts.push("\n## Action Items");
        parts.push(actionItems.map((a) => `- [ ] ${a}`).join("\n"));
      }
      text = parts.join("\n");
      break;
    }
  }

  return {
    style,
    text,
    actionItems: extractActionItems(transcript),
    keyDecisions: extractKeyDecisions(transcript),
    generatedAt: new Date().toISOString(),
  };
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/[.!?]+$/, "").trim())
    .filter((s) => s.length > 0);
}

async function callCloudLLM(
  transcript: string,
  style: SummaryStyle,
  apiKey: string,
  provider: "openai" | "anthropic",
): Promise<string> {
  const prompt = `Summarize the following transcript in "${style}" style:\n\n${transcript}`;

  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok)
      throw new Error(`Anthropic API error: ${response.status}`);
    const data = await response.json();
    return data.content[0].text;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}
