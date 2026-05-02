import { z } from "zod";

export const sonolectModeSchema = z.enum([
  "dictate",
  "rewrite",
  "translate",
  "summarize",
  "reply",
  "command",
  "code",
  "meeting_notes",
  "task_creation"
]);

export const createDictationSchema = z.object({
  rawText: z.string().optional(),
  language: z.string().min(2),
  mode: sonolectModeSchema,
  privacyMode: z.boolean().default(false)
});

export type CreateDictationInput = z.infer<typeof createDictationSchema>;
