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

// Field rules shared by create and update. Defaults are applied only on create:
// zod 4 applies defaults inside optional/partial fields, so an update schema
// built with createTranscriptSchema.partial() would reset unspecified fields.
const transcriptFields = {
  title: z.string().min(1).max(200),
  rawText: z.string(),
  finalText: z.string(),
  language: z.string().min(2),
  mode: sonolectModeSchema,
  workspaceId: z.string().min(1),
  agentUsed: z.string().min(1),
  privacyMode: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  tags: z.array(z.string().min(1).max(64)),
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
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  includeDeleted: z.coerce.boolean().default(false),
});

export const commandExecutionRequestSchema = z.object({
  transcriptId: z.string().min(1).optional(),
  command: z.string().min(1).max(200),
  selectedText: z.string().optional(),
  context: z.string().optional(),
  dryRun: z.boolean().default(false),
});

export const audioSourceSchema = z
  .object({
    uri: z.string().min(1).optional(),
    base64: z.string().min(1).optional(),
    mimeType: z.string().min(1).default("audio/webm"),
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
  mimeType: z
    .string()
    .regex(/^audio\/[a-z0-9.+-]+$/i, "mimeType must be an audio MIME type"),
  sizeBytes: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  source: audioUploadSourceSchema.default("desktop"),
  transcriptTitle: z.string().min(1).max(200).optional(),
});

export const transcriptionJobRequestSchema = z.object({
  audio: audioSourceSchema,
  language: z.string().min(2).default("en-US"),
  provider: sttProviderSchema.optional(),
  model: z.string().min(1).optional(),
  enableAutomaticPunctuation: z.boolean().default(true),
  enableSpeakerDiarization: z.boolean().default(false),
  callbackUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.string()).default({}),
});

export const refinementRequestSchema = z
  .object({
    action: refinementActionSchema,
    text: z.string().min(1).max(50_000),
    language: z.string().min(2).optional(),
    targetLanguage: z.string().min(2).optional(),
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
  transcriptId: z.string().min(1).optional(),
  command: z.string().min(1).max(500),
  type: agentCommandTypeSchema.default("custom"),
  selectedText: z.string().optional(),
  context: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).default({}),
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
  userId: z.string().min(1),
  metric: usageMetricSchema,
  quantity: z.number().positive(),
  source: usageSourceSchema,
  occurredAt: z.string().datetime().optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});

export const syncPullSchema = z.object({
  userId: z.string().min(1),
  since: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const syncPushChangeSchema = z.object({
  clientChangeId: z.string().min(1),
  entity: z.enum(["user", "transcript", "command", "usage"]),
  id: z.string().min(1),
  updatedAt: z.string().datetime(),
  deleted: z.boolean().optional(),
  data: z.unknown().optional(),
});

export const syncPushSchema = z.object({
  userId: z.string().min(1),
  deviceId: z.string().min(1),
  changes: z.array(syncPushChangeSchema).max(500),
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
export type SyncPullInput = z.infer<typeof syncPullSchema>;
export type SyncPushInput = z.infer<typeof syncPushSchema>;
export type EnqueueWorkerTaskInput = z.infer<typeof enqueueWorkerTaskSchema>;
