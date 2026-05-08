export type RecordingState =
  | "idle"
  | "countdown"
  | "recording"
  | "processing"
  | "previewing"
  | "inserting"
  | "done"
  | "error";

export type RecordingEvent =
  | "START"
  | "COUNTDOWN_DONE"
  | "PAUSE"
  | "RESUME"
  | "CANCEL"
  | "FINISH"
  | "PROCESS_COMPLETE"
  | "INSERT"
  | "INSERT_COMPLETE"
  | "ERROR"
  | "RESET";

type TransitionMap = Partial<Record<RecordingEvent, RecordingState>>;

const transitions: Record<RecordingState, TransitionMap> = {
  idle: {
    START: "countdown",
  },
  countdown: {
    COUNTDOWN_DONE: "recording",
    CANCEL: "idle",
    ERROR: "error",
  },
  recording: {
    PAUSE: "recording",
    RESUME: "recording",
    FINISH: "processing",
    CANCEL: "idle",
    ERROR: "error",
  },
  processing: {
    PROCESS_COMPLETE: "previewing",
    CANCEL: "idle",
    ERROR: "error",
  },
  previewing: {
    INSERT: "inserting",
    CANCEL: "idle",
    RESET: "idle",
    ERROR: "error",
  },
  inserting: {
    INSERT_COMPLETE: "done",
    ERROR: "error",
  },
  done: {
    RESET: "idle",
  },
  error: {
    RESET: "idle",
  },
};

export function recordingTransition(
  state: RecordingState,
  event: RecordingEvent,
): RecordingState {
  const next = transitions[state][event];
  return next ?? state;
}

export type RecordingTimerState = {
  startedAt: number | null;
  pausedAt: number | null;
  pausedDuration: number;
  totalDuration: number;
};

export function createTimerState(): RecordingTimerState {
  return {
    startedAt: null,
    pausedAt: null,
    pausedDuration: 0,
    totalDuration: 0,
  };
}

export function getRecordingDuration(
  timer: RecordingTimerState,
  now: number,
): number {
  if (timer.startedAt === null) return timer.totalDuration;
  if (timer.pausedAt !== null) {
    return timer.pausedAt - timer.startedAt - timer.pausedDuration;
  }
  return now - timer.startedAt - timer.pausedDuration;
}

export function updateTimerOnEvent(
  timer: RecordingTimerState,
  event: RecordingEvent,
  now: number,
): RecordingTimerState {
  switch (event) {
    case "COUNTDOWN_DONE":
      return { ...timer, startedAt: now, pausedAt: null, pausedDuration: 0 };
    case "PAUSE":
      if (timer.pausedAt !== null) return timer;
      return { ...timer, pausedAt: now };
    case "RESUME":
      if (timer.pausedAt === null) return timer;
      return {
        ...timer,
        pausedDuration: timer.pausedDuration + (now - timer.pausedAt),
        pausedAt: null,
      };
    case "FINISH":
      return {
        ...timer,
        startedAt: null,
        totalDuration: getRecordingDuration(timer, now),
        pausedAt: null,
      };
    case "CANCEL":
    case "RESET":
      return createTimerState();
    default:
      return timer;
  }
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
