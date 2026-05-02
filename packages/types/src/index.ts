export type SonolectPlan = "free" | "pro" | "team";
export type SonolectPlatform = "windows" | "macos" | "ios" | "android" | "web";
export type SonolectMode =
  | "dictate"
  | "rewrite"
  | "translate"
  | "summarize"
  | "reply"
  | "command"
  | "code"
  | "meeting_notes"
  | "task_creation";
export type TranscriptStatus = "draft" | "processing" | "completed" | "failed";
export type SyncEntityType = "user" | "transcript" | "command" | "usage";
export type AudioUploadJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";
export type AudioUploadSource = "desktop" | "web" | "mobile" | "api";
export type AudioUploadStrategy = "inline-metadata";
export type AudioUploadStorage = "local-placeholder";

export type SttProviderName = "mock" | "google";
export type TranscriptionJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";
export type RefinementAction = "clean" | "rewrite" | "summarize" | "translate";
export type AgentCommandStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked";
export type AgentCommandType =
  | "copy_to_clipboard"
  | "open_url"
  | "create_task"
  | "insert_text"
  | "custom";
export type UsageMetric =
  | "transcripts"
  | "commands"
  | "minutes"
  | "storageMb"
  | "agentRuns";
export type WorkerTaskKind = "audio" | "agent" | "billing";
export type WorkerTaskStatus = "queued" | "processing" | "completed" | "failed";

export interface User {
  id: string;
  email: string;
  name?: string;
  plan: SonolectPlan;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  userId: string;
  platform: SonolectPlatform;
  name: string;
  lastSeenAt: string;
}

export interface Dictation {
  id: string;
  userId: string;
  workspaceId?: string;
  rawText?: string;
  finalText?: string;
  language: string;
  mode: SonolectMode;
  agentUsed?: string;
  privacyMode: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Transcript extends Dictation {
  title?: string;
  status: TranscriptStatus;
  durationMs?: number;
  tags: string[];
  deletedAt?: string;
}

export interface AudioSource {
  uri?: string;
  base64?: string;
  mimeType?: string;
  sampleRateHertz?: number;
  channels?: number;
  durationMs?: number;
}

export interface CreateAudioUploadJobRequest {
  fileName?: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  source?: AudioUploadSource;
  transcriptTitle?: string;
}

export interface AudioUploadJob {
  id: string;
  userId: string;
  transcriptId: string;
  status: AudioUploadJobStatus;
  fileName?: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  source: AudioUploadSource;
  upload: {
    strategy: AudioUploadStrategy;
    storage: AudioUploadStorage;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptionJobRequest {
  audio: AudioSource;
  language: string;
  provider?: SttProviderName;
  model?: string;
  enableAutomaticPunctuation?: boolean;
  enableSpeakerDiarization?: boolean;
  callbackUrl?: string;
  metadata?: Record<string, string>;
}

export interface TranscriptionSegment {
  text: string;
  startMs?: number;
  endMs?: number;
  speakerTag?: string;
  confidence?: number;
}

export interface TranscriptionJob {
  id: string;
  userId: string;
  status: TranscriptionJobStatus;
  provider: SttProviderName;
  language: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  audio: AudioSource;
  model?: string;
  transcriptText?: string;
  confidence?: number;
  segments: TranscriptionSegment[];
  error?: string;
  callbackUrl?: string;
  metadata: Record<string, string>;
}

export interface RefinementRequest {
  action: RefinementAction;
  text: string;
  language?: string;
  targetLanguage?: string;
  tone?: "neutral" | "professional" | "friendly" | "concise";
  instructions?: string;
}

export interface RefinementResult {
  id: string;
  userId: string;
  action: RefinementAction;
  inputText: string;
  outputText: string;
  language?: string;
  targetLanguage?: string;
  provider: "template" | "llm";
  createdAt: string;
}

export interface AgentDefinition {
  id: string;
  userId?: string;
  name: string;
  type: string;
  systemPrompt: string;
  enabled: boolean;
  createdAt: string;
}

export interface AgentCommandExecutionRequest {
  transcriptId?: string;
  command: string;
  type?: AgentCommandType;
  selectedText?: string;
  context?: string;
  arguments?: Record<string, unknown>;
  dryRun?: boolean;
}

export interface AgentCommandExecutionResult {
  id: string;
  userId: string;
  transcriptId?: string;
  command: string;
  type: AgentCommandType;
  status: AgentCommandStatus;
  dryRun: boolean;
  createdAt: string;
  completedAt?: string;
  output?: string;
  blockedReason?: string;
  plannedActions: string[];
}

export interface CommandExecutionRequest {
  transcriptId?: string;
  command: string;
  selectedText?: string;
  context?: string;
  dryRun?: boolean;
}

export interface CommandExecutionResult {
  id: string;
  userId: string;
  transcriptId?: string;
  command: string;
  status: "queued" | "completed" | "failed";
  dryRun: boolean;
  createdAt: string;
  completedAt?: string;
  output?: string;
}

export interface UsageQuotaSummary {
  userId: string;
  plan: SonolectPlan;
  periodStart: string;
  periodEnd: string;
  transcripts: { used: number; limit: number };
  commands: { used: number; limit: number };
  minutes: { used: number; limit: number };
  storageMb?: { used: number; limit: number };
  agentRuns?: { used: number; limit: number };
}

export interface PlanQuota {
  transcripts: number;
  commands: number;
  minutes: number;
  storageMb: number;
  agentRuns: number;
  seats: number;
}

export interface BillingPlanDefinition {
  id: SonolectPlan;
  name: string;
  stripePriceLookupKey?: string;
  monthlyPriceUsdCents: number;
  quotas: PlanQuota;
}

export interface UsageEvent {
  id: string;
  userId: string;
  metric: UsageMetric;
  quantity: number;
  source: "audio" | "agent" | "sync" | "api" | "billing" | "worker";
  occurredAt: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface TrackUsageRequest {
  userId: string;
  metric: UsageMetric;
  quantity: number;
  source: UsageEvent["source"];
  occurredAt?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface SyncManifestItem {
  id: string;
  entity: SyncEntityType;
  updatedAt: string;
  deleted: boolean;
}

export interface SyncManifest {
  generatedAt: string;
  since?: string;
  items: SyncManifestItem[];
}

export interface SyncPullRequest {
  userId: string;
  since?: string;
  limit?: number;
}

export interface SyncPullResponse {
  cursor: string;
  hasMore: boolean;
  manifest: SyncManifest;
  records: Array<{
    entity: SyncEntityType;
    id: string;
    data: unknown;
    updatedAt: string;
    deleted: boolean;
  }>;
}

export interface SyncPushChange {
  clientChangeId: string;
  entity: SyncEntityType;
  id: string;
  updatedAt: string;
  deleted?: boolean;
  data?: unknown;
}

export interface SyncPushRequest {
  userId: string;
  deviceId: string;
  changes: SyncPushChange[];
}

export interface SyncPushResponse {
  accepted: Array<{
    clientChangeId: string;
    serverId: string;
    updatedAt: string;
  }>;
  conflicts: Array<{
    clientChangeId: string;
    serverVersion: unknown;
    reason: string;
  }>;
}

export interface ListResponse<T> {
  items: T[];
  nextCursor?: string;
}

export interface WorkerTask<TPayload = unknown> {
  id: string;
  kind: WorkerTaskKind;
  type: string;
  payload: TPayload;
  status: WorkerTaskStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface EnqueueWorkerTaskRequest<TPayload = unknown> {
  kind: WorkerTaskKind;
  type: string;
  payload: TPayload;
}
