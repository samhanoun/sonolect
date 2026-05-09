export function applyGain(samples: Float32Array, gain: number): Float32Array {
  const result = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    result[i] = Math.max(-1, Math.min(1, samples[i]! * gain));
  }
  return result;
}

export function applyNoiseGate(
  samples: Float32Array,
  threshold: number,
): Float32Array {
  const result = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    result[i] = Math.abs(samples[i]!) < threshold ? 0 : samples[i]!;
  }
  return result;
}

export function normalize(samples: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]!);
    if (abs > peak) peak = abs;
  }
  if (peak === 0) return new Float32Array(samples.length);
  const result = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    result[i] = samples[i]! / peak;
  }
  return result;
}

export type AudioPreset = {
  gain: number;
  noiseGateThreshold: number;
  normalize: boolean;
};

export const AUDIO_PRESETS: Record<
  "normal" | "whisper" | "noisy",
  AudioPreset
> = {
  normal: { gain: 1.0, noiseGateThreshold: 0.01, normalize: true },
  whisper: { gain: 3.0, noiseGateThreshold: 0.005, normalize: true },
  noisy: { gain: 0.8, noiseGateThreshold: 0.05, normalize: true },
};

export function preprocessAudio(
  samples: Float32Array,
  preset: AudioPreset,
): Float32Array {
  let result = applyGain(samples, preset.gain);
  result = applyNoiseGate(result, preset.noiseGateThreshold);
  if (preset.normalize) result = normalize(result);
  return result;
}
