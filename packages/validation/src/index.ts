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
  "task_creation",
]);

export const transcriptStatusSchema = z.enum([
  "draft",
  "processing",
  "completed",
  "failed",
]);
export const sttProviderSchema = z.enum(["mock", "google"]);
export const transcriptionJobStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);
export const refinementActionSchema = z.enum([
  "clean",
  "rewrite",
  "summarize",
  "translate",
]);
export const agentCommandTypeSchema = z.enum([
  "copy_to_clipboard",
  "open_url",
  "create_task",
  "insert_text",
  "custom",
]);
export const audioUploadSourceSchema = z.enum([
  "desktop",
  "web",
  "mobile",
  "api",
]);

// Shared limits. Every free-text field is capped so a single request cannot
// make a service hold or forward an unbounded payload.
const MAX_TRANSCRIPT_TEXT_LENGTH = 2_000_000;
const MAX_PROMPT_TEXT_LENGTH = 50_000;
const MAX_ID_LENGTH = 128;

/**
 * A BCP-47 style language tag such as "en", "fr-CA" or "zh-Hant-TW" (and the
 * "auto" sentinel). It always starts with a letter, so it can never be read as
 * a command-line option when a worker passes it to a local speech engine.
 */
export const languageTagSchema = z
  .string()
  .min(2)
  .max(35)
  .regex(
    /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/,
    "language must be a language tag such as en, fr-CA or zh-Hant",
  );

export const audioMimeTypeSchema = z
  .string()
  .max(100)
  .regex(/^audio\/[a-z0-9.+-]+$/i, "mimeType must be an audio MIME type");

/** IDs for users, devices and records: no whitespace, slashes or control characters. */
export const userIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9._:@-]{1,128}$/,
    "userId must be 1 to 128 letters, digits or . _ : @ -",
  );
const recordIdSchema = z.string().min(1).max(MAX_ID_LENGTH);

// Field rules shared by create and update. Defaults are applied only on create:
// zod 4 applies defaults inside optional/partial fields, so an update schema
// built with createTranscriptSchema.partial() would reset unspecified fields.
const transcriptFields = {
  title: z.string().min(1).max(200),
  rawText: z.string().max(MAX_TRANSCRIPT_TEXT_LENGTH),
  finalText: z.string().max(MAX_TRANSCRIPT_TEXT_LENGTH),
  language: languageTagSchema,
  mode: sonolectModeSchema,
  workspaceId: recordIdSchema,
  agentUsed: z.string().min(1).max(120),
  privacyMode: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  tags: z.array(z.string().min(1).max(64)).max(50),
  status: transcriptStatusSchema,
};

export const createTranscriptSchema = z.object({
  title: transcriptFields.title.optional(),
  rawText: transcriptFields.rawText.optional(),
  finalText: transcriptFields.finalText.optional(),
  language: transcriptFields.language.default("en"),
  mode: transcriptFields.mode.default("dictate"),
  workspaceId: transcriptFields.workspaceId.optional(),
  agentUsed: transcriptFields.agentUsed.optional(),
  privacyMode: transcriptFields.privacyMode.default(false),
  durationMs: transcriptFields.durationMs.optional(),
  tags: transcriptFields.tags.default([]),
  status: transcriptFields.status.default("completed"),
});

export const updateTranscriptSchema = z
  .object(transcriptFields)
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one transcript field must be provided",
  );

export const listTranscriptsQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  includeDeleted: z.coerce.boolean().default(false),
});

export const commandExecutionRequestSchema = z.object({
  transcriptId: recordIdSchema.optional(),
  command: z.string().min(1).max(200),
  selectedText: z.string().max(MAX_PROMPT_TEXT_LENGTH).optional(),
  context: z.string().max(MAX_PROMPT_TEXT_LENGTH).optional(),
  dryRun: z.boolean().default(false),
});

