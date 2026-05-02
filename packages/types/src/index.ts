export type SonolectPlan = "free" | "pro" | "team";
export type SonolectPlatform = "windows" | "macos" | "ios" | "android" | "web";
export type SonolectMode = "dictate" | "rewrite" | "translate" | "summarize" | "reply" | "command" | "code" | "meeting_notes" | "task_creation";

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

export interface AgentDefinition {
  id: string;
  userId?: string;
  name: string;
  type: string;
  systemPrompt: string;
  enabled: boolean;
  createdAt: string;
}
