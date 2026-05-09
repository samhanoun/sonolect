/**
 * Voice Activity Detection (VAD) — lightweight energy-based detector.
 *
 * All functions are pure; no Web Audio or mic access happens here.
 * The integration layer feeds Float32Array PCM chunks and acts on the result.
 */

export type VadConfig = {
  /** RMS threshold below which a frame is considered silence (0-1). */
  energyThreshold: number;
  /** Consecutive silent frames before speech is considered ended. */
  silenceFrames: number;
  /** Minimum speech duration in frames to count as valid speech. */
  minSpeechFrames: number;
};

export type VadResult = {
  isSpeech: boolean;
  energy: number;
  speechFrameCount: number;
  silenceFrameCount: number;
};

export type VadState = {
  isSpeaking: boolean;
  speechFrameCount: number;
  silenceFrameCount: number;
  lastEnergy: number;
};

export const DEFAULT_VAD_CONFIG: VadConfig = {
  energyThreshold: 0.01,
  silenceFrames: 30,
  minSpeechFrames: 3,
};

export function createVadState(): VadState {
  return {
    isSpeaking: false,
    speechFrameCount: 0,
    silenceFrameCount: 0,
    lastEnergy: 0,
  };
}

/**
 * Compute the root-mean-square energy of a PCM frame.
 */
export function computeEnergy(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i]! * samples[i]!;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Process a single audio frame through the VAD and return the updated state
 * plus a classification result.
 */
export function processVadFrame(
  state: VadState,
  samples: Float32Array,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): { state: VadState; result: VadResult } {
  const energy = computeEnergy(samples);
  const isAboveThreshold = energy >= config.energyThreshold;

  let { speechFrameCount, silenceFrameCount, isSpeaking } = state;

  if (isAboveThreshold) {
    speechFrameCount += 1;
    silenceFrameCount = 0;
  } else {
    silenceFrameCount += 1;
  }

  if (!isSpeaking && speechFrameCount >= config.minSpeechFrames) {
    isSpeaking = true;
  }

  if (isSpeaking && silenceFrameCount >= config.silenceFrames) {
    isSpeaking = false;
    speechFrameCount = 0;
  }

  const nextState: VadState = {
    isSpeaking,
    speechFrameCount,
    silenceFrameCount,
    lastEnergy: energy,
  };

  return {
    state: nextState,
    result: {
      isSpeech: isSpeaking,
      energy,
      speechFrameCount,
      silenceFrameCount,
    },
  };
}