export const audioSourceSchema = z
  .object({
    uri: z.string().min(1).max(2_048).optional(),
    base64: z.string().min(1).optional(),
    mimeType: audioMimeTypeSchema.default("audio/webm"),
    sampleRateHertz: z.number().int().positive().optional(),
    channels: z.number().int().positive().max(8).optional(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .refine(
    (value) => Boolean(value.uri || value.base64),
    "Either audio.uri or audio.base64 is required",
  );

export const createAudioUploadJobSchema = z.object({
  fileName: z.string().min(1).max(255).optional(),
  mimeType: audioMimeTypeSchema,
  sizeBytes: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  source: audioUploadSourceSchema.default("desktop"),
  transcriptTitle: z.string().min(1).max(200).optional(),
});

export const transcriptionJobRequestSchema = z.object({
  audio: audioSourceSchema,
  language: languageTagSchema.default("en-US"),
  provider: sttProviderSchema.optional(),
  model: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,120}$/, "model must be a model identifier")
    .optional(),
  enableAutomaticPunctuation: z.boolean().default(true),
  enableSpeakerDiarization: z.boolean().default(false),
  callbackUrl: z
    .string()
    .url()
    .max(2_048)
    .refine(
      (value) => value.startsWith("https://"),
      "callbackUrl must use https",
    )
    .optional(),
  metadata: z
    .record(z.string().max(64), z.string().max(1_000))
    .refine(
      (value) => Object.keys(value).length <= 50,
      "metadata accepts at most 50 entries",
    )
    .default({}),
});

export const refinementRequestSchema = z
  .object({
    action: refinementActionSchema,
    text: z.string().min(1).max(50_000),
    language: languageTagSchema.optional(),
    targetLanguage: languageTagSchema.optional(),
    tone: z
      .enum(["neutral", "professional", "friendly", "concise"])
      .default("neutral"),
    instructions: z.string().max(2_000).optional(),
  })
  .refine(
    (value) => value.action !== "translate" || Boolean(value.targetLanguage),
    "targetLanguage is required for translate refinements",
  );

export const agentCommandExecutionRequestSchema = z.object({
  transcriptId: recordIdSchema.optional(),
  command: z.string().min(1).max(500),
  type: agentCommandTypeSchema.default("custom"),
  selectedText: z.string().max(MAX_PROMPT_TEXT_LENGTH).optional(),
  context: z.string().max(MAX_PROMPT_TEXT_LENGTH).optional(),
  arguments: z
    .record(z.string().max(64), z.unknown())
    .refine(
      (value) => Object.keys(value).length <= 50,
      "arguments accepts at most 50 entries",
    )
    .default({}),
  dryRun: z.boolean().default(true),
});

export const syncManifestQuerySchema = z.object({
  since: z.string().datetime().optional(),
});

export const sonolectPlanSchema = z.enum(["free", "pro", "team"]);
export const usageMetricSchema = z.enum([
  "transcripts",
  "commands",
  "minutes",
  "storageMb",
  "agentRuns",
]);
export const usageSourceSchema = z.enum([
  "audio",
  "agent",
  "sync",
  "api",
  "billing",
  "worker",
]);

export const trackUsageSchema = z.object({
  userId: userIdSchema,
  metric: usageMetricSchema,
  quantity: z.number().positive().max(1_000_000_000),
  source: usageSourceSchema,
  occurredAt: z.string().datetime().optional(),
  metadata: z
    .record(
      z.string().max(64),
      z.union([z.string().max(1_000), z.number(), z.boolean()]),
    )
    .refine(
      (value) => Object.keys(value).length <= 50,
      "metadata accepts at most 50 entries",
    )
    .optional(),
});

export const workerTaskKindSchema = z.enum(["audio", "agent", "billing"]);

export const enqueueWorkerTaskSchema = z.object({
  kind: workerTaskKindSchema,
  type: z.string().min(1).max(120),
  payload: z.unknown(),
});

export const createDictationSchema = createTranscriptSchema;

export type CreateTranscriptInput = z.infer<typeof createTranscriptSchema>;
export type UpdateTranscriptInput = z.infer<typeof updateTranscriptSchema>;
export type ListTranscriptsQuery = z.infer<typeof listTranscriptsQuerySchema>;
export type CreateAudioUploadJobInput = z.infer<
  typeof createAudioUploadJobSchema
>;
export type CommandExecutionInput = z.infer<
  typeof commandExecutionRequestSchema
>;
export type TranscriptionJobInput = z.infer<
  typeof transcriptionJobRequestSchema
>;
export type RefinementInput = z.infer<typeof refinementRequestSchema>;
export type AgentCommandExecutionInput = z.infer<
  typeof agentCommandExecutionRequestSchema
>;
export type SyncManifestQuery = z.infer<typeof syncManifestQuerySchema>;
export type CreateDictationInput = CreateTranscriptInput;
export type TrackUsageInput = z.infer<typeof trackUsageSchema>;
export type EnqueueWorkerTaskInput = z.infer<typeof enqueueWorkerTaskSchema>;
