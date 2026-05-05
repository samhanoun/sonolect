export type WaveformAudioBuffer = {
  length: number;
  numberOfChannels: number;
  getChannelData: (channel: number) => Float32Array;
};

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const DEFAULT_BAR_COUNT = 32;

export function extractWaveformPeaks(
  audioBuffer: WaveformAudioBuffer,
  barCount = DEFAULT_BAR_COUNT,
) {
  const safeBarCount = Math.max(1, Math.floor(barCount));
  const peaks = Array.from({ length: safeBarCount }, () => 0);
  const channelCount = Math.max(1, audioBuffer.numberOfChannels || 1);
  const frameCount = Math.max(0, audioBuffer.length || 0);
  if (frameCount === 0) return peaks;

  const framesPerBar = Math.ceil(frameCount / safeBarCount);
  for (let barIndex = 0; barIndex < safeBarCount; barIndex += 1) {
    const start = barIndex * framesPerBar;
    const end = Math.min(frameCount, start + framesPerBar);
    if (start >= end) break;

    let squareSum = 0;
    let sampleCount = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const channelData = audioBuffer.getChannelData(channel);
      for (let frame = start; frame < end; frame += 1) {
        const value = channelData[frame] ?? 0;
        squareSum += value * value;
        sampleCount += 1;
      }
    }

    peaks[barIndex] =
      sampleCount > 0 ? Math.min(1, Math.sqrt(squareSum / sampleCount)) : 0;
  }

  return peaks;
}

export async function decodeAudioWaveform(
  audioUrl: string,
  barCount = DEFAULT_BAR_COUNT,
) {
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Unable to load audio waveform (${response.status})`);
  }
  const audioData = await response.arrayBuffer();
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextCtor();
  try {
    const audioBuffer = await audioContext.decodeAudioData(audioData.slice(0));
    return extractWaveformPeaks(audioBuffer, barCount);
  } finally {
    if (audioContext.state !== "closed") {
      void audioContext.close();
    }
  }
}
