import type { SonolectMode } from "@sonolect/types";

export type CaptureStatus =
  | "idle"
  | "listening"
  | "processing"
  | "ready"
  | "error";
export type PrivacyLevel = "standard" | "local_first" | "ephemeral";
export type NotificationIntent =
  | "recording"
  | "sync"
  | "refinement"
  | "privacy";

export interface TranscriptTurn {
  id: string;
  rawText: string;
  refinedText: string;
  mode: SonolectMode;
  language: "fr-FR" | "en-US" | "auto";
  privacyMode: boolean;
  createdAt: string;
  durationMs: number;
  source: "microphone" | "typed" | "sample";
  syncState: "local" | "queued" | "synced";
}

export interface RefinementAction {
  id: SonolectMode;
  label: string;
  helper: string;
  promptPreview: string;
}

export interface CaptureSession {
  id: string;
  status: CaptureStatus;
  startedAt?: string;
  elapsedMs: number;
  partialTranscript: string;
  error?: string;
}

export interface CompanionSettings {
  language: TranscriptTurn["language"];
  privacyLevel: PrivacyLevel;
  saveHistory: boolean;
  cloudSyncEnabled: boolean;
  localApiUrl?: string;
  notificationsEnabled: boolean;
  hapticsEnabled: boolean;
}

export interface AuthSnapshot {
  status: "guest" | "ready";
  userId?: string;
  email?: string;
  tokenRef?: string;
}

export interface NotificationRequest {
  id: string;
  intent: NotificationIntent;
  title: string;
  body: string;
  createdAt: string;
}

export const REFINEMENT_ACTIONS: RefinementAction[] = [
  {
    id: "dictate",
    label: "Nettoyer",
    helper: "Corrige les hésitations sans changer le sens.",
    promptPreview: "Transforme cette dictée brute en texte clair et fidèle.",
  },
  {
    id: "rewrite",
    label: "Réécrire",
    helper: "Rend le texte plus fluide et professionnel.",
    promptPreview: "Réécris en français naturel, concis et premium.",
  },
  {
    id: "summarize",
    label: "Résumer",
    helper: "Produit les points clés actionnables.",
    promptPreview: "Résume les idées et actions importantes.",
  },
  {
    id: "reply",
    label: "Répondre",
    helper: "Prépare une réponse courte prête à envoyer.",
    promptPreview: "Rédige une réponse polie, directe et utile.",
  },
  {
    id: "task_creation",
    label: "Tâches",
    helper: "Extrait les prochaines actions.",
    promptPreview: "Convertis en checklist priorisée.",
  },
];

export const DEFAULT_SETTINGS: CompanionSettings = {
  language: "fr-FR",
  privacyLevel: "local_first",
  saveHistory: true,
  cloudSyncEnabled: false,
  notificationsEnabled: true,
  hapticsEnabled: true,
};

export const SAMPLE_TRANSCRIPTS = [
  "Rappelle-moi de préparer la synthèse client avant seize heures et d'envoyer la version courte à l'équipe.",
  "Réponds à Camille que je valide la proposition mais que je veux garder une marge sur le planning.",
  "Note réunion produit: simplifier l'onboarding mobile, garder le mode privé visible, puis tester la capture vocale.",
] as const;
