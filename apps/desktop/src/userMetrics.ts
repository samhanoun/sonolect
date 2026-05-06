import { saveSettings, loadSettings } from "./persistence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserMetrics = {
  totalDictations: number;
  totalWordsTranscribed: number;
  totalInsertions: number;
  totalTransformations: number;
  estimatedTimeSavedMs: number;
  averageLatencyMs: number;
  streakDays: number;
  lastActiveDate: string;
};

export type MetricEvent = {
  type: "dictation" | "insertion" | "transformation";
  wordCount?: number;
  latencyMs?: number;
  timestamp: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METRICS_STORAGE_KEY = "sonolect.userMetrics";
const DEFAULT_WPM_TYPING = 45;
const DEFAULT_WPM_DICTATION = 150;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDefaultMetrics(): UserMetrics {
  return {
    totalDictations: 0,
    totalWordsTranscribed: 0,
    totalInsertions: 0,
    totalTransformations: 0,
    estimatedTimeSavedMs: 0,
    averageLatencyMs: 0,
    streakDays: 0,
    lastActiveDate: "",
  };
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

export function recordMetricEvent(
  metrics: UserMetrics,
  event: MetricEvent,
): UserMetrics {
  const next = { ...metrics };
  const words = event.wordCount ?? 0;

  switch (event.type) {
    case "dictation":
      next.totalDictations += 1;
      next.totalWordsTranscribed += words;
      next.estimatedTimeSavedMs += estimateTimeSaved(words);
      break;
    case "insertion":
      next.totalInsertions += 1;
      break;
    case "transformation":
      next.totalTransformations += 1;
      break;
  }

  // Rolling average latency
  if (event.latencyMs !== undefined && event.latencyMs > 0) {
    const totalEvents =
      next.totalDictations + next.totalInsertions + next.totalTransformations;
    if (totalEvents <= 1) {
      next.averageLatencyMs = event.latencyMs;
    } else {
      next.averageLatencyMs =
        next.averageLatencyMs +
        (event.latencyMs - next.averageLatencyMs) / totalEvents;
    }
  }

  // Update activity date for streak tracking
  const eventDate = event.timestamp.slice(0, 10); // YYYY-MM-DD
  // Calculate streak BEFORE updating lastActiveDate so we can detect consecutive days
  next.streakDays = calculateStreak(next, eventDate);
  next.lastActiveDate = eventDate;

  return next;
}

export function estimateTimeSaved(
  wordCount: number,
  wpmTyping: number = DEFAULT_WPM_TYPING,
  wpmDictation: number = DEFAULT_WPM_DICTATION,
): number {
  if (wordCount <= 0 || wpmTyping <= 0 || wpmDictation <= 0) return 0;

  const typingTimeMs = (wordCount / wpmTyping) * 60_000;
  const dictationTimeMs = (wordCount / wpmDictation) * 60_000;
  const savedMs = typingTimeMs - dictationTimeMs;

  return Math.max(0, Math.round(savedMs));
}

export function formatTimeSaved(ms: number): string {
  if (ms <= 0) return "0m saved";

  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m saved`;
  }
  if (hours > 0) {
    return `${hours}h saved`;
  }
  return `${minutes}m saved`;
}

export function calculateStreak(
  metrics: UserMetrics,
  today?: string,
): number {
  const todayDate = today ?? new Date().toISOString().slice(0, 10);
  const lastActive = metrics.lastActiveDate;

  if (!lastActive) return 1; // First activity counts as streak of 1

  const todayMs = new Date(todayDate).getTime();
  const lastMs = new Date(lastActive).getTime();
  const diffDays = Math.round((todayMs - lastMs) / 86_400_000);

  if (diffDays === 0) {
    // Same day — keep current streak (min 1)
    return Math.max(metrics.streakDays, 1);
  }
  if (diffDays === 1) {
    // Consecutive day — increment streak
    return metrics.streakDays + 1;
  }
  // Gap of 2+ days — reset streak
  return 1;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function loadMetrics(): UserMetrics {
  const raw = loadSettings(METRICS_STORAGE_KEY);
  if (!raw) return createDefaultMetrics();

  try {
    const parsed = JSON.parse(raw) as Partial<UserMetrics>;
    return {
      totalDictations:
        typeof parsed.totalDictations === "number" ? parsed.totalDictations : 0,
      totalWordsTranscribed:
        typeof parsed.totalWordsTranscribed === "number"
          ? parsed.totalWordsTranscribed
          : 0,
      totalInsertions:
        typeof parsed.totalInsertions === "number" ? parsed.totalInsertions : 0,
      totalTransformations:
        typeof parsed.totalTransformations === "number"
          ? parsed.totalTransformations
          : 0,
      estimatedTimeSavedMs:
        typeof parsed.estimatedTimeSavedMs === "number"
          ? parsed.estimatedTimeSavedMs
          : 0,
      averageLatencyMs:
        typeof parsed.averageLatencyMs === "number"
          ? parsed.averageLatencyMs
          : 0,
      streakDays:
        typeof parsed.streakDays === "number" ? parsed.streakDays : 0,
      lastActiveDate:
        typeof parsed.lastActiveDate === "string" ? parsed.lastActiveDate : "",
    };
  } catch {
    return createDefaultMetrics();
  }
}

export function saveMetrics(metrics: UserMetrics): void {
  saveSettings(METRICS_STORAGE_KEY, JSON.stringify(metrics));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function getMetricsSummary(metrics: UserMetrics): {
  headline: string;
  details: string[];
} {
  const details: string[] = [];

  details.push(
    `${metrics.totalDictations} ${metrics.totalDictations === 1 ? "dictation" : "dictations"} recorded`,
  );
  details.push(
    `${metrics.totalWordsTranscribed.toLocaleString()} words transcribed`,
  );

  if (metrics.totalInsertions > 0) {
    details.push(
      `${metrics.totalInsertions} ${metrics.totalInsertions === 1 ? "insertion" : "insertions"} into apps`,
    );
  }
  if (metrics.totalTransformations > 0) {
    details.push(
      `${metrics.totalTransformations} text ${metrics.totalTransformations === 1 ? "transformation" : "transformations"}`,
    );
  }
  if (metrics.streakDays > 1) {
    details.push(`${metrics.streakDays}-day streak`);
  }

  const timeSaved = formatTimeSaved(metrics.estimatedTimeSavedMs);
  const headline =
    metrics.estimatedTimeSavedMs > 0
      ? `You've ${timeSaved}`
      : "Start dictating to save time";

  return { headline, details };
}
